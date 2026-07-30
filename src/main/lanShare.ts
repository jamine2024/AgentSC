import { execFile } from 'node:child_process'
import fs from 'node:fs'

// 局域网共享文件夹管理（仅 Windows）
// - 本机共享：用 WMI Win32_Share 查询（最通用，覆盖系统隐藏共享），
//   用 PowerShell SMB cmdlet（New-SmbShare / Remove-SmbShare）创建/删除（中文安全）。
// - 局域网发现：用 cmd / net view 列出同工作组设备及其共享（统一切 UTF-8 代码页避免乱码）。

export interface LocalShare {
  name: string
  path: string
  description: string
  maxUsers: number | null
  type: number
  hidden: boolean // 名称以 $ 结尾（系统隐藏共享，如 C$ / ADMIN$）
  system: boolean // Windows 保留共享（C$ / D$ / ADMIN$ / IPC$ 等），无法通过 Remove-SmbShare 删除
}

// Windows 自动创建、无法通过 Remove-SmbShare 删除的保留共享
const RESERVED_SHARES = new Set(['ADMIN$', 'IPC$', 'PRINT$', 'FAX$'])
export function isSystemShare(name: string): boolean {
  const n = (name || '').trim().toUpperCase()
  if (RESERVED_SHARES.has(n)) return true
  // 盘符型管理员共享：C$ / D$ / E$ ...
  if (/^[A-Z]:\$$/.test(n)) return true
  return false
}

export interface RemoteShare {
  name: string
  remark: string
}

interface CmdResult {
  code: number
  stdout: string
  stderr: string
}

function runCmd(cmd: string): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    // chcp 65001 让 cmd 以 UTF-8 输出，规避中文路径/共享名乱码
    const full = `chcp 65001>nul && ${cmd}`
    execFile(
      'cmd',
      ['/c', full],
      { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
          const msg = (e.stderr || e.stdout || e.message || '命令执行失败').toString().trim()
          reject(new Error(msg || '命令执行失败'))
          return
        }
        resolve({ code: 0, stdout: stdout || '', stderr: stderr || '' })
      },
    )
  })
}

function runPS(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n${script}`
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, _stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
          const msg = (e.stderr || e.stdout || e.message || 'PowerShell 执行失败').toString().trim()
          reject(new Error(msg || 'PowerShell 执行失败'))
          return
        }
        resolve(stdout || '')
      },
    )
  })
}

// 列出本机所有 SMB 共享（含系统隐藏共享 C$ / ADMIN$ / IPC$ 等）
export async function listLocalShares(): Promise<LocalShare[]> {
  const ps = `Get-CimInstance -ClassName Win32_Share | Select-Object Name, Path, Description, MaximumAllowed, Type | ConvertTo-Json -Compress`
  const out = await runPS(ps)
  if (!out.trim()) return []
  let data: unknown
  try {
    data = JSON.parse(out.trim())
  } catch {
    return []
  }
  const arr = Array.isArray(data) ? (data as unknown[]) : [data]
  return arr.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>
    const name = typeof o.Name === 'string' ? o.Name : ''
    return {
      name,
      path: typeof o.Path === 'string' ? o.Path : '',
      description: typeof o.Description === 'string' ? o.Description : '',
      maxUsers: typeof o.MaximumAllowed === 'number' ? o.MaximumAllowed : null,
      type: typeof o.Type === 'number' ? o.Type : 0,
      hidden: name.endsWith('$'),
      system: isSystemShare(name),
    }
  })
}

export async function createShare(input: {
  path: string
  name: string
  description?: string
  readOnly?: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const path = (input.path || '').trim()
  const name = (input.name || '').trim()
  if (!path || !name) return { ok: false, error: '路径和共享名均不能为空' }
  if (!fs.existsSync(path)) return { ok: false, error: `路径不存在：${path}` }

  const perm = input.readOnly ? '-ReadAccess Everyone' : '-FullAccess Everyone'
  const descArg =
    input.description && input.description.trim()
      ? ` -Description ${JSON.stringify(input.description.trim().replace(/[<>]/g, ''))}`
      : ''
  const ps = `New-SmbShare -Name ${JSON.stringify(name)} -Path ${JSON.stringify(path)}${descArg} ${perm} -ErrorAction Stop`
  try {
    await runPS(ps)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message || '创建共享失败' }
  }
}

export async function removeShare(name: string): Promise<{ ok: boolean; error?: string }> {
  const n = (name || '').trim()
  if (!n) return { ok: false, error: '共享名不能为空' }
  // Windows 保留共享无法通过 Remove-SmbShare 删除（会报 Error 50：The request is not supported）
  if (isSystemShare(n)) {
    return {
      ok: false,
      error: `「${n}」是 Windows 系统保留共享（由系统自动创建），无法通过此功能删除。如需关闭，请在注册表 HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters 下将 AutoShareServer 设为 0 并重启。`,
    }
  }
  const ps = `Remove-SmbShare -Name ${JSON.stringify(n)} -Force -ErrorAction Stop`
  try {
    await runPS(ps)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message || '删除共享失败' }
  }
}

// 扫描局域网内同工作组/域的在线电脑（net view）。
// 网络发现未开启时 net view 退出码非 0，返回特殊错误 'net-view-unavailable' 便于 UI 提示。
export async function listComputers(): Promise<string[] | { error: string }> {
  try {
    const r = await runCmd('net view')
    const names: string[] = []
    for (const line of r.stdout.split('\n')) {
      const m = line.trim().match(/^\\\\(\S+)/)
      if (m) names.push(m[1])
    }
    return names
  } catch (e) {
    const msg = (e as Error).message || ''
    if (/6118/.test(msg)) return { error: 'net-view-unavailable' }
    return { error: msg }
  }
}

// 列出某台电脑的磁盘类型共享（过滤 IPC$ / 打印机等）。
export async function listRemoteShares(
  computer: string,
): Promise<RemoteShare[] | { error: string }> {
  const c = (computer || '').trim()
  if (!c) return { error: '计算机名为空' }
  const target = c.startsWith('\\\\') ? c : `\\\\${c}`
  try {
    const r = await runCmd(`net view "${target}"`)
    const shares: RemoteShare[] = []
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^(\S+)\s+(\S+)\s*(.*)$/)
      if (!m) continue
      const typeCol = m[2]
      // 仅保留磁盘类型共享（中文"磁盘" / 英文"Disk"），过滤 IPC / 打印机等
      if (!/(磁盘|Disk)/i.test(typeCol)) continue
      if (/^共享名|Share name|^[-]+|命令成功|The command/i.test(line)) continue
      shares.push({ name: m[1], remark: (m[3] || '').trim() })
    }
    return shares
  } catch (e) {
    return { error: (e as Error).message || '无法访问远程共享' }
  }
}
