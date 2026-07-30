import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { executeCleanerTask, type CleanerResult } from './cleaner'
import { isPathExcluded, logToDb, type CleanerRule } from './db'
import { getAiConfig } from './aiInsights'

export type CleanupCategory = 'recycle_bin' | 'temp' | 'browser_cache' | 'large_files' | 'old_files'
export type CleanupRisk = 'safe' | 'caution' | 'risky'
export type CleanupAction = 'system' | 'recycle'

export interface CleanupItem {
  id: string
  category: CleanupCategory
  title: string
  path: string
  size: number
  risk: CleanupRisk
  reason: string
  recommended: boolean
  action: CleanupAction
}

export interface AiCleanupScanResult {
  items: CleanupItem[]
  summary: string
  source: 'ollama' | 'openai' | 'heuristic'
  error?: string
}

export interface AiCleanupRunOptions {
  items: CleanupItem[]
}

export interface AiCleanupRunDetail {
  id: string
  ok: boolean
  message: string
  freedBytes: number
}

export interface AiCleanupRunResult {
  success: boolean
  freedBytes: number
  message: string
  details: AiCleanupRunDetail[]
}

export interface ScanOptions {
  largeThresholdMb: number
  oldDays: number
  maxItems: number
}

const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  largeThresholdMb: 500,
  oldDays: 180,
  maxItems: 30,
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

// Bounds to keep a scan from running forever on huge / pathological trees.
const MAX_SCAN_DIRS = 50000
const MAX_SCAN_DEPTH = 60

// Async, junction/symlink-aware, capped directory size calculation.
// The `visited` set holds realpaths so Windows reparse points (e.g. the
// "Application Data" -> "AppData" junction) cannot cause infinite recursion.
// Yielding every ~256 entries keeps the Electron main thread responsive, so
// the UI never shows as "Not Responding" while a large tree is walked.
async function dirSize(
  dir: string,
  visited: Set<string>,
  depth: number,
  stats: { dirs: number },
): Promise<number> {
  if (depth > MAX_SCAN_DEPTH || stats.dirs > MAX_SCAN_DIRS) return 0
  let real: string
  try {
    real = await fs.promises.realpath(dir)
  } catch {
    real = dir.toLowerCase()
  }
  if (visited.has(real)) return 0
  visited.add(real)
  stats.dirs++
  let total = 0
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let i = 0
  for (const entry of entries) {
    if (stats.dirs > MAX_SCAN_DIRS) return total
    const childPath = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) {
        total += await dirSize(childPath, visited, depth + 1, stats)
      } else if (entry.isFile()) {
        total += (await fs.promises.stat(childPath)).size
      }
    } catch {
      // ignore permission / access errors
    }
    if (++i % 256 === 0) await new Promise((r) => setImmediate(r))
  }
  return total
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

async function recycleBinSize(): Promise<number> {
  let total = 0
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  for (const letter of letters) {
    const bin = `${letter}:\\$Recycle.Bin`
    try {
      if (fs.existsSync(bin)) {
        const visited = new Set<string>()
        const stats = { dirs: 0 }
        total += await dirSize(bin, visited, 0, stats)
      }
    } catch {
      // ignore
    }
  }
  return total
}

async function tempSize(): Promise<number> {
  const targets = [
    os.tmpdir(),
    path.join(os.homedir(), 'AppData', 'Local', 'Temp'),
    'C:\\Windows\\Temp',
  ]
  let total = 0
  for (const target of targets) {
    if (target && fs.existsSync(target)) {
      try {
        const visited = new Set<string>()
        const stats = { dirs: 0 }
        total += await dirSize(target, visited, 0, stats)
      } catch {
        // ignore
      }
    }
  }
  return total
}

async function browserCacheSize(): Promise<number> {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const targets = [
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
  ]
  let total = 0
  for (const target of targets) {
    if (target && fs.existsSync(target)) {
      try {
        const visited = new Set<string>()
        const stats = { dirs: 0 }
        total += await dirSize(target, visited, 0, stats)
      } catch {
        // ignore
      }
    }
  }
  return total
}

