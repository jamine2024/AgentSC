// ───────────────────────────────────────────────────────────
// 系统启动项管理（主进程）
// - 收集三类 Windows 开机启动项：
//   1) 注册表 Run / RunOnce（HKCU / HKLM）
//   2) 启动文件夹的快捷方式（当前用户 / 公共）
//   3) 计划任务中带 Logon 触发器的任务
// - 启用 / 禁用均可恢复：
//   · 注册表项：禁用前将 (hive/key/valueName/type/data) 备份到 startup-backups.json，
//     再用 reg delete 移除；启用时按备份 reg add 写回。HKLM 需管理员（本应用已提权）。
//   · 启动文件夹 .lnk：禁用时移到 %userData%/AgentSC/disabled-startup/，启用时移回。
//   · 计划任务：schtasks /Change /ENABLE|/DISABLE。
// ───────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'

export const isStartupSupported = process.platform === 'win32'

export interface StartupItem {
  id: string
  name: string
  command: string
  location: string
  type: 'registry' | 'startupFolder' | 'scheduledTask'
  enabled: boolean
  scope: 'user' | 'machine'
}

interface BackupEntry {
  type: 'registry' | 'startupFolder'
  name: string
  command: string
  location: string
  scope: 'user' | 'machine'
  // registry
  hive?: string
  key?: string
  valueName?: string
  regType?: string
  data?: string
  // startupFolder
  srcPath?: string
}

// ── 备份存储（禁用注册表项 / 启动文件夹项时记录，用于恢复） ──
function getBackupDir(): string {
  return path.join(app.getPath('userData'), 'AgentSC')
}
function getBackupFile(): string {
  return path.join(getBackupDir(), 'startup-backups.json')
}

let backupCache: Record<string, BackupEntry> | null = null
function loadBackups(): Record<string, BackupEntry> {
  if (backupCache) return backupCache
  try {
    if (fs.existsSync(getBackupFile())) {
      backupCache = JSON.parse(fs.readFileSync(getBackupFile(), 'utf8')) as Record<string, BackupEntry>
    } else {
      backupCache = {}
    }
  } catch {
    backupCache = {}
  }
  return backupCache
}
function saveBackups(b: Record<string, BackupEntry>) {
  backupCache = b
  try {
    fs.mkdirSync(getBackupDir(), { recursive: true })
    fs.writeFileSync(getBackupFile(), JSON.stringify(b, null, 2), 'utf8')
  } catch {
    /* ignore */
  }
}

// ── 通用执行辅助 ──
function execCapture(
  cmd: string,
  args: string[],
  timeout = 20000,
): Promise<{ ok: boolean; code: number | null; out: string }> {
  return new Promise((resolve) => {
    let settled = false
    let out = ''
    const child = spawn(cmd, args, { windowsHide: true })
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve({ ok: false, code: null, out })
      }
    }, timeout)
    child.stdout?.on('data', (d) => (out += d.toString()))
    child.stderr?.on('data', (d) => (out += d.toString()))
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ok: false, code: null, out: e.message })
      }
    })
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ok: code === 0, code, out })
      }
    })
  })
}

function runReg(args: string[], timeout = 20000) {
  return execCapture('reg', args, timeout)
}
function runSchtasks(args: string[], timeout = 20000) {
  return execCapture('schtasks', args, timeout)
}
function runPs(script: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let out = ''
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve(out)
      }
    }, timeout)
    // 只把 stdout 当作结果返回；stderr 仅消费（避免缓冲区阻塞），绝不混入 JSON。
    // 否则 PowerShell 的 CLIXML 警告流（前缀 "#< CLIXML" 与尾部 "<Objs…>"）会污染
    // ConvertTo-Json 输出，导致 JSON.parse 失败、启动项列表为空。
    child.stdout?.on('data', (d) => (out += d.toString('utf8')))
    child.stderr?.on('data', () => {})
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(e)
      }
    })
    child.on('exit', () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(out)
      }
    })
  })
}

