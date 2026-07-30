import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import schedule from 'node-schedule'
import {
  CleanerRule,
  getCleanerRules,
  updateCleanerRule,
  insertCleanerLog,
  logToDb,
} from './db'

export interface CleanerResult {
  success: boolean
  freedBytes: number
  message: string
}

const scheduledJobs = new Map<number, schedule.Job>()

function getDirectorySize(dirPath: string): number {
  let total = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const childPath = path.join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          total += getDirectorySize(childPath)
        } else if (entry.isFile()) {
          total += fs.statSync(childPath).size
        }
      } catch {
        // ignore permission / access errors
      }
    }
  } catch {
    // ignore
  }
  return total
}

function deleteDirectoryContents(dirPath: string): void {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const childPath = path.join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          deleteDirectoryContents(childPath)
          fs.rmdirSync(childPath)
        } else {
          fs.unlinkSync(childPath)
        }
      } catch {
        // ignore in-use / permission errors
      }
    }
  } catch {
    // ignore
  }
}

// 展开路径中的环境变量：支持 %VAR% 与 ${VAR}（用于互联网规则清单中的可移植路径）
function expandEnvVars(p: string): string {
  if (!p) return p
  return p
    .replace(/%([^%]+)%/g, (_m, k: string) => process.env[k] || '')
    .replace(/\$\{([^}]+)\}/g, (_m, k: string) => process.env[k] || '')
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp('^' + escaped + '$', 'i')
}

function fileMatchesAny(name: string, patterns: string): boolean {
  const globs = patterns
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  if (globs.length === 0) return true
  return globs.some((g) => globToRegExp(g).test(name))
}

// 仅删除匹配 pattern 的文件，保留目录结构——比整目录清空更安全，
// 适合从互联网导入的自定义规则（只清理特定临时/缓存文件）。
function deleteMatchingFiles(dirPath: string, patterns: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const childPath = path.join(dirPath, entry.name)
    try {
      if (entry.isDirectory()) {
        deleteMatchingFiles(childPath, patterns)
      } else if (entry.isFile() && fileMatchesAny(entry.name, patterns)) {
        fs.unlinkSync(childPath)
      }
    } catch {
      // ignore in-use / permission errors
    }
  }
}

function getRecycleBinSize(): number {
  let total = 0
  try {
    const drives = ['C:', 'D:', 'E:']
    for (const drive of drives) {
      const binPath = `${drive}\\$Recycle.Bin`
      if (fs.existsSync(binPath)) {
        total += getDirectorySize(binPath)
      }
    }
  } catch {
    // ignore permission / access errors
  }
  return total
}

export async function cleanRecycleBin(): Promise<CleanerResult> {
  return new Promise((resolve) => {
    const before = getRecycleBinSize()

    // 修复点：
    // 1. 强制 PowerShell 输出 UTF-8，避免中文 Windows 错误信息被 Node 以 utf8
    //    解码 GBK 字节而产生乱码。
    // 2. 只清理存在 $Recycle.Bin 的盘，并忽略回收站为空时常见的
    //    "系统找不到指定的文件" 非致命错误。
    // 3. 以清空前后回收站实际大小为最终成功依据，避免 PowerShell 误报失败。
    const psScript = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$ErrorActionPreference = "Stop"',
      '$failed = @()',
      '$drives = (Get-PSDrive -PSProvider FileSystem).Name',
      'foreach ($d in $drives) {',
      '  $binPath = "$d`:\\$Recycle.Bin"',
      '  if (-not (Test-Path $binPath)) { continue }',
      '  try {',
      '    Clear-RecycleBin -DriveLetter $d -Force -ErrorAction Stop',
      '  } catch {',
      '    $msg = $_.Exception.Message',
      '    if ($msg -notlike "*系统找不到指定的文件*") {',
      '      $failed += ("ERR:" + $d + " - " + $msg)',
      '    }',
      '  }',
      '}',
      'if ($failed.Count -eq 0) { "RESULT:OK" }',
      'else { "RESULT:FAILED"; $failed }',
    ].join('\n')

    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const after = getRecycleBinSize()
        const out = (stdout || '').toString()
        const errOut = (stderr || '').toString()

        // 以回收站实际剩余大小作为最终成功依据：完全清空或大小减小都算成功，
        // 避免 PowerShell 在回收站已空时返回 "系统找不到指定的文件" 导致误报失败。
        if (after === 0 || after < before) {
          resolve({
            success: true,
            freedBytes: Math.max(0, before - after),
            message: after === 0 ? '回收站已清空' : '回收站已部分清空',
          })
          return
        }

        if (out.includes('RESULT:OK')) {
          resolve({ success: true, freedBytes: 0, message: '回收站已清空' })
        } else if (out.includes('RESULT:FAILED')) {
          const reasons = out
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.startsWith('ERR:'))
            .map((l) => l.slice(4))
          resolve({
            success: false,
            freedBytes: 0,
            message: '清空回收站失败：' + (reasons.join('；') || errOut || err?.message || '未知错误'),
          })
        } else {
          // 脚本未输出预期标记（如 powershell 本身崩溃/被拦截）
          resolve({
            success: false,
            freedBytes: 0,
            message: '清空回收站失败：' + (errOut || err?.message || 'PowerShell 未返回预期结果'),
          })
        }
      },
    )
  })
}

