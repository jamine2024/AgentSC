/**
 * 全盘文件搜索：索引编排器（主进程单例）
 *
 * 职责：
 * 1. init()：确保 schema；若无任何索引则后台启动全盘爬取；否则标记 ready 并安排增量。
 * 2. 后台建索：crawler 遍历所有本地盘，分批入库，过程中不阻塞查询。
 * 3. 增量更新：
 *    - 定时（默认 6h）整盘重扫，保证与磁盘一致；
 *    - chokidar 监听「用户主目录 + 已监控路径」，实时 upsert / 删除单条，热门位置近实时。
 * 4. query / rebuild / getStatus 供 IPC 调用。
 */

import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  initFileSearchDb,
  queryFiles,
  countFiles,
  clearAllFiles,
  upsertFile,
  deleteFile,
} from './db'
import { crawlAll, getFixedDrives } from './crawler'
import { db, logToDb } from '../db'
import type { FileResult, FileSearchStatus } from './types'

// 全盘重扫策略：整盘爬取是重 IO + 大量 FTS 写入的操作，旧版固定每 6h 无条件
// 重扫一次，长时间挂机的机器每隔几小时就磁盘抖动一轮。现在改为：
//   - 默认关闭（0），完全依赖 chokidar 增量事件维持索引新鲜度；
//   - 需要周期性兜底的用户可设置 filesearch_reindex_hours（如 24）打开，
//     到期后每小时检查一次是否触发。
const REINDEX_CHECK_INTERVAL_MS = 60 * 60 * 1000

function getReindexHours(): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'filesearch_reindex_hours'").get() as
      | { value: string }
      | undefined
    if (!row) return 0
    const v = JSON.parse(row.value)
    return typeof v === 'number' && v > 0 ? v : 0
  } catch {
    return 0
  }
}