// ── JSON 解析辅助 ──
function safeJsonParseArray(s: string): any[] {
  try {
    const idx = s.indexOf('[')
    const arr = idx >= 0 ? JSON.parse(s.slice(idx)) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
function safeJsonParse(s: string): any {
  try {
    const idx = s.indexOf('{')
    return idx >= 0 ? JSON.parse(s.slice(idx)) : null
  } catch {
    return null
  }
}

// ── 收集全部启动项的 PowerShell 脚本（EncodedCommand 调用，避免引号转义地狱） ──
const PS_LIST_SCRIPT = [
  // 强制 stdout 以 UTF-8 输出，避免中文启动项名被当作 UTF-16LE 解码成乱码
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$ErrorActionPreference = "SilentlyContinue"',
  '$out = [System.Collections.ArrayList]@()',
  '',
  '# 注册表 Run / RunOnce (HKCU / HKLM)',
  '$keys = @(',
  '  @{hive="HKCU"; key="Software\\Microsoft\\Windows\\CurrentVersion\\Run"}',
  '  @{hive="HKLM"; key="Software\\Microsoft\\Windows\\CurrentVersion\\Run"}',
  '  @{hive="HKCU"; key="Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce"}',
  '  @{hive="HKLM"; key="Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce"}',
  ')',
  'foreach ($k in $keys) {',
  '  $scope = if ($k.hive -eq "HKCU") { "user" } else { "machine" }',
  '  $full = "$($k.hive):\\$($k.key)"',
  '  $item = Get-Item -Path $full -ErrorAction SilentlyContinue',
  '  if ($item) {',
  '    foreach ($vn in $item.GetValueNames()) {',
  '      if ([string]::IsNullOrEmpty($vn)) { continue }',
  '      $data = [string]($item.GetValue($vn))',
  '      $kind = $item.GetValueKind($vn)',
  '      $regType = switch ($kind) { 1 {"REG_SZ"} 2 {"REG_EXPAND_SZ"} 3 {"REG_BINARY"} 4 {"REG_DWORD"} 7 {"REG_MULTI_SZ"} 11 {"REG_QWORD"} default {"REG_SZ"} }',
  '      [void]$out.Add([PSCustomObject]@{',
  '        type="registry"; hive=$k.hive; key=$k.key; valueName=$vn',
  '        name=$vn; command=$data; location=$full; scope=$scope; enabled=$true; regType=$regType',
  '      })',
  '    }',
  '  }',
  '}',
  '',
  '# 启动文件夹 (.lnk)',
  '$dirs = @(',
  '  @{p=[System.Environment]::GetFolderPath("Startup"); s="user"}',
  '  @{p=Join-Path $env:ProgramData "Microsoft\\Windows\\Start Menu\\Programs\\Startup"; s="machine"}',
  ')',
  'foreach ($d in $dirs) {',
  '  if (Test-Path $d.p) {',
  '    Get-ChildItem $d.p -Filter *.lnk | ForEach-Object {',
  '      [void]$out.Add([PSCustomObject]@{',
  '        type="startupFolder"; scope=$d.s; name=$_.BaseName; command=$_.FullName; location=$d.p; enabled=$true',
  '      })',
  '    }',
  '  }',
  '}',
  '',
  '# 计划任务（Logon 触发器）',
  'try {',
  '  $tasks = Get-ScheduledTask | Where-Object { $_.Triggers | Where-Object { $_.Type -like "*Logon*" -or $_.CimClass.CimClassName -like "*Logon*" } }',
  '  foreach ($tk in $tasks) {',
  '    $enabled = $tk.State -ne "Disabled"',
  '    $act = $tk.Actions | Select-Object -First 1',
  '    $cmd = ""',
  '    if ($act) { $cmd = "$($act.Execute) $($act.Arguments)" }',
  '    [void]$out.Add([PSCustomObject]@{',
  '      type="scheduledTask"; scope="machine"; name=$tk.TaskName; command=$cmd.Trim()',
  '      location=("计划任务：" + $tk.TaskPath); enabled=$enabled',
  '    })',
  '  }',
  '} catch {}',
  '',
  'if ($out.Count -gt 0) { ConvertTo-Json -InputObject $out -Compress } else { "[]" }',
].join('\n')

// 读取单个注册表值（含类型），供禁用时备份原始数据
function readRegScript(hive: string, key: string, valueName: string): string {
  const vn = valueName.replace(/"/g, '""')
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference="SilentlyContinue"',
    `$item = Get-Item -Path "${hive}:\\${key}" -ErrorAction SilentlyContinue`,
    'if ($item) {',
    `  $vn = "${vn}"`,
    '  $data = [string]($item.GetValue($vn))',
    '  $kind = $item.GetValueKind($vn)',
    '  $regType = switch ($kind) { 1 {"REG_SZ"} 2 {"REG_EXPAND_SZ"} 3 {"REG_BINARY"} 4 {"REG_DWORD"} 7 {"REG_MULTI_SZ"} 11 {"REG_QWORD"} default {"REG_SZ"} }',
    '  [PSCustomObject]@{ found=$true; data=$data; regType=$regType } | ConvertTo-Json -Compress',
    '} else { [PSCustomObject]@{ found=$false } | ConvertTo-Json -Compress }',
  ].join('\n')
}

// ── id 生成（稳定、跨重启一致） ──
function makeId(o: any): string {
  if (o.type === 'registry') return `reg::${o.hive}::${o.key}::${o.valueName}`
  if (o.type === 'startupFolder') return `lnk::${o.command}`
  if (o.type === 'scheduledTask') return `task::${o.name}`
  return `unk::${o.name}`
}

// ── 列出全部启动项（含合并备份里的已禁用项） ──
export async function listStartupItems(): Promise<{ supported: boolean; items: StartupItem[] }> {
  if (!isStartupSupported) return { supported: false, items: [] }

  let items: StartupItem[] = []
  try {
    const raw = await runPs(PS_LIST_SCRIPT, 40000)
    const arr = safeJsonParseArray(raw)
    items = arr.map((o): StartupItem => ({
      id: makeId(o),
      name: o.name || '',
      command: o.command || '',
      location: o.location || '',
      type: o.type,
      enabled: o.enabled !== false,
      scope: o.scope === 'machine' ? 'machine' : 'user',
    }))
  } catch {
    items = []
  }

  // 合并备份中的禁用项；若某禁用项当前已重新出现则清理备份记录
  const backup = loadBackups()
  const liveIds = new Set(items.map((i) => i.id))
  let changed = false
  for (const id of Object.keys(backup)) {
    if (liveIds.has(id)) {
      delete backup[id]
      changed = true
    }
  }
  if (changed) saveBackups(backup)
  for (const [id, b] of Object.entries(backup)) {
    if (liveIds.has(id)) continue
    items.push({
      id,
      name: b.name,
      command: b.command,
      location: b.location,
      type: b.type,
      enabled: false,
      scope: b.scope,
    })
  }

  items.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    if (a.type !== b.type) return a.type.localeCompare(b.type)
    return a.name.localeCompare(b.name)
  })

  return { supported: true, items }
}

