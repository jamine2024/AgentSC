/**
 * 全盘文件搜索：磁盘爬虫
 *
 * - getFixedDrives(): 通过 WMI 取本地固定盘（DriveType=3），排除网络/可移动/光驱。
 * - crawlAll(): 逐个盘递归遍历，批量入库；跳过回收站、系统卷信息等受保护目录，
 *   并用 realpath 环路检测规避 junction / 符号链接造成的死循环。
 * - 遍历是异步的，每批插入后 yield 到事件循环，避免阻塞主进程。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { insertFileBatch, deleteByDrive } from './db'
import type { FileRow } from './types'
import { logToDb } from '../db'

const execFileP = promisify(execFile)

const BATCH = 200
const MAX_DEPTH = 60

// ── 分片节拍插入 ──
// 旧实现把 2000 行塞进**一个同步事务**：FTS5 trigram 每行要对 name+path 切出
// 几十个 token 维护倒排索引，单个事务轻松超过 1 秒 —— 期间主进程完全冻结
//（IPC、输入、渲染全部停摆），且每次积满 2000 个文件就冻结一次，正是
//「界面容易卡死」的元凶。现在按 100 行一片提交，片间让出事件循环并小憩，
// 把长冻结切成无感的碎片。
const INSERT_CHUNK = 100
const CHUNK_GAP_MS = 8
const BATCH_REST_MS = 20

async function insertBatchPaced(rows: FileRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    insertFileBatch(rows.slice(i, i + INSERT_CHUNK))
    if (i + INSERT_CHUNK < rows.length) {
      await new Promise((r) => setTimeout(r, CHUNK_GAP_MS))
    }
  }
  await new Promise((r) => setTimeout(r, BATCH_REST_MS))
}

// 受保护 / 无读取权限的系统目录，直接跳过（不进入递归）
const PROTECTED_DIRS = new Set([
  '$Recycle.Bin',
  'System Volume Information',
  'Recovery',
  '$SysReset',
  'Documents and Settings',
])

// 重目录跳过：这些目录文件量巨大（一台开发机动辄几十万文件的来源），对用户
// 「全盘找文件」几乎没有价值，且是拖慢建索、撑大 FTS 库的最大来源。
// 与 watcher 的排除口径保持一致（node_modules / 系统目录 / 缓存 / 隐藏目录）。
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', '$recycle.bin', 'system volume information',
  'windows', 'program files', 'program files (x86)', 'programdata', 'appdata',
  'application data', 'cache', 'caches', '.cache', '.npm', '.next', '.nuxt',
  '.turbo', '.pnpm-store', '.vscode', '.idea', '.gradle', '.m2', 'target',
  '.docker', 'containers',
])

function isSkipDirName(name: string): boolean {
  const lower = name.toLowerCase()
  if (SKIP_DIR_NAMES.has(lower)) return true
  // 隐藏目录（点开头但非 "." / ".."）
  if (lower.length > 1 && lower.startsWith('.')) return true
  return false
}

/** 取本地固定盘符列表，如 ['C:','D:'] */
export async function getFixedDrives(): Promise<string[]> {
  try {
    const { stdout } = await execFileP(
      'powershell',
      ['-NoProfile', '-Command', "(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3').DeviceID"],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    )
    const drives = stdout
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .map((d) => (d.endsWith(':') ? d : `${d}:`))
    if (drives.length > 0) return drives
  } catch (err) {
    logToDb('warn', 'filesearch', '获取盘符失败，回退字母探测', String(err))
  }
  // 回退：探测 C:..Z: 根目录是否可访问
  const found: string[] = []
  for (let c = 67; c <= 90; c++) {
    const letter = `${String.fromCharCode(c)}:`
    try {
      fs.statSync(`${letter}\\`)
      found.push(letter)
    } catch {
      /* ignore */
    }
  }
  return found
}

interface CrawlCtx {
  drive: string
  buffer: FileRow[]
  count: number
  onProgress: (count: number) => void
  branch: Set<string>
}

async function walk(dir: string, depth: number, ctx: CrawlCtx): Promise<void> {
  if (depth > MAX_DEPTH) return
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const e of entries) {
    if (e.name === '.' || e.name === '..') continue
    if (PROTECTED_DIRS.has(e.name) || isSkipDirName(e.name)) continue
    const full = path.join(dir, e.name)

    let st: fs.Stats
    try {
      st = await fs.promises.lstat(full)
    } catch {
      continue
    }
    const isDir = st.isDirectory()
    const isSymlink = st.isSymbolicLink()

    let rp: string | null = null
    if (isDir && !isSymlink) {
      try {
        rp = await fs.promises.realpath(full)
      } catch {
        rp = full
      }
      // 环路检测：该真实路径已在当前分支上出现 → 跳过（junction / 符号链接环）
      if (ctx.branch.has(rp)) continue
      ctx.branch.add(rp)
    }

    ctx.buffer.push({
      name: e.name,
      path: full,
      parent: dir,
      ext: isDir ? '' : path.extname(e.name).toLowerCase(),
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      is_dir: isDir ? 1 : 0,
      drive: ctx.drive,
    })
    ctx.count++

    if (ctx.buffer.length >= BATCH) {
      await insertBatchPaced(ctx.buffer)
      ctx.buffer = []
      ctx.onProgress(ctx.count)
    }

    if (isDir && !isSymlink) {
      await walk(full, depth + 1, ctx)
      if (rp) ctx.branch.delete(rp)
    }
  }
}

/** 爬取单个盘（先清空该盘旧数据再写入） */
export async function crawlDrive(drive: string, onProgress: (count: number) => void): Promise<number> {
  const normDrive = drive.toUpperCase().replace(/\s/g, '')
  deleteByDrive(normDrive)
  const ctx: CrawlCtx = {
    drive: normDrive,
    buffer: [],
    count: 0,
    onProgress,
    branch: new Set<string>(),
  }
  const root = `${normDrive}\\`
  try {
    await walk(root, 0, ctx)
  } catch (err) {
    logToDb('error', 'filesearch', `爬取 ${normDrive} 异常`, String(err))
  }
  if (ctx.buffer.length > 0) {
    await insertBatchPaced(ctx.buffer)
    ctx.buffer = []
    onProgress(ctx.count)
  }
  return ctx.count
}

/** 爬取所有固定盘 */
export async function crawlAll(
  onProgress: (count: number) => void,
  signal?: { aborted: boolean },
): Promise<{ drives: string[]; total: number }> {
  const drives = await getFixedDrives()
  let total = 0
  for (const d of drives) {
    if (signal?.aborted) break
    const c = await crawlDrive(d, onProgress)
    total += c
    logToDb('info', 'filesearch', `盘 ${d} 索引完成`, `文件数=${c}`)
  }
  return { drives, total }
}
