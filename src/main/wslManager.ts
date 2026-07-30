// ───────────────────────────────────────────────────────────
// WSL 文件管理器（主进程）
// - 枚举本机 WSL 发行版（wsl -l -v）：名称 / 运行状态 / 版本 / 是否默认
// - 浏览发行版根文件系统：通过 `wsl -d <发行版> ls -la` 读取（避免 Node 直接
//   访问 \\wsl$\ UNC 路径时的卡顿/挂起，且发行版停止时 WSL 会自动按需启动）
// - 在 Windows 资源管理器中打开 WSL 路径（\\wsl$\<发行版>\...）
// - 发行版管理：设为默认 / 终止 / 启动 / 导出 / 导入
// ───────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import path from 'node:path'
import { shell } from 'electron'

export interface WslDistro {
  name: string
  state: string // Running / Stopped / Installing / ...
  version: string // '1' | '2'
  isDefault: boolean
}

export interface WslEntry {
  name: string
  path: string // Linux 路径（以 / 开头）
  isDir: boolean
  isSymlink: boolean
  size: number
  mtime: number // 毫秒时间戳
  perms: string // 例如 drwxr-xr-x
}

export interface SimpleResult {
  ok: boolean
  error?: string
}

// 统一的 wsl 命令运行封装：使用 buffer 编码，兼容 UTF-16LE（Windows 控制台常见）
// 与 UTF-8 输出，避免中文/特殊字符乱码。
function runWsl(args: string[], timeout?: number): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      'wsl',
      args,
      { windowsHide: true, encoding: 'buffer', timeout } as never,
      (err, stdout, stderr) => {
        const dec = (b?: Buffer): string => {
          if (!b || b.length === 0) return ''
          // 带 BOM 的 UTF-16LE
          if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.toString('utf16le').replace(/^﻿/, '')
          // 无 BOM 的 UTF-16LE（Windows 控制台默认）
          if (b.length >= 2 && b[0] === 0 && b[1] !== 0) return b.toString('utf16le').replace(/^﻿/, '')
          return b.toString('utf8')
        }
        const out = (dec(stdout as Buffer) + '\n' + dec(stderr as Buffer)).trim()
        let code = 0
        if (err) code = (err as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? -2 : 1
        resolve({ stdout: out, code })
      },
    )
    // 防御：若进程句柄异常（如 wsl 不存在），确保始终 resolve
    child.on('error', () => resolve({ stdout: '', code: 1 }))
  })
}

// ── 枚举发行版 ──
export async function listDistros(): Promise<WslDistro[]> {
  const { stdout } = await runWsl(['-l', '-v'], 15000)
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const distros: WslDistro[] = []
  const stateRe = /^(Running|Stopped|Installing|Uninstalling|Converting|Aborting)$/i
  for (const line of lines) {
    // 跳过表头行
    if (/^NAME(\s+STATE)?/i.test(line)) continue
    const trimmed = line.replace(/^﻿/, '')
    const isDefault = trimmed.startsWith('*')
    const body = isDefault ? trimmed.slice(1).trim() : trimmed
    const parts = body.split(/\s+/)
    // 期望：name state version（至少 3 段，末段为数字版本，倒数第 2 段为状态）
    if (parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1]) && stateRe.test(parts[parts.length - 2])) {
      distros.push({
        name: parts.slice(0, parts.length - 2).join(' '),
        state: parts[parts.length - 2],
        version: parts[parts.length - 1],
        isDefault,
      })
    }
  }
  return distros
}

// ── 读取目录 ──
export async function readDir(
  distName: string,
  linuxPath: string,
): Promise<{ ok: boolean; entries?: WslEntry[]; error?: string }> {
  const safe = (linuxPath || '/').replace(/\\/g, '/')
  const { stdout, code } = await runWsl(
    ['-d', distName, '--', 'ls', '-la', '--time-style=+%s', '--', safe],
    30000,
  )
  if (code !== 0) return { ok: false, error: stdout.slice(0, 400) || `exit code ${code}` }

  const lines = stdout.split(/\r?\n/)
  const entries: WslEntry[] = []
  for (const raw of lines) {
    const line = raw.replace(/^﻿/, '')
    if (!line.trim()) continue
    if (/^total\s+\d+/i.test(line)) continue // 跳过 total 行
    // 权限 链接数 所有者 组 大小 时间戳(秒) 名称
    const m = line.match(/^([bcdlsp-][rwxST-]{9})\s+(\d+)\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.*)$/)
    if (!m) continue
    const perms = m[1]
    const size = parseInt(m[3], 10) || 0
    const mtime = (parseInt(m[4], 10) || 0) * 1000
    let name = m[5]
    const isSymlink = perms.startsWith('l')
    if (isSymlink) {
      const idx = name.indexOf(' -> ')
      if (idx >= 0) name = name.slice(0, idx)
    }
    if (name === '.' || name === '..') continue
    const isDir = perms.startsWith('d')
    const base = safe === '/' ? '' : safe.replace(/\/$/, '')
    entries.push({
      name,
      path: base ? `${base}/${name}` : `/${name}`,
      isDir,
      isSymlink,
      size,
      mtime,
      perms,
    })
  }
  // 排序：目录优先，再按名称
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { ok: true, entries }
}

// ── 在资源管理器中打开 WSL 路径（UNC） ──
export async function openInExplorer(
  distName: string,
  linuxPath: string,
): Promise<SimpleResult> {
  const safe = (linuxPath || '/').replace(/\\/g, '/')
  const rel = safe === '/' ? '' : safe
  // Win10 用 \\wsl$\，Win11 用 \\wsl.localhost\，依次尝试
  const candidates = [
    `\\\\wsl$\\${distName}${rel}`,
    `\\\\wsl.localhost\\${distName}${rel}`,
  ]
  for (const p of candidates) {
    try {
      const r = await shell.openPath(p)
      if (!r) return { ok: true }
      // r 为非空错误描述，尝试下一个候选
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return { ok: false, error: 'explorer-open-failed' }
}

// ── 设为默认发行版 ──
export async function setDefaultDistro(name: string): Promise<SimpleResult> {
  const { stdout, code } = await runWsl(['-s', name], 15000)
  return { ok: code === 0, error: code === 0 ? undefined : stdout.slice(0, 300) }
}

// ── 终止发行版 ──
export async function terminateDistro(name: string): Promise<SimpleResult> {
  const { stdout, code } = await runWsl(['-t', name], 15000)
  return { ok: code === 0, error: code === 0 ? undefined : stdout.slice(0, 300) }
}

// ── 启动发行版（运行一次性命令确认已启动） ──
export async function startDistro(name: string): Promise<SimpleResult> {
  const { stdout, code } = await runWsl(['-d', name, 'echo', 'ok'], 20000)
  return { ok: code === 0, error: code === 0 ? undefined : stdout.slice(0, 300) }
}

// ── 导出发行版为 tar ──
export async function exportDistro(name: string, tarPath: string): Promise<SimpleResult & { filePath?: string }> {
  const { stdout, code } = await runWsl(['--export', name, tarPath], 600000)
  return { ok: code === 0, filePath: tarPath, error: code === 0 ? undefined : stdout.slice(0, 300) }
}

// ── 从 tar 导入发行版 ──
export async function importDistro(
  tarPath: string,
  installDir: string,
): Promise<SimpleResult & { name?: string }> {
  const base = path.basename(tarPath).replace(/\.tar$/i, '')
  const name = base || 'imported'
  const { stdout, code } = await runWsl(['--import', name, installDir, tarPath], 600000)
  return { ok: code === 0, name, error: code === 0 ? undefined : stdout.slice(0, 300) }
}