// ── 启用 / 禁用单个启动项 ──
export async function setStartupEnabled(
  id: string,
  enabled: boolean,
): Promise<{ ok: boolean; enabled?: boolean; error?: string }> {
  if (!isStartupSupported) return { ok: false, error: '仅支持 Windows 系统' }

  try {
    // ── 注册表项 ──
    if (id.startsWith('reg::')) {
      const parts = id.split('::')
      const hive = parts[1]
      const valueName = parts[parts.length - 1]
      const prefix = `reg::${hive}::`
      const suffix = `::${valueName}`
      const key = id.slice(prefix.length, id.length - suffix.length)

      if (enabled) {
        const backup = loadBackups()
        const b = backup[id]
        if (!b) return { ok: false, error: '未找到备份记录，无法重新启用' }
        const ps = readRegScript(hive, key, valueName)
        const o = safeJsonParse(await runPs(ps, 15000))
        if (o && o.found) {
          // 该项已在外部被重新启用，仅清理备份
          delete backup[id]
          saveBackups(backup)
          return { ok: true, enabled: true }
        }
        const res = await runReg(['add', `${hive}\\${key}`, '/v', valueName, '/t', b.regType || 'REG_SZ', '/d', b.data || '', '/f'])
        if (!res.ok) return { ok: false, error: (res.out || `退出码 ${res.code}`).trim() }
        delete backup[id]
        saveBackups(backup)
        return { ok: true, enabled: true }
      } else {
        const ps = readRegScript(hive, key, valueName)
        const o = safeJsonParse(await runPs(ps, 15000))
        if (!o || !o.found) return { ok: false, error: '注册表项不存在' }
        const backup = loadBackups()
        backup[id] = {
          type: 'registry',
          name: valueName,
          command: o.data,
          location: `${hive}:\\${key}`,
          scope: hive === 'HKCU' ? 'user' : 'machine',
          hive,
          key,
          valueName,
          regType: o.regType,
          data: o.data,
        }
        saveBackups(backup)
        const res = await runReg(['delete', `${hive}\\${key}`, '/v', valueName, '/f'])
        if (!res.ok) return { ok: false, error: (res.out || `退出码 ${res.code}`).trim() }
        return { ok: true, enabled: false }
      }
    }

    // ── 启动文件夹 .lnk ──
    if (id.startsWith('lnk::')) {
      const srcPath = id.slice('lnk::'.length)
      const scope: 'user' | 'machine' = srcPath.toLowerCase().includes('programdata') ? 'machine' : 'user'
      const disabledPath = path.join(getBackupDir(), 'disabled-startup', path.basename(srcPath))
      if (enabled) {
        const backup = loadBackups()
        const b = backup[id]
        if (!b || !fs.existsSync(disabledPath)) return { ok: false, error: '未找到备份的快捷方式' }
        fs.mkdirSync(path.dirname(srcPath), { recursive: true })
        fs.renameSync(disabledPath, srcPath)
        if (b) {
          delete backup[id]
          saveBackups(backup)
        }
        return { ok: true, enabled: true }
      } else {
        if (!fs.existsSync(srcPath)) return { ok: false, error: '快捷方式不存在' }
        const backup = loadBackups()
        backup[id] = {
          type: 'startupFolder',
          name: path.basename(srcPath, '.lnk'),
          command: srcPath,
          location: path.dirname(srcPath),
          scope,
          srcPath,
        }
        saveBackups(backup)
        fs.mkdirSync(path.dirname(disabledPath), { recursive: true })
        fs.renameSync(srcPath, disabledPath)
        return { ok: true, enabled: false }
      }
    }

    // ── 计划任务 ──
    if (id.startsWith('task::')) {
      const taskName = id.slice('task::'.length)
      const arg = enabled ? '/ENABLE' : '/DISABLE'
      const res = await runSchtasks(['/Change', '/TN', taskName, arg])
      if (!res.ok) return { ok: false, error: (res.out || `退出码 ${res.code}`).trim() }
      return { ok: true, enabled }
    }

    return { ok: false, error: '未知的启动项类型' }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