// Recursively collect large / old files under `target`.
// Async + yields every ~256 entries so the main thread never freezes, and uses
// a realpath `visited` set + depth cap to avoid infinite loops through Windows
// junction/symlink reparse points. A file-count cap bounds the result pool.
async function scanLargeOldFiles(target: string, options: ScanOptions): Promise<CleanupItem[]> {
  const largeThresholdBytes = options.largeThresholdMb * 1024 * 1024
  const oldCutoff = Date.now() - options.oldDays * 24 * 60 * 60 * 1000
  const items: CleanupItem[] = []
  let scanned = 0
  const FILE_CAP = 50000
  const visited = new Set<string>()
  const stats = { dirs: 0 }

  const walk = async (dir: string, depth: number) => {
    if (scanned > FILE_CAP || depth > MAX_SCAN_DEPTH || stats.dirs > MAX_SCAN_DIRS) return
    let real: string
    try {
      real = await fs.promises.realpath(dir)
    } catch {
      real = dir.toLowerCase()
    }
    if (visited.has(real)) return
    visited.add(real)
    stats.dirs++
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    let i = 0
    for (const entry of entries) {
      if (scanned > FILE_CAP || depth > MAX_SCAN_DEPTH) return
      const childPath = path.join(dir, entry.name)
      const lower = childPath.toLowerCase()
      if (lower.includes('node_modules') || lower.includes('.git') || isPathExcluded(childPath)) {
        continue
      }
      try {
        if (entry.isDirectory()) {
          // Never follow symbolic links / junctions (cycle + cross-device safety).
          if (!entry.isSymbolicLink()) await walk(childPath, depth + 1)
        } else if (entry.isFile()) {
          scanned++
          const stat = await fs.promises.stat(childPath)
          if (stat.size >= largeThresholdBytes) {
            items.push({
              id: `large:${childPath}`,
              category: 'large_files',
              title: entry.name,
              path: childPath,
              size: stat.size,
              risk: 'caution',
              reason: '',
              recommended: false,
              action: 'recycle',
            })
          } else if (stat.mtimeMs < oldCutoff && stat.size > 0) {
            items.push({
              id: `old:${childPath}`,
              category: 'old_files',
              title: entry.name,
              path: childPath,
              size: stat.size,
              risk: 'risky',
              reason: '',
              recommended: false,
              action: 'recycle',
            })
          }
        }
      } catch {
        // ignore permission errors
      }
      if (++i % 256 === 0) await new Promise((r) => setImmediate(r))
    }
  }

  try {
    await walk(target, 0)
  } catch {
    // ignore
  }

  items.sort((a, b) => b.size - a.size)
  return items.slice(0, options.maxItems)
}

// ---------------------------------------------------------------------------
// AI analysis (reuses the same provider config as aiInsights)
// ---------------------------------------------------------------------------

interface AiItemVerdict {
  id: string
  risk: CleanupRisk
  reason: string
  recommended: boolean
}

// Local Ollama servers need a generous timeout: the first request to a model
// triggers model loading (qwen2.5 is ~4.7 GB) and /api/generate holds the HTTP
// response open until generation finishes, so the old 10s cap always timed out.
const AI_PROVIDER_TIMEOUT_MS = 60000
const AI_PROVIDER_MAX_ATTEMPTS = 2
const AI_PROVIDER_RETRY_DELAY_MS = 800

async function callWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message))
  )
}

function humanizeAiError(err: unknown): string {
  if (isTimeoutError(err)) {
    return 'AI 分析超时：本地模型加载或响应过慢'
  }
  return err instanceof Error ? err.message : String(err)
}

