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

const REINDEX_INTERVAL_MS = 6 * 60 * 60 * 1000

class FileSearchIndexer {
  private indexing = false
  private ready = false
  private scanned = 0
  private drives: string[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private initDone = false
  private reindexTimer: ReturnType<typeof setInterval> | null = null
  private watcher: FSWatcher | null = null

  init(): void {
    if (this.initDone) return
    this.initDone = true
    initFileSearchDb()
    const count = countFiles()
    if (count === 0) {
      this.startFullCrawl()
    } else {
      this.ready = true
      this.scheduleReindex()
      this.startWatching()
    }
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
        this.scheduleReindex()
        this.startWatching()
      }
    })
  }

  /** 清空并重新建索（渲染端「重建索引」按钮） */
  rebuild(): void {
    clearAllFiles()
    this.startFullCrawl()
  }

  query(q: string, topK = 50): FileResult[] {
    try {
      return queryFiles(q, topK)
    } catch (err) {
      logToDb('error', 'filesearch', '查询失败', String(err))
      return []
    }
  }

  getStatus(): FileSearchStatus {
    return {
      ready: this.ready,
      indexing: this.indexing,
      fileCount: countFiles(),
      scannedCount: this.scanned,
      drives: this.drives,
    }
  }

  private scheduleReindex(): void {
    if (this.reindexTimer) clearInterval(this.reindexTimer)
    this.reindexTimer = setInterval(() => {
      if (!this.indexing) this.startFullCrawl()
    }, REINDEX_INTERVAL_MS)
  }

  private startWatching(): void {
    if (this.watcher) return
    const roots = this.getWatchRoots()
    if (roots.length === 0) return
    try {
      this.watcher = chokidar.watch(roots, {
        ignoreInitial: true,
        depth: 99,
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
