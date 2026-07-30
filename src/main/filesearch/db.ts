/**
 * 全盘文件搜索：持久化层（better-sqlite3 + FTS5 trigram）
 *
 * 设计要点：
 * - files 表存元数据；file_fts 为 FTS5「外部内容」虚拟表，用 trigram 分词器，
 *   支持任意子串匹配（含中文），索引落盘、不占内存，可扩展到数百万文件。
 * - trigram 对 >=3 字符的查询走索引；更短的查询走 LIKE 回退（命中 name 索引）。
 * - 建索引在后台分批事务写入，避免阻塞主进程事件循环。
 */

import { db, logToDb } from '../db'
import type { FileRow, FileResult } from './types'

let initialized = false

export function initFileSearchDb(): void {
  if (initialized) return
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 8000')
  } catch {
    /* ignore */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      parent TEXT NOT NULL,
      ext TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      mtime INTEGER NOT NULL DEFAULT 0,
      is_dir INTEGER NOT NULL DEFAULT 0,
      drive TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent);
    CREATE INDEX IF NOT EXISTS idx_files_drive ON files(drive);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);

    CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
      name, path,
      tokenize='trigram',
      content='files',
      content_rowid='id'
    );
  `)
  initialized = true
}

// 关键：在模块加载时（即任何 db.prepare 之前）先确保 schema 存在。
// better-sqlite3 的 prepare() 会在准备阶段解析表是否存在，若 files 表尚
// 未创建会直接抛 "no such table: files"，导致 app 在加载期崩溃。
// 因此必须把建表逻辑前置到所有模块级 prepare 语句之前。
initFileSearchDb()

const insFile = db.prepare(
  `INSERT INTO files (name,path,parent,ext,size,mtime,is_dir,drive)
   VALUES (@name,@path,@parent,@ext,@size,@mtime,@is_dir,@drive)`,
)
const insFts = db.prepare(`INSERT INTO file_fts (rowid, name, path) VALUES (?, ?, ?)`)
const delFtsByRowid = db.prepare(`DELETE FROM file_fts WHERE rowid = ?`)
const delFileById = db.prepare(`DELETE FROM files WHERE id = ?`)
const getFileId = db.prepare(`SELECT id FROM files WHERE path = ?`)
const countStmt = db.prepare(`SELECT COUNT(*) AS c FROM files`)

/** 批量插入（用于爬虫，假设该盘已清空，无重复 path） */
export function insertFileBatch(rows: FileRow[]): number {
  if (rows.length === 0) return 0
  const tx = db.transaction((batch: FileRow[]) => {
    for (const r of batch) {
      const info = insFile.run(r)
      const id = Number(info.lastInsertRowid)
      insFts.run(id, r.name, r.path)
    }
  })
  tx(rows)
  return rows.length
}

/** 单条 upsert（用于 chokidar 实时事件） */
export function upsertFile(r: FileRow): void {
  const tx = db.transaction((row: FileRow) => {
    const ex = getFileId.get(row.path) as { id: number } | undefined
    if (ex) {
      delFtsByRowid.run(ex.id)
      delFileById.run(ex.id)
    }
    const info = insFile.run(row)
    const id = Number(info.lastInsertRowid)
    insFts.run(id, row.name, row.path)
  })
  tx(r)
}

export function deleteFile(p: string): void {
  const tx = db.transaction((path: string) => {
    const ex = getFileId.get(path) as { id: number } | undefined
    if (!ex) return
    delFtsByRowid.run(ex.id)
    delFileById.run(ex.id)
  })
  tx(p)
}

/** 删除某盘所有记录（重扫该盘前调用） */
export function deleteByDrive(drive: string): void {
  const tx = db.transaction((d: string) => {
    db.prepare(`DELETE FROM file_fts WHERE rowid IN (SELECT id FROM files WHERE drive = ?)`).run(d)
    db.prepare(`DELETE FROM files WHERE drive = ?`).run(d)
  })
  tx(drive)
}

export function clearAllFiles(): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM file_fts`).run()
    db.prepare(`DELETE FROM files`).run()
  })
  tx()
}

export function countFiles(): number {
  return (countStmt.get() as { c: number }).c
}

function mapRow(r: any): FileResult {
  return {
    path: r.path,
    name: r.name,
    parent: r.parent,
    ext: r.ext,
    size: r.size,
    mtime: r.mtime,
    is_dir: r.is_dir === 1,
  }
}

/**
 * 查询文件。返回按相关性排序的结果。
 * - 所有词长度 >=3：走 FTS5 trigram（子串匹配，中文友好），bm25 排序 + 文件名命中/路径长度微调。
 * - 含 <3 字符的词：走 LIKE 回退（命中 name 索引，前缀/子串均可）。
 */
export function queryFiles(q: string, topK = 50): FileResult[] {
  const text = (q || '').trim()
  if (!text) return []
  const terms = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && /[\p{L}\p{N}]/u.test(t))
  if (terms.length === 0) return []

  const useFts = terms.every((t) => t.length >= 3)
  if (useFts) {
    const matchExpr = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ')
    const likeName = `%${text}%`
    try {
      const rows = db
        .prepare(
          `SELECT f.path, f.name, f.parent, f.ext, f.size, f.mtime, f.is_dir,
                  bm25(file_fts) AS rank
           FROM file_fts
           JOIN files f ON f.id = file_fts.rowid
           WHERE file_fts MATCH @m
           ORDER BY rank
             + (CASE WHEN f.name LIKE @likeName THEN -3 ELSE 0 END)
             + (length(f.path) * 0.00002)
           LIMIT @limit`,
        )
        .all({ m: matchExpr, likeName, limit: topK }) as any[]
      return rows.map(mapRow)
    } catch (err) {
      logToDb('warn', 'filesearch', 'FTS 查询失败，回退 LIKE', String(err))
      // 落到 LIKE 回退
    }
  }

  // LIKE 回退
  const conds: string[] = []
  const params: Record<string, unknown> = { limit: topK }
  terms.forEach((t, i) => {
    conds.push(`(f.name LIKE @n${i} OR f.path LIKE @p${i})`)
    params[`n${i}`] = `%${t}%`
    params[`p${i}`] = `%${t}%`
  })
  params['nn'] = `%${terms[0]}%`
  const rows = db
    .prepare(
      `SELECT f.path, f.name, f.parent, f.ext, f.size, f.mtime, f.is_dir
       FROM files f
       WHERE ${conds.join(' AND ')}
       ORDER BY (CASE WHEN f.name LIKE @nn THEN 0 ELSE 1 END), length(f.path), f.name
       LIMIT @limit`,
    )
    .all(params) as any[]
  return rows.map(mapRow)
}