async function callAiProviderJson(prompt: string): Promise<{ summary: string; items: AiItemVerdict[] }> {
  const config = getAiConfig()
  const url =
    config.provider === 'openai'
      ? `${config.endpoint.replace(/\/$/, '')}/chat/completions`
      : `${config.endpoint.replace(/\/$/, '')}/api/generate`

  const body =
    config.provider === 'openai'
      ? JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        })
      : JSON.stringify({
          model: config.model,
          prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 1200 },
        })

  const headers: Record<string, string> =
    config.provider === 'openai'
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey || ''}` }
      : { 'Content-Type': 'application/json' }

  let lastErr: unknown
  for (let attempt = 1; attempt <= AI_PROVIDER_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await callWithTimeout(url, { method: 'POST', headers, body }, AI_PROVIDER_TIMEOUT_MS)
      if (!response.ok) {
        throw new Error(`AI 请求失败: ${response.status} ${response.statusText}`)
      }
      const data = (await response.json()) as
        | { response?: string; done?: boolean }
        | { choices?: { message?: { content?: string } }[] }
      const text =
        config.provider === 'openai'
          ? ((data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || '')
          : ((data as { response?: string }).response || '')

      const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim()
      const firstBrace = cleaned.indexOf('{')
      const lastBrace = cleaned.lastIndexOf('}')
      const jsonText =
        firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
          ? cleaned.slice(firstBrace, lastBrace + 1)
          : cleaned

      const parsed = JSON.parse(jsonText) as { summary?: string; items?: unknown[] }
      const list = Array.isArray(parsed.items) ? parsed.items : []
      const items = list
        .map((raw) => {
          const v = raw as Record<string, unknown>
          const risk = ['safe', 'caution', 'risky'].includes(String(v?.risk))
            ? (String(v?.risk) as CleanupRisk)
            : 'caution'
          return {
            id: String(v?.id || ''),
            risk,
            reason: String(v?.reason || ''),
            recommended: Boolean(v?.recommended),
          }
        })
        .filter((v) => v.id)
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : 'AI 未返回总结。',
        items,
      }
    } catch (err) {
      lastErr = err
      // Retry once on timeout: the first call often just warms up the local model.
      if (!isTimeoutError(err) || attempt >= AI_PROVIDER_MAX_ATTEMPTS) break
      await new Promise((r) => setTimeout(r, AI_PROVIDER_RETRY_DELAY_MS))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function buildPrompt(items: CleanupItem[]): string {
  const catalog = items
    .map(
      (it) =>
        `- id: ${it.id}\n  类别: ${it.category}\n  名称: ${it.title}\n  路径: ${it.path}\n  大小: ${formatBytes(it.size)}`,
    )
    .join('\n')
  return `你是一名磁盘清理专家。下面是 Windows 电脑扫描出的可清理项，请逐项评估清理风险并给出是否推荐清理。
风险等级说明：
- safe：系统垃圾，删除几乎无副作用（如回收站、临时文件）
- caution：清理后可能有轻微影响（如浏览器缓存会导致部分网站重新登录）
- risky：删除前需用户确认（如大文件、长期未修改的个人文件）

请以严格 JSON 输出，不要附加任何解释或 Markdown 代码块：
{
  "summary": "总体清理建议，80字内",
  "items": [
    {"id": "对应 id", "risk": "safe|caution|risky", "reason": "一句话说明", "recommended": true|false}
  ]
}