class FileSearchIndexer {
  private indexing = false
  private ready = false
  private needsFullCrawl = false
  private scanned = 0
  private drives: string[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private initDone = false
  private lastCrawlAt = 0
  private reindexTimer: ReturnType<typeof setInterval> | null = null
  private watcher: FSWatcher | null = null

  init(): void {
    if (this.initDone) return
    this.initDone = true
    initFileSearchDb()
    const count = countFiles()
    if (count === 0) {
      // 全盘爬取不在启动窗口内立刻跑：即使已分片节拍化，它仍是持续的重 IO。
      // 延后 90s（或用户首次打开全局搜索时立即触发），保证启动后的前一分多钟
      // 界面绝对流畅。旧版在这里直接 startFullCrawl，是「界面容易卡死」的元凶。
      this.needsFullCrawl = true
      setTimeout(() => this.ensureCrawlStarted(), 90_000)
    } else {
      this.ready = true
      // 已有索引视为新鲜起点，周期性重扫从现在起算
      this.lastCrawlAt = Date.now()
      this.scheduleReindex()
      this.startWatching()
    }
  }

  /** 全盘爬取的惰性启动点：90s 延迟兜底，或全局搜索首次访问时提前触发 */
  ensureCrawlStarted(): void {
    if (!this.needsFullCrawl || this.indexing) return
    this.needsFullCrawl = false
    this.startFullCrawl()
  }

  /** 串行化建索 / 实时更新，避免并发写导致 FTS 异常 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private startFullCrawl(): void {
    this.needsFullCrawl = false
    this.enqueue(async () => {
      if (this.indexing) return
      this.indexing = true
      this.ready = false
      this.scanned = 0
      logToDb('info', 'filesearch', '开始全盘文件索引')
      try {
        const result = await crawlAll((c) => {
          this.scanned = c
        })
        this.drives = result.drives
        this.ready = true
        logToDb('info', 'filesearch', '全盘索引完成', `文件总数=${result.total}`)
      } catch (err) {
        logToDb('error', 'filesearch', '全盘索引失败', String(err))
      } finally {
        this.indexing = false
        this.lastCrawlAt = Date.now()
        this.cachedCount = { at: 0, value: 0 }
        this.scheduleReindex()
        this.startWatching()
      }
    })
  }

  /** 清空并重新建索（渲染端「重建索引」按钮） */
  rebuild(): void {
    clearAllFiles()
    this.cachedCount = { at: 0, value: 0 }
    this.startFullCrawl()
  }

  query(q: string, topK = 50): FileResult[] {
    // query / getStatus 是全局搜索仅有的两个消费入口，兼作惰性建索触发点：
    // 首次打开搜索面板或输入时立即开始建索，不必等 90s 兜底定时器。
    this.ensureCrawlStarted()
    try {
      return queryFiles(q, topK)
    } catch (err) {
      logToDb('error', 'filesearch', '查询失败', String(err))
      return []
    }
  }

  // 文件总数缓存：全局搜索面板打开时会以 800ms 周期轮询 status，
  // 而 countFiles() 是整表 COUNT —— 百万级索引下这是实打实的全表扫描，
  // 每 0.8s 在主线程上跑一次会明显拖慢搜索输入。总数变化极慢，缓存 10s 足够。
  private cachedCount = { at: 0, value: 0 }

  private getFileCount(): number {
    // 建索中不做整表 COUNT：百万级 files 表上这是一次几百毫秒的同步全表扫描，
    // 而搜索面板每 800ms 就会拉一次 status。期间直接用缓存的旧值即可。
    if (this.indexing) return this.cachedCount.value
    const now = Date.now()
    if (now - this.cachedCount.at < 10_000) return this.cachedCount.value
    const value = countFiles()
    this.cachedCount = { at: now, value }
    return value
  }

  getStatus(): FileSearchStatus {
    this.ensureCrawlStarted()
    return {
      ready: this.ready,
      indexing: this.indexing,
      fileCount: this.getFileCount(),
      scannedCount: this.scanned,
      drives: this.drives,
    }
  }

  private scheduleReindex(): void {
    if (this.reindexTimer) clearInterval(this.reindexTimer)
    // 每小时检查一次是否到期；默认（设置=0）永不触发整盘重扫
    this.reindexTimer = setInterval(() => {
      if (this.indexing || !this.ready) return
      const hours = getReindexHours()
      if (hours > 0 && Date.now() - this.lastCrawlAt >= hours * 3600 * 1000) {
        logToDb('info', 'filesearch', '周期性全盘重扫触发', `interval=${hours}h`)
        this.startFullCrawl()
      }
    }, REINDEX_CHECK_INTERVAL_MS)
    ;(this.reindexTimer as unknown as { unref?: () => void }).unref?.()
  }

  private startWatching(): void {
    if (this.watcher) return
    const roots = this.getWatchRoots()
    if (roots.length === 0) return
    try {
      this.watcher = chokidar.watch(roots, {
        ignoreInitial: true,
        // 深度收敛：99 ≈ 无限递归。Windows 上 chokidar 每个被监听目录占一个原生
        // watch 句柄（内含缓冲），用户主目录浅层目录数量巨大 —— 深度 8 已覆盖
        // 桌面/文档/下载等常用树，同时显著压低句柄数与内存。深层目录靠全盘索引兜底。
        depth: 8,
        // Windows 用户主目录下存在大量 junction 别名（Application Data / Cookies /
        // Local Settings / AppData\Local\Application Data 等），fs.watch 会抛 EPERM。
        // 开启 ignorePermissionErrors 让 chokidar 静默跳过，避免未捕获 promise rejection。
        ignorePermissionErrors: true,
        ignored: (p: string) => {
          const lp = p.toLowerCase()
          // Windows 受保护 / 循环 junction 目录，fs.watch 必抛 EPERM
          if (/(?:^|[\\/])(application data|cookies|local settings|appdata)([\\/]|$)/i.test(lp))
            return true
          // 隐藏目录（点开头但非 . 或 ..）整体跳过，避免递归进 .git / .cache 等
          if (/(?:^|[\\/])\.[^\\/]/.test(p)) return true
          return (
            lp.includes('$recycle.bin') ||
            lp.includes('system volume information') ||
            lp.includes('node_modules')
          )
        },
      })
      this.watcher
        .on('add', (p) => this.indexOne(p, false))
        .on('addDir', (p) => this.indexOne(p, true))
        .on('change', (p) => this.indexOne(p, false))
        .on('unlink', (p) => deleteFile(p))
        .on('unlinkDir', (p) => deleteFile(p))
        .on('error', (err) => logToDb('warn', 'filesearch', 'chokidar 监听错误', String(err)))
    } catch (err) {
      logToDb('warn', 'filesearch', 'chokidar 监听启动失败', String(err))
    }
  }

  private getWatchRoots(): string[] {
    const roots: string[] = []
    try {
      const home = process.env.USERPROFILE || process.env.HOME || ''
      if (home) roots.push(home)
    } catch {
      /* ignore */
    }
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'watcher_config'").get() as
        | { value: string }
        | undefined
      if (row?.value) {
        const cfg = JSON.parse(row.value) as { paths?: string[] }
        if (Array.isArray(cfg.paths)) roots.push(...cfg.paths)
      }
    } catch {
      /* ignore */
    }
    return Array.from(new Set(roots))
  }

  private indexOne(p: string, isDir: boolean): void {
    this.enqueue(async () => {
      try {
        const st = await fs.promises.lstat(p)
        const parent = path.dirname(p)
        const ext = isDir ? '' : path.extname(p).toLowerCase()
        const drive = path.parse(p).root.replace(/\\$/, '').toUpperCase()
        upsertFile({
          name: path.basename(p),
          path: p,
          parent,
          ext,
          size: st.size,
          mtime: Math.floor(st.mtimeMs),
          is_dir: isDir ? 1 : 0,
          drive,
        })
      } catch {
        /* ignore */
      }
    })
  }
}

export const fileSearchIndexer = new FileSearchIndexer()
export { getFixedDrives }
