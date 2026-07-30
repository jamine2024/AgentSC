import chokidar from 'chokidar'
import path from 'node:path'
import fs from 'node:fs'
import { BrowserWindow, Notification } from 'electron'
import { insertEvents, isPathExcluded, db, FileEventRow, logToDb } from './db'
import { stopProcessTracking, lookupProcess, getProcessTrackerStatus } from './processTracker'

export interface WatcherConfig {
  paths: string[]
  enabled: boolean
}

let watchers: chokidar.FSWatcher[] = []
let mainWindow: BrowserWindow | null = null

// ====== 事件缓冲 & 批量处理 ======
const BATCH_INTERVAL_MS = 2000        // 每 2 秒批量写一次 DB（后台操作，不影响体验）
const IPC_BATCH_INTERVAL_MS = 500    // 每 500ms 批量发一次 IPC 给渲染端（之前 300ms）
const PATH_DEBOUNCE_MS = 200          // 同一路径 200ms 内只保留最新事件
const MAX_BATCH_SIZE = 500            // 单批最大 500 条
const IPC_BATCH_LIMIT = 50            // 给渲染进程的单批上限（之前 100）

const pendingEvents: FileEventRow[] = []
const pendingIpcEvents: FileEventRow[] = []
const recentPaths = new Map<string, number>()  // path -> last timestamp

let batchTimer: NodeJS.Timeout | null = null
let ipcBatchTimer: NodeJS.Timeout | null = null

function flushDbBatch() {
  if (pendingEvents.length === 0) return
  const batch = pendingEvents.splice(0, MAX_BATCH_SIZE)
  try {
    insertEvents(batch)
  } catch (err) {
    logToDb('error', 'watcher', '事件批量写入失败', String(err))
  }
}

function flushIpcBatch() {
  if (pendingIpcEvents.length === 0) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingIpcEvents.length = 0
    return
  }
  const batch = pendingIpcEvents.splice(0, IPC_BATCH_LIMIT)
  mainWindow.webContents.send('file-events-batch', batch)
}

function ensureBatchTimers() {
  if (!batchTimer) {
    batchTimer = setInterval(flushDbBatch, BATCH_INTERVAL_MS)
    batchTimer.unref()
  }
  if (!ipcBatchTimer) {
    ipcBatchTimer = setInterval(flushIpcBatch, IPC_BATCH_INTERVAL_MS)
    ipcBatchTimer.unref()
  }
}

function stopBatchTimers() {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null }
  if (ipcBatchTimer) { clearInterval(ipcBatchTimer); ipcBatchTimer = null }
  // 清空缓冲
  if (pendingEvents.length > 0) flushDbBatch()
  if (pendingIpcEvents.length > 0) flushIpcBatch()
  recentPaths.clear()
}
// =================================

// recentPaths 仅用于 200ms 去重，但长时运行会持续累积不同路径而无法收敛。
// 定期删除过期（> 60s）条目；极端情况下仍过大则整体重置（仅影响去重，可接受）。
const RECENT_PATHS_MAX_AGE_MS = 60_000
const RECENT_PATHS_SWEEP_EVERY = 1000
const RECENT_PATHS_HARD_CAP = 200_000
let recentPathsWrites = 0
function sweepRecentPaths(): void {
  const now = Date.now()
  for (const [p, ts] of recentPaths) {
    if (now - ts > RECENT_PATHS_MAX_AGE_MS) recentPaths.delete(p)
  }
  if (recentPaths.size > RECENT_PATHS_HARD_CAP) recentPaths.clear()
}

function getDrive(filePath: string) {
  const parsed = path.parse(filePath)
  return parsed.root.toUpperCase()
}

function getDay(timestamp: number) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function getSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.promises.stat(filePath)
    return stat.isDirectory() ? 0 : stat.size
  } catch {
    return 0
  }
}

function shouldSkip(filePath: string) {
  const lower = filePath.toLowerCase()
  if (lower.includes('node_modules')) return true
  if (lower.includes('.git')) return true
  if (lower.includes('\\$recycle.bin\\')) return true
  if (isPathExcluded(filePath)) return true
  return false
}

function getLargeFileThreshold(): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'large_file_threshold_mb'").get() as { value: string } | undefined
    if (!row) return 100
    const val = JSON.parse(row.value)
    return typeof val === 'number' && val > 0 ? val : 100
  } catch {
    return 100
  }
}