待评估项：
${catalog}`
}

function buildHeuristic(items: CleanupItem[]): { items: CleanupItem[]; summary: string } {
  const riskByCategory: Record<CleanupCategory, { risk: CleanupRisk; reason: string; recommended: boolean }> = {
    recycle_bin: { risk: 'safe', reason: '回收站内容，可安全清空', recommended: true },
    temp: { risk: 'safe', reason: '系统/用户临时文件，可安全清理', recommended: true },
    browser_cache: { risk: 'caution', reason: '浏览器缓存，清理后部分网站需重新登录', recommended: true },
    large_files: { risk: 'caution', reason: '大文件，请确认是否不再需要', recommended: false },
    old_files: { risk: 'risky', reason: '长期未修改的文件，删除前请确认', recommended: false },
  }

  const enriched = items.map((it) => {
    const meta = riskByCategory[it.category]
    return { ...it, risk: meta.risk, reason: meta.reason, recommended: meta.recommended }
  })

  const safeTotal = enriched.filter((i) => i.recommended).reduce((s, i) => s + i.size, 0)
  const summary = `共发现 ${enriched.length} 类可清理项，其中推荐清理 ${enriched.filter((i) => i.recommended).length} 项（约 ${formatBytes(safeTotal)}）。大文件与旧文件请在确认后清理。`
  return { items: enriched, summary }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scanAiCleanup(target?: string, options?: Partial<ScanOptions>): Promise<AiCleanupScanResult> {
  const opts: ScanOptions = { ...DEFAULT_SCAN_OPTIONS, ...options }

  const items: CleanupItem[] = []

  const rbSize = await recycleBinSize()
  items.push({
    id: 'system:recycle_bin',
    category: 'recycle_bin',
    title: '回收站',
    path: '',
    size: rbSize,
    risk: 'safe',
    reason: '',
    recommended: true,
    action: 'system',
  })

  const tmpSize = await tempSize()
  items.push({
    id: 'system:temp',
    category: 'temp',
    title: '系统临时文件',
    path: '',
    size: tmpSize,
    risk: 'safe',
    reason: '',
    recommended: true,
    action: 'system',
  })

  const cacheSize = await browserCacheSize()
  items.push({
    id: 'system:browser_cache',
    category: 'browser_cache',
    title: '浏览器缓存',
    path: '',
    size: cacheSize,
    risk: 'caution',
    reason: '',
    recommended: true,
    action: 'system',
  })

  if (target && fs.existsSync(target)) {
    items.push(...(await scanLargeOldFiles(target, opts)))
  }

  const config = getAiConfig()
  const useAi = config.provider === 'openai' || (config.provider === 'ollama' && !!config.endpoint)

  let aiError: string | undefined
  if (useAi) {
    try {
      const analyzed = await callAiProviderJson(buildPrompt(items))
      const verdictById = new Map(analyzed.items.map((v) => [v.id, v]))
      const enriched = items.map((it) => {
        const v = verdictById.get(it.id)
        if (!v) return it
        return { ...it, risk: v.risk, reason: v.reason, recommended: v.recommended }
      })
      return {
        items: enriched,
        summary: analyzed.summary,
        source: config.provider as 'ollama' | 'openai',
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      aiError = humanizeAiError(err)
      logToDb('error', 'aiCleanup', 'AI 分析失败，降级为启发式', raw)
    }
  }

  const heuristic = buildHeuristic(items)
  return {
    items: heuristic.items,
    summary: heuristic.summary,
    source: 'heuristic',
    error: aiError,
  }
}

function mapCategoryToCleanerType(category: CleanupCategory): CleanerRule['type'] | null {
  switch (category) {
    case 'recycle_bin':
      return 'recycle_bin'
    case 'temp':
      return 'temp_dir'
    case 'browser_cache':
      return 'browser_cache'
    default:
      return null
  }
}

// Move a file or folder to the Windows Recycle Bin (recoverable).
function sendToRecycleBin(targetPath: string): Promise<CleanerResult> {
  return new Promise((resolve) => {
    const escaped = targetPath.replace(/'/g, "''")
    const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, encoding: 'utf8' },
      (err) => {
        if (err) {
          resolve({ success: false, freedBytes: 0, message: `移入回收站失败: ${targetPath} (${err.message})` })
        } else {
          resolve({ success: true, freedBytes: 0, message: `已移入回收站: ${targetPath}` })
        }
      },
    )
  })
}

export async function runAiCleanup(payload: AiCleanupRunOptions): Promise<AiCleanupRunResult> {
  const details: AiCleanupRunDetail[] = []
  let totalFreed = 0
  let allOk = true

  for (const item of payload.items) {
    try {
      if (item.action === 'system') {
        const type = mapCategoryToCleanerType(item.category)
        if (!type) {
          details.push({ id: item.id, ok: false, message: '未知清理类型', freedBytes: 0 })
          allOk = false
          continue
        }
        const result: CleanerResult = await executeCleanerTask(type, item.path || undefined)
        details.push({ id: item.id, ok: result.success, message: result.message, freedBytes: result.freedBytes })
        if (result.success) totalFreed += result.freedBytes
        else allOk = false
      } else {
        // recycle action: send to Recycle Bin (recoverable)
        const result = await sendToRecycleBin(item.path)
        details.push({ id: item.id, ok: result.success, message: result.message, freedBytes: item.size })
        if (result.success) totalFreed += item.size
        else allOk = false
      }
    } catch (err) {
      details.push({ id: item.id, ok: false, message: String(err), freedBytes: 0 })
      allOk = false
    }
  }

  const message = allOk
    ? `清理完成，共释放约 ${formatBytes(totalFreed)}`
    : `清理部分完成，共释放约 ${formatBytes(totalFreed)}，存在失败项`
  return { success: allOk, freedBytes: totalFreed, message, details }
}