export async function clearIEHistory(): Promise<CleanerResult> {
  return new Promise((resolve) => {
    execFile(
      'RunDll32.exe',
      ['InetCpl.cpl,ClearMyTracksByProcess', '255'],
      { windowsHide: true },
      (err) => {
        if (err) {
          resolve({ success: false, freedBytes: 0, message: '清理 IE 记录失败：' + err.message })
        } else {
          resolve({ success: true, freedBytes: 0, message: 'IE / Edge 历史记录已清理' })
        }
      },
    )
  })
}

export async function cleanTempDirectories(): Promise<CleanerResult> {
  const targets = [
    os.tmpdir(),
    path.join(os.homedir(), 'AppData', 'Local', 'Temp'),
    'C:\\Windows\\Temp',
  ]
  let freed = 0
  const messages: string[] = []
  for (const target of targets) {
    if (!target || !fs.existsSync(target)) continue
    try {
      const before = getDirectorySize(target)
      deleteDirectoryContents(target)
      const after = getDirectorySize(target)
      freed += Math.max(0, before - after)
    } catch (err) {
      messages.push(String(err))
    }
  }
  const message = messages.length > 0 ? '部分临时目录清理失败：' + messages.join('; ') : '常见临时目录已清理'
  return { success: messages.length === 0, freedBytes: freed, message }
}

export async function cleanBrowserCache(): Promise<CleanerResult> {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const targets = [
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
  ]
  let freed = 0
  const messages: string[] = []
  for (const target of targets) {
    if (!fs.existsSync(target)) continue
    try {
      const before = getDirectorySize(target)
      deleteDirectoryContents(target)
      const after = getDirectorySize(target)
      freed += Math.max(0, before - after)
    } catch (err) {
      messages.push(String(err))
    }
  }
  const message = messages.length > 0 ? '部分浏览器缓存清理失败：' + messages.join('; ') : '浏览器缓存已清理'
  return { success: messages.length === 0, freedBytes: freed, message }
}

export async function cleanCustomDirectory(dirPath: string, patterns?: string): Promise<CleanerResult> {
  const resolved = expandEnvVars(dirPath)
  if (!fs.existsSync(resolved)) {
    return { success: false, freedBytes: 0, message: '目录不存在：' + resolved }
  }
  try {
    const before = getDirectorySize(resolved)
    if (patterns && patterns.trim()) {
      deleteMatchingFiles(resolved, patterns)
    } else {
      deleteDirectoryContents(resolved)
    }
    const after = getDirectorySize(resolved)
    const freed = Math.max(0, before - after)
    const scope = patterns && patterns.trim() ? `（匹配 ${patterns.trim()}）` : ''
    return { success: true, freedBytes: freed, message: '目录已清理：' + resolved + scope }
  } catch (err) {
    return { success: false, freedBytes: 0, message: '清理失败：' + String(err) }
  }
}

export async function executeCleanerTask(
  type: CleanerRule['type'],
  target?: string,
  patterns?: string,
): Promise<CleanerResult> {
  switch (type) {
    case 'recycle_bin':
      return cleanRecycleBin()
    case 'ie_history':
      return clearIEHistory()
    case 'temp_dir':
      return cleanTempDirectories()
    case 'browser_cache':
      return cleanBrowserCache()
    case 'custom':
      return target
        ? cleanCustomDirectory(target, patterns || undefined)
        : { success: false, freedBytes: 0, message: '自定义目录未指定' }
    default:
      return { success: false, freedBytes: 0, message: '未知清理类型' }
  }
}

export async function runCleanerRule(rule: CleanerRule): Promise<CleanerResult> {
  const startedAt = Date.now()
  const result = await executeCleanerTask(rule.type, rule.target, rule.patterns || undefined)
  const finishedAt = Date.now()

  insertCleanerLog({
    rule_id: rule.id,
    type: rule.type,
    name: rule.name,
    status: result.success ? 'success' : 'failed',
    message: result.message,
    freed_bytes: result.freedBytes,
    started_at: startedAt,
    finished_at: finishedAt,
  })

  if (rule.id !== undefined) {
    updateCleanerRule(rule.id, {
      last_run: finishedAt,
      next_run: computeNextRun(rule.schedule),
    })
  }

  return result
}

function computeNextRun(scheduleExpr: string): number | null {
  try {
    const temp = schedule.scheduleJob(scheduleExpr, () => {})
    const next = temp.nextInvocation()
    temp.cancel()
    return next ? next.getTime() : null
  } catch {
    return null
  }
}

export function scheduleCleanerRules(rules?: CleanerRule[]) {
  // cancel existing
  for (const [id, job] of scheduledJobs) {
    job.cancel()
    scheduledJobs.delete(id)
  }

  const list = rules || getCleanerRules()
  for (const rule of list) {
    if (!rule.enabled || !rule.id) continue
    try {
      const job = schedule.scheduleJob(rule.schedule, () => {
        runCleanerRule(rule).catch((err) => logToDb('error', 'cleaner', '清理规则执行失败', String(err)))
      })
      if (job) {
        scheduledJobs.set(rule.id, job)
        const next = job.nextInvocation()
        updateCleanerRule(rule.id, { next_run: next ? next.getTime() : null })
      }
    } catch (err) {
      logToDb('error', 'cleaner', '清理规则定时调度失败', `${rule.name}(${rule.schedule}): ${String(err)}`)
    }
  }
}

export function reloadCleanerRules() {
  scheduleCleanerRules(getCleanerRules())
}

export function getCleanerScheduleStatus() {
  return {
    scheduledCount: scheduledJobs.size,
    rules: Array.from(scheduledJobs.entries()).map(([id, job]) => ({
      id,
      nextRun: job.nextInvocation()?.getTime(),
    })),
  }
}