async function recordEvent(
  type: 'created' | 'modified' | 'deleted' | 'renamed',
  filePath: string,
) {
  if (shouldSkip(filePath)) return

  const timestamp = Date.now()

  // 同一路径短时间内的重复事件去重（如编辑保存时的多次 modify）
  const lastTs = recentPaths.get(filePath)
  if (lastTs && (timestamp - lastTs) < PATH_DEBOUNCE_MS) return
  recentPaths.set(filePath, timestamp)
  if (++recentPathsWrites % RECENT_PATHS_SWEEP_EVERY === 0) sweepRecentPaths()

  const size = type === 'deleted' ? 0 : await getSize(filePath)
  const drive = getDrive(filePath)
  const day = getDay(timestamp)
  const proc = lookupProcess(filePath)

  const row: FileEventRow = {
    type,
    path: filePath,
    size,
    process_name: proc?.processName,
    process_id: proc?.pid,
    drive,
    recorded_at: timestamp,
    day,
  }

  pendingEvents.push(row)
  pendingIpcEvents.push(row)

  // 大文件检测与通知（立即处理，不缓冲）
  if (type === 'created' && size > 0) {
    const thresholdMB = getLargeFileThreshold()
    if (thresholdMB > 0 && size > thresholdMB * 1024 * 1024) {
      const sizeStr = size >= 1024 * 1024 * 1024
        ? `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`
      const title = '检测到大文件'
      const body = `${filePath}\n大小: ${sizeStr}${proc?.processName ? ` | 进程: ${proc.processName}` : ''}`
      if (Notification.isSupported()) {
        const notif = new Notification({ title, body })
        notif.show()
        notif.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show()
            mainWindow.focus()
          }
        })
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toast-notification', { title, body, timestamp: Date.now() })
      }
    }
  }
}

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win
}

// chokidar 的 ignored 默认采用 glob (anymatch) 引擎——它**仍要先 walk 目录树再
// 过滤**。对于常见重型目录（node_modules / .git / AppData / Caches / 构建产物），
// 我们额外提供一个 function matcher，在 walker 列举子目录的那一刻立即短路，
// 让这些子树根本不进入递归，从而避免在 Windows 上注册海量 watch handle 并阻塞
// 主进程事件循环（表现为"软件装起来就卡死"）。
const HEAVY_DIR_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'appdata', '$recycle.bin', 'programdata',
  'program files', 'program files (x86)',
  'cache', 'caches', '.cache', '.npm', '.next', '.nuxt', '.parcel-cache',
  '.turbo', '.pnpm-store', '.vscode', '.idea', '.gradle', '.m2', 'target',
  '.docker', 'containers',
])

function isHeavyDirSegment(segment: string): boolean {
  if (!segment) return false
  const lower = segment.toLowerCase()
  if (HEAVY_DIR_NAMES.has(lower)) return true
  // 隐藏目录（点开头但不是 "." / ".."）一律跳过
  if (lower.length > 1 && lower.startsWith('.')) return true
  return false
}

function containsHeavyDir(absPath: string): boolean {
  const sep = absPath.includes('\\') ? '\\' : '/'
  for (const seg of absPath.split(sep)) {
    if (isHeavyDirSegment(seg)) return true
  }
  return false
}

export async function startWatching(config: WatcherConfig) {
  await stopWatching()

  if (!config.enabled || config.paths.length === 0) return

  ensureBatchTimers()
  // 注意：processTracker 的启动不在这里——由 main.ts 的 startBackgroundInit 链路统一
  // 根据时机（首启延后 / 用户主动启用）显式调用，避免和 watcher 同时轰主进程。

  for (const p of config.paths) {
    if (!fs.existsSync(p)) continue

    const watcher = chokidar.watch(p, {
      ignored: [
        // 1. function matcher：最重一档，walker 列举时立即短路（高优先级）
        (filePath: string) => containsHeavyDir(filePath),
        // 2. 兜底 glob：覆盖系统/特殊目录
        /(^|[/\\])\../,
        '**/Application Data/**',
        '**/Cookies/**',
        '**/Local Settings/**',
        '**/NetHood/**',
        '**/PrintHood/**',
        '**/Recent/**',
        '**/SendTo/**',
        '**/Start Menu/**',
        '**/Templates/**',
        '**/Documents and Settings/**',
        '**/Windows/**',
        '**/Program Files/**',
        '**/Program Files (x86)/**',
        '**/ProgramData/**',
        '**/AppData/**',
        '**/$Recycle.Bin/**',
        '**/node_modules/**',
        '**/.git/**',
      ],
      ignoreInitial: true,
      persistent: true,
      // depth 从 8 → 4：默认监控用户桌面/下载/文档目录时，绝大多数文件在 4 层以内。
      // 单条深路径可在追踪路径页单独设置 maxDepth 时不受此处限制（chokidar 这边仅
      // 给个保守默认）。如确需更深，由用户在追踪路径页面单独配置子目录，避开根监控。
      depth: 4,
      followSymlinks: false,
      usePolling: false,
      // Windows 用户目录下存在 junction 别名（Application Data / Cookies 等），
      // fs.watch 会抛 EPERM；开启后 chokidar 静默跳过，避免未捕获 promise rejection。
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    })

    watcher
      .on('add', (filePath) => recordEvent('created', filePath))
      .on('change', (filePath) => recordEvent('modified', filePath))
      .on('unlink', (filePath) => recordEvent('deleted', filePath))
      .on('addDir', () => {})
      .on('unlinkDir', () => {})
      .on('error', (err) => logToDb('error', 'watcher', `监控器错误: ${p}`, String(err)))

    watchers.push(watcher)
  }
}

export async function stopWatching() {
  await Promise.all(watchers.map((w) => w.close()))
  watchers = []
  stopBatchTimers()
  stopProcessTracking()
}

export function getWatcherStatus() {
  return {
    active: watchers.length > 0,
    paths: watchers.map((_, i) => `watcher-${i}`),
    processTracker: getProcessTrackerStatus(),
  }
}
