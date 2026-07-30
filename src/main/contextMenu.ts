// 右键菜单管理工具
// 枚举 HKCR 下常见右键菜单位置（文件 *、目录、文件夹、驱动器、目录背景）的菜单项，
// 支持「禁用 / 启用」（shell 项加 LegacyDisable；shellex 处理程序置空默认值并备份）、
// 「删除」（reg export 全量备份后可恢复）与「恢复」。
// 写 HKCR 通常需管理员权限；当前用户也可修改自身 HKCU\Software\Classes 合并项。
import { execFile } from 'node:child_process'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export type CtxMenuType = 'shell' | 'handler'
export type CtxRoot =
  | 'HKCR:\\*\\shell'
  | 'HKCR:\\*\\shellex\\ContextMenuHandlers'
  | 'HKCR:\\Directory\\shell'
  | 'HKCR:\\Directory\\Background\\shell'
  | 'HKCR:\\Folder\\shell'
  | 'HKCR:\\Drive\\shell'

export interface ContextMenuEntry {
  root: CtxRoot
  name: string
  type: CtxMenuType
  label: string
  command: string
  disabled: boolean
  regPath: string // HKCR\*\shell\foo
}

export interface ContextMenuBackup {
  root: CtxRoot
  name: string
  regPath: string
  file: string
  removedAt: string
}

const ROOTS: { root: CtxRoot; type: CtxMenuType }[] = [
  { root: 'HKCR:\\*\\shell', type: 'shell' },
  { root: 'HKCR:\\*\\shellex\\ContextMenuHandlers', type: 'handler' },
  { root: 'HKCR:\\Directory\\shell', type: 'shell' },
  { root: 'HKCR:\\Directory\\Background\\shell', type: 'shell' },
  { root: 'HKCR:\\Folder\\shell', type: 'shell' },
  { root: 'HKCR:\\Drive\\shell', type: 'shell' },
]

function runPowerShell(script: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ' + script],
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 16, timeout: timeoutMs },
      (err: Error | null, stdout: string) => {
        if (err) {
          if (stdout && stdout.trim()) resolve(stdout)
          else reject(err)
          return
        }
        resolve(stdout)
      },
    )
  })
}

function parseJsonArray<T>(s: string): T[] {
  const trimmed = (s || '').trim()
  if (!trimmed) return []
  try {
    const data = JSON.parse(trimmed)
    return (Array.isArray(data) ? data : [data]) as T[]
  } catch {
    return []
  }
}

function regPathOf(root: string, name: string): string {
  return `HKCR\\${root.slice('HKCR:\\'.length)}\\${name}`
}

// 注意：部分环境下 PowerShell 未挂载 HKCR PSDrive（只有 HKCU/HKLM），
// 且 Registry:: provider 在受限进程里也会抛错。改用 .NET Microsoft.Win32.Registry
// API 直接访问 HKEY_CLASSES_ROOT，最稳。
const LIST_SCRIPT = `
$cr = [Microsoft.Win32.Registry]::ClassesRoot
$roots = @(
  @{root='HKCR:\\*\\shell'; sub='*\\shell'; type='shell'},
  @{root='HKCR:\\*\\shellex\\ContextMenuHandlers'; sub='*\\shellex\\ContextMenuHandlers'; type='handler'},
  @{root='HKCR:\\Directory\\shell'; sub='Directory\\shell'; type='shell'},
  @{root='HKCR:\\Directory\\Background\\shell'; sub='Directory\\Background\\shell'; type='shell'},
  @{root='HKCR:\\Folder\\shell'; sub='Folder\\shell'; type='shell'},
  @{root='HKCR:\\Drive\\shell'; sub='Drive\\shell'; type='shell'}
)
$out = @()
foreach ($r in $roots) {
  $sub = $cr.OpenSubKey($r.sub)
  if ($null -eq $sub) { continue }
  foreach ($name in $sub.GetSubKeyNames()) {
    $label = ''
    $command = ''
    $disabled = $false
    $itemKey = $sub.OpenSubKey($name)
    if ($null -eq $itemKey) { continue }
    if ($r.type -eq 'shell') {
      $def = $itemKey.GetValue('')
      $label = if ($def) { [string]$def } else { [string]$name }
      $cmdKey = $itemKey.OpenSubKey('command')
      if ($null -ne $cmdKey) { $command = [string]$cmdKey.GetValue('') }
      $ld = $itemKey.GetValue('LegacyDisable')
      if ($null -ne $ld) { $disabled = $true }
    } else {
      $label = [string]$name
      $def = $itemKey.GetValue('')
      if ($null -eq $def -or [string]$def -eq '') { $disabled = $true }
    }
    $out += [PSCustomObject]@{ root=$r.root; type=$r.type; name=$name; label=$label; command=$command; disabled=[bool]$disabled }
  }
}
$out | ConvertTo-Json -Compress
`

export async function listContextMenu(): Promise<ContextMenuEntry[]> {
  const raw = await runPowerShell(LIST_SCRIPT)
  const rows = parseJsonArray<{ root: CtxRoot; type: CtxMenuType; name: string; label: string; command: string; disabled: boolean }>(raw)
  return rows
    .filter((r) => r.name)
    // 过滤掉我们自己的禁用标记残留（理论上不会出现，name 来源于真实子键）
    .map((r) => ({
      root: r.root,
      name: r.name,
      type: r.type,
      label: r.label || r.name,
      command: r.command || '',
      disabled: !!r.disabled,
      regPath: regPathOf(r.root, r.name),
    }))
    .sort((a, b) => {
      if (a.root !== b.root) return a.root.localeCompare(b.root)
      return a.label.localeCompare(b.label)
    })
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64')
}

export interface OpResult {
  ok: boolean
  message: string
}

// 禁用 / 启用。payload: { root, name, disable: boolean }
export async function setContextMenuEnabled(payload: { root: CtxRoot; name: string; disable: boolean }): Promise<OpResult> {
  const param = b64(payload)
  const script = `
$param = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${param}')) | ConvertFrom-Json
$root = $param.root; $name = $param.name; $disable = [bool]$param.disable
$sub = $root.Substring('HKCR:\\'.Length)
$cr = [Microsoft.Win32.Registry]::ClassesRoot
$type = if ($root -like '*ContextMenuHandlers*') { 'handler' } else { 'shell' }
$subKey = $cr.OpenSubKey($sub, $true)
if ($null -eq $subKey) { Write-Error "key-not-found"; exit 1 }
$itemKey = $subKey.OpenSubKey($name, $true)
if ($null -eq $itemKey) { Write-Error "key-not-found"; exit 1 }
if ($type -eq 'shell') {
  if ($disable) {
    $itemKey.SetValue('LegacyDisable', '', [Microsoft.Win32.RegistryValueKind]::String)
  } else {
    $itemKey.DeleteValue('LegacyDisable', $false)
  }
} else {
  $def = $itemKey.GetValue('')
  if ($disable) {
    if ($def) {
      $bak = Join-Path $env:LOCALAPPDATA 'agentsc-backups'
      if (-not (Test-Path $bak)) { New-Item -ItemType Directory -Path $bak -Force | Out-Null }
      $bakFile = Join-Path $bak ('ctx_handler_' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$root|$name")).Replace('/','_').Replace('+','-') + '.json')
      @{ root=$root; name=$name; value=[string]$def } | ConvertTo-Json | Set-Content -Path $bakFile -Encoding UTF8
    }
    $itemKey.SetValue('', '', [Microsoft.Win32.RegistryValueKind]::String)
  } else {
    $bak = Join-Path $env:LOCALAPPDATA 'agentsc-backups'
    $bakFile = Join-Path $bak ('ctx_handler_' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$root|$name")).Replace('/','_').Replace('+','-') + '.json')
    if (Test-Path $bakFile) {
      $saved = Get-Content $bakFile -Encoding UTF8 | ConvertFrom-Json
      $itemKey.SetValue('', [string]$saved.value, [Microsoft.Win32.RegistryValueKind]::String)
    } else {
      Write-Error "no-backup"; exit 1
    }
  }
}
'ok'
`
  try {
    await runPowerShell(script)
    return { ok: true, message: payload.disable ? '已禁用（重启资源管理器或目标程序后生效）' : '已启用' }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    if (/no-backup/.test(msg)) return { ok: false, message: '未找到该处理程序的备份，无法恢复（可能原本即为空）' }
    return { ok: false, message: msg }
  }
}

function ctxBackupDir(): string {
  const dir = path.join(app.getPath('userData'), 'agentsc-backups')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function ctxBackupFile(root: string, name: string): string {
  const safe = Buffer.from(`${root}|${name}`, 'utf-8').toString('base64').replace(/[/+=]/g, '_')
  return path.join(ctxBackupDir(), `ctxmenu_${safe}.reg`)
}

// 删除（先全量导出备份再删除）
export async function deleteContextMenu(payload: { root: CtxRoot; name: string }): Promise<OpResult> {
  const regPath = regPathOf(payload.root, payload.name)
  const regFile = ctxBackupFile(payload.root, payload.name)
  const script = `
$regPath = '${regPath}'
$regFile = '${regFile.replace(/\\/g, '\\\\')}'
if (-not (Test-Path "Microsoft.PowerShell.Core\\Registry::$('HKEY_CLASSES_ROOT\\' + $regPath.Substring(4))")) { Write-Error "key-not-found"; exit 1 }
& reg export $regPath $regFile /y | Out-Null
Remove-Item -Path "Registry::HKEY_CLASSES_ROOT\\$($regPath.Substring(4))" -Recurse -Force
'ok'
`
  try {
    await runPowerShell(script)
    return { ok: true, message: '已删除（已自动备份，可恢复）' }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    if (/key-not-found/.test(msg)) return { ok: false, message: '注册表项不存在' }
    return { ok: false, message: msg }
  }
}

// 恢复（reg import 备份文件）
export async function restoreContextMenu(payload: { root: CtxRoot; name: string }): Promise<OpResult> {
  const regFile = ctxBackupFile(payload.root, payload.name)
  if (!fs.existsSync(regFile)) return { ok: false, message: '未找到备份文件，无法恢复' }
  const script = `& reg import '${regFile.replace(/\\/g, '\\\\')}' | Out-Null; 'ok'`
  try {
    await runPowerShell(script)
    return { ok: true, message: '已恢复右键菜单项' }
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}

export async function listContextMenuBackups(): Promise<ContextMenuBackup[]> {
  const dir = ctxBackupDir()
  const out: ContextMenuBackup[] = []
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('ctxmenu_') || !f.endsWith('.reg')) continue
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
      // 从 .reg 头部推断根与名称
      const m = raw.match(/\[HKEY_CLASSES_ROOT\\([^\]]+)\]/i)
      if (!m) continue
      const full = m[1].replace(/\\/g, '\\')
      // 反推 root + name
      const found = ROOTS.find((r) => full.toLowerCase().startsWith(r.root.toLowerCase().slice('HKCR:\\'.length)))
      if (found) {
        const name = full.slice(found.root.toLowerCase().slice('HKCR:\\'.length).length + 1)
        out.push({ root: found.root, name, regPath: `HKCR\\${full}`, file: f, removedAt: '' })
      }
    }
  } catch {
    /* ignore */
  }
  return out
}
