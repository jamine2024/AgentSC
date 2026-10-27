import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'
import type { HardwareInfo, HostsInfo } from './hardware'

const dbDir = path.join(app.getPath('userData'), 'AgentSC')
fs.mkdirSync(dbDir, { recursive: true })

const dbPath = path.join(dbDir, 'agentsc.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
// 性能相关 PRAGMA：
// - synchronous=NORMAL：WAL 下仍然崩溃安全（最坏丢最近一个事务），但避免了每次
//   提交都 fsync。better-sqlite3 是同步 API，fsync 期间整个主线程停摆 —— 事件批量
//   写入（每 2s 一次）与看板聚合查询都会受此影响，机械盘上尤其明显。
// - cache_size / mmap_size：减少频繁的页读取与 syscall，聚合查询更快返回。
// - busy_timeout：避免索引器与事件写入撞车时直接抛 SQLITE_BUSY。
db.pragma('synchronous = NORMAL')
db.pragma('busy_timeout = 8000')
db.pragma('cache_size = -16000')
db.pragma('temp_store = MEMORY')
try {
  db.pragma('mmap_size = 268435456')
} catch {
  // 部分文件系统/安全策略下 mmap 不可用，忽略即可
}

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('created', 'modified', 'deleted', 'renamed')),
      path TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      process_name TEXT,
      process_id INTEGER,
      drive TEXT,
      recorded_at INTEGER NOT NULL,
      day TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_file_events_day ON file_events(day);
    CREATE INDEX IF NOT EXISTS idx_file_events_type ON file_events(type);
    CREATE INDEX IF NOT EXISTS idx_file_events_recorded_at ON file_events(recorded_at DESC);
    -- 复合索引：加速 getTopProcesses 的 day + process_name 聚合（高频看板查询）
    CREATE INDEX IF NOT EXISTS idx_file_events_day_process
      ON file_events(day, process_name) WHERE process_name IS NOT NULL;
    -- 复合索引：看板的「今日统计 / 趋势 / Top 路径」全部是 WHERE day=? AND type=?
    -- 的聚合，单列索引只能命其一，SQLite 仍需回表逐行过滤；库里积累几十万条后
    -- 这几个查询每 2s 跑一次，会直接把主线程的同步 SQLite 调用拖成几十毫秒级。
    CREATE INDEX IF NOT EXISTS idx_file_events_day_type
      ON file_events(day, type);
    CREATE INDEX IF NOT EXISTS idx_file_events_day_type_size
      ON file_events(day, type, size);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exclusion_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL UNIQUE,
      reason TEXT,
      enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS cleaner_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('recycle_bin', 'ie_history', 'temp_dir', 'browser_cache', 'custom')),
      target TEXT,
      schedule TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run INTEGER,
      next_run INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS cleaner_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
      message TEXT,
      freed_bytes INTEGER DEFAULT 0,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS app_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error')),
      module TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_app_logs_module ON app_logs(module);
    CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);

    -- 占用分析历史记录（保留最近 N 次扫描结果）
    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_path TEXT NOT NULL,
      total_size INTEGER DEFAULT 0,
      items_scanned INTEGER DEFAULT 0,
      max_depth INTEGER DEFAULT 3,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scan_history_created_at ON scan_history(created_at DESC);

    -- 系统定时任务（node-schedule 调度）
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('cleanup', 'ai_insights', 'ai_cleanup', 'shell')),
      schedule_type TEXT NOT NULL CHECK(schedule_type IN ('interval', 'daily', 'weekly', 'cron', 'once')),
      schedule_value TEXT NOT NULL,
      params TEXT,
      enabled INTEGER DEFAULT 1,
      last_run INTEGER,
      last_status TEXT,
      next_run INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_created_at ON scheduled_tasks(created_at DESC);

    -- 硬件探测快照缓存：单行（id=1），用于"下次秒开"，除非手动刷新才重新探测。
    -- info_json 存完整 HardwareInfo，hosts_json 存 HostsInfo，updated_at 标记采集时间。
    CREATE TABLE IF NOT EXISTS hardware_cache (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      info_json TEXT NOT NULL,
      hosts_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 注册表修改管理器：用户定义的注册表操作（一组键值修改步骤）
    CREATE TABLE IF NOT EXISTS registry_ops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      steps_json TEXT NOT NULL DEFAULT '[]',
      last_applied INTEGER,
      last_status TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    -- 注册表操作历史（每次应用/回滚均记录，含备份路径以便回滚）
    CREATE TABLE IF NOT EXISTS registry_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op_id INTEGER NOT NULL,
      op_name TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('apply', 'rollback')),
      status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'partial')),
      message TEXT,
      backup_dir TEXT,
      backup_files TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_registry_history_created_at ON registry_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_registry_history_op ON registry_history(op_id);
  `)

  // 幂等迁移：为 cleaner_rules 补充订阅来源相关列（旧库升级用）
  const existingCols = new Set(
    (db.prepare('PRAGMA table_info(cleaner_rules)').all() as { name: string }[]).map((c) => c.name),
  )
  if (!existingCols.has('source_subscription_id')) {
    db.exec('ALTER TABLE cleaner_rules ADD COLUMN source_subscription_id INTEGER')
  }
  if (!existingCols.has('external_id')) {
    db.exec('ALTER TABLE cleaner_rules ADD COLUMN external_id TEXT')
  }
  if (!existingCols.has('patterns')) {
    db.exec('ALTER TABLE cleaner_rules ADD COLUMN patterns TEXT')
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaner_rules_sub_ext
      ON cleaner_rules(source_subscription_id, external_id)
  `)
  // 注：该索引依赖上面三列，必须在列迁移之后创建

  // 幂等迁移：为 exclusion_rules 补充 is_default 列（旧库升级用）
  // 必须在 seed INSERT 之前执行，否则旧库（无 is_default 列）会先执行 INSERT 而报错。
  const exCols = new Set(
    (db.prepare('PRAGMA table_info(exclusion_rules)').all() as { name: string }[]).map((c) => c.name),
  )
  if (!exCols.has('is_default')) {
    db.exec('ALTER TABLE exclusion_rules ADD COLUMN is_default INTEGER DEFAULT 0')
  }
  // 把系统默认排除规则（固定 pattern 集合）标记为 is_default=1，幂等可重复执行。
  // 这样旧库里已存在的系统规则也会被保护，不会被用户删除。
  db.prepare(`
    UPDATE exclusion_rules SET is_default = 1 WHERE pattern IN (
      'C:\\Windows\\*',
      'C:\\Program Files\\*',
      'C:\\Program Files (x86)\\*',
      '*$Recycle.Bin*',
      '*\\Temp\\*',
      '*\\.tmp',
      '*\\.log'
    )
  `).run()

  // 初始化系统默认排除规则（在 is_default 列确保存在后再插入，兼容旧库升级）
  db.exec(`
    INSERT OR IGNORE INTO exclusion_rules (pattern, reason, is_default) VALUES
      ('C:\\Windows\\*', '系统目录', 1),
      ('C:\\Program Files\\*', '系统程序目录', 1),
      ('C:\\Program Files (x86)\\*', '系统程序目录', 1),
      ('*$Recycle.Bin*', '回收站', 1),
      ('*\\Temp\\*', '临时目录', 1),
      ('*\\.tmp', '临时文件', 1),
      ('*\\.log', '日志文件（可选）', 1);
  `)
}

// 占用分析历史最多保留的条数
export const SCAN_HISTORY_LIMIT = 5

export interface ScanHistoryRow {
  id: number
  target_path: string
  total_size: number
  items_scanned: number
  max_depth: number
  result_json: string
  created_at: number
}

export function insertScanHistory(entry: {
  target_path: string
  total_size: number
  items_scanned: number
  max_depth: number
  result_json: string
}) {
  const insertStmt = db.prepare(`
    INSERT INTO scan_history (target_path, total_size, items_scanned, max_depth, result_json, created_at)
    VALUES (@target_path, @total_size, @items_scanned, @max_depth, @result_json, @created_at)
  `)
  insertStmt.run({
    target_path: entry.target_path,
    total_size: entry.total_size,
    items_scanned: entry.items_scanned,
    max_depth: entry.max_depth,
    result_json: entry.result_json,
    created_at: Date.now(),
  })
  // 仅保留最近 SCAN_HISTORY_LIMIT 条，删除更早的记录
  db.prepare(`
    DELETE FROM scan_history
    WHERE id NOT IN (
      SELECT id FROM scan_history ORDER BY created_at DESC LIMIT ?
    )
  `).run(SCAN_HISTORY_LIMIT)
}

export function getScanHistory(limit = SCAN_HISTORY_LIMIT) {
  return db
    .prepare('SELECT * FROM scan_history ORDER BY created_at DESC LIMIT ?')
    .all(limit) as ScanHistoryRow[]
}

export function deleteScanHistory(id: number) {
  return db.prepare('DELETE FROM scan_history WHERE id = ?').run(id)
}

export function clearScanHistory() {
  return db.prepare('DELETE FROM scan_history').run()
}

export interface FileEventRow {
  id?: number
  type: 'created' | 'modified' | 'deleted' | 'renamed'
  path: string
  size?: number
  process_name?: string
  process_id?: number
  drive?: string
  recorded_at: number
  day: string
}

export interface ExclusionRule {
  id?: number
  pattern: string
  reason?: string
  enabled?: number
  is_default?: number
  created_at?: number
}

export function addExclusionRule(rule: ExclusionRule) {
  const stmt = db.prepare(`
    INSERT INTO exclusion_rules (pattern, reason, enabled, created_at)
    VALUES (@pattern, @reason, @enabled, @created_at)
  `)
  const info = stmt.run({
    pattern: rule.pattern,
    reason: rule.reason || '',
    enabled: rule.enabled ?? 1,
    created_at: rule.created_at || Date.now(),
  })
  invalidateExclusionCache()
  return info
}

export function updateExclusionRule(id: number, rule: Partial<ExclusionRule>) {
  const existing = db.prepare('SELECT * FROM exclusion_rules WHERE id = ?').get(id) as ExclusionRule | undefined
  if (!existing) return null
  const next = { ...existing, ...rule }
  const stmt = db.prepare(`
    UPDATE exclusion_rules
    SET pattern = @pattern, reason = @reason, enabled = @enabled
    WHERE id = @id
  `)
  const info = stmt.run({
    id,
    pattern: next.pattern,
    reason: next.reason || '',
    enabled: next.enabled ?? 1,
  })
  invalidateExclusionCache()
  return info
}

export function deleteExclusionRule(id: number) {
  const rule = db
    .prepare('SELECT id, is_default FROM exclusion_rules WHERE id = ?')
    .get(id) as { id: number; is_default?: number } | undefined
  if (!rule) return { ok: false, error: 'not-found' }
  // 系统默认排除规则不可删除
  if (rule.is_default) return { ok: false, error: 'builtin' }
  const res = db.prepare('DELETE FROM exclusion_rules WHERE id = ?').run(id)
  invalidateExclusionCache()
  return { ok: true, changes: res.changes }
}

// 批量导入排除规则：使用 INSERT OR IGNORE 容忍 pattern 唯一冲突（已存在的规则自动跳过）。
// 返回 { added, skipped } 表示新增条数与因冲突跳过的条数。
export function importExclusionRules(rules: Array<{ pattern: string; reason?: string; enabled?: number }>) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO exclusion_rules (pattern, reason, enabled, created_at)
    VALUES (@pattern, @reason, @enabled, @created_at)
  `)
  const tx = db.transaction((items: Array<{ pattern: string; reason?: string; enabled?: number }>) => {
    let added = 0
    for (const item of items) {
      const pattern = (item.pattern ?? '').trim()
      if (!pattern) continue
      const info = insert.run({
        pattern,
        reason: item.reason || '',
        enabled: item.enabled ?? 1,
        created_at: Date.now(),
      })
      if (info.changes > 0) added += 1
    }
    return added
  })
  const added = tx(rules)
  invalidateExclusionCache()
  return { added, skipped: rules.length - added }
}

const insertEventStmt = db.prepare(`
  INSERT INTO file_events (type, path, size, process_name, process_id, drive, recorded_at, day)
  VALUES (@type, @path, @size, @process_name, @process_id, @drive, @recorded_at, @day)
`)

export function insertEvent(event: FileEventRow) {
  return insertEventStmt.run(event)
}

export function insertEvents(events: FileEventRow[]) {
  const insertMany = db.transaction((rows: FileEventRow[]) => {
    for (const row of rows) {
      insertEventStmt.run(row)
    }
  })
  return insertMany(events)
}

export function getRecentEvents(limit = 50) {
  return db
    .prepare('SELECT * FROM file_events ORDER BY recorded_at DESC LIMIT ?')
    .all(limit) as FileEventRow[]
}

export function getDailyStats(day: string) {
  return db
    .prepare(`
      SELECT
        SUM(CASE WHEN type = 'created' THEN 1 ELSE 0 END) AS created_count,
        SUM(CASE WHEN type = 'deleted' THEN 1 ELSE 0 END) AS deleted_count,
        SUM(CASE WHEN type = 'created' THEN COALESCE(size, 0) ELSE 0 END) AS created_bytes,
        SUM(CASE WHEN type = 'deleted' THEN COALESCE(size, 0) ELSE 0 END) AS deleted_bytes
      FROM file_events
      WHERE day = ?
    `)
    .get(day) as {
      created_count: number
      deleted_count: number
      created_bytes: number
      deleted_bytes: number
    }
}

export function getTopProcesses(day: string, limit = 10) {
  return db
    .prepare(`
      SELECT process_name, COUNT(*) AS event_count
      FROM file_events
      WHERE day = ? AND process_name IS NOT NULL AND process_name != ''
      GROUP BY process_name
      ORDER BY event_count DESC
      LIMIT ?
    `)
    .all(day, limit) as { process_name: string; event_count: number }[]
}

export interface DailyTrendRow {
  day: string
  created_count: number
  deleted_count: number
  created_bytes: number
  deleted_bytes: number
}

function toLocalDayString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getDailyTrend(days = 7) {
  const start = new Date()
  start.setDate(start.getDate() - days + 1)
  const startDay = toLocalDayString(start)

  const rows = db
    .prepare(`
      SELECT
        day,
        SUM(CASE WHEN type = 'created' THEN 1 ELSE 0 END) AS created_count,
        SUM(CASE WHEN type = 'deleted' THEN 1 ELSE 0 END) AS deleted_count,
        SUM(CASE WHEN type = 'created' THEN COALESCE(size, 0) ELSE 0 END) AS created_bytes,
        SUM(CASE WHEN type = 'deleted' THEN COALESCE(size, 0) ELSE 0 END) AS deleted_bytes
      FROM file_events
      WHERE day >= ?
      GROUP BY day
      ORDER BY day ASC
    `)
    .all(startDay) as DailyTrendRow[]

  const result: DailyTrendRow[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const day = toLocalDayString(d)
    const found = rows.find((r) => r.day === day)
    result.push(
      found || {
        day,
        created_count: 0,
        deleted_count: 0,
        created_bytes: 0,
        deleted_bytes: 0,
      },
    )
  }
  return result
}

export interface TopCreatedPathRow {
  path: string
  total_size: number
  count: number
}

export function getTopCreatedPaths(day: string, limit = 10) {
  return db
    .prepare(`
      SELECT path, SUM(COALESCE(size, 0)) AS total_size, COUNT(*) AS count
      FROM file_events
      WHERE day = ? AND type = 'created'
      GROUP BY path
      ORDER BY total_size DESC
      LIMIT ?
    `)
    .all(day, limit) as TopCreatedPathRow[]
}

export interface RangeStats {
  created_count: number
  deleted_count: number
  modified_count: number
  renamed_count: number
  created_bytes: number
  deleted_bytes: number
}

export function getRangeStats(startDay: string, endDay: string) {
  return db
    .prepare(`
      SELECT
        SUM(CASE WHEN type = 'created' THEN 1 ELSE 0 END) AS created_count,
        SUM(CASE WHEN type = 'deleted' THEN 1 ELSE 0 END) AS deleted_count,
        SUM(CASE WHEN type = 'modified' THEN 1 ELSE 0 END) AS modified_count,
        SUM(CASE WHEN type = 'renamed' THEN 1 ELSE 0 END) AS renamed_count,
        SUM(CASE WHEN type = 'created' THEN COALESCE(size, 0) ELSE 0 END) AS created_bytes,
        SUM(CASE WHEN type = 'deleted' THEN COALESCE(size, 0) ELSE 0 END) AS deleted_bytes
      FROM file_events
      WHERE day >= ? AND day <= ?
    `)
    .get(startDay, endDay) as RangeStats
}

export interface DailyReportRow {
  day: string
  created_count: number
  deleted_count: number
  modified_count: number
  renamed_count: number
  created_bytes: number
  deleted_bytes: number
}

export function getDailyReportInRange(startDay: string, endDay: string) {
  return db
    .prepare(`
      SELECT
        day,
        SUM(CASE WHEN type = 'created' THEN 1 ELSE 0 END) AS created_count,
        SUM(CASE WHEN type = 'deleted' THEN 1 ELSE 0 END) AS deleted_count,
        SUM(CASE WHEN type = 'modified' THEN 1 ELSE 0 END) AS modified_count,
        SUM(CASE WHEN type = 'renamed' THEN 1 ELSE 0 END) AS renamed_count,
        SUM(CASE WHEN type = 'created' THEN COALESCE(size, 0) ELSE 0 END) AS created_bytes,
        SUM(CASE WHEN type = 'deleted' THEN COALESCE(size, 0) ELSE 0 END) AS deleted_bytes
      FROM file_events
      WHERE day >= ? AND day <= ?
      GROUP BY day
      ORDER BY day ASC
    `)
    .all(startDay, endDay) as DailyReportRow[]
}

export function getTopProcessesInRange(startDay: string, endDay: string, limit = 10) {
  return db
    .prepare(`
      SELECT process_name, COUNT(*) AS event_count
      FROM file_events
      WHERE day >= ? AND day <= ? AND process_name IS NOT NULL AND process_name != ''
      GROUP BY process_name
      ORDER BY event_count DESC
      LIMIT ?
    `)
    .all(startDay, endDay, limit) as { process_name: string; event_count: number }[]
}

export function getTopCreatedPathsInRange(startDay: string, endDay: string, limit = 10) {
  return db
    .prepare(`
      SELECT path, SUM(COALESCE(size, 0)) AS total_size, COUNT(*) AS count
      FROM file_events
      WHERE day >= ? AND day <= ? AND type = 'created'
      GROUP BY path
      ORDER BY total_size DESC
      LIMIT ?
    `)
    .all(startDay, endDay, limit) as TopCreatedPathRow[]
}

export function getTopDeletedPathsInRange(startDay: string, endDay: string, limit = 10) {
  return db
    .prepare(`
      SELECT path, SUM(COALESCE(size, 0)) AS total_size, COUNT(*) AS count
      FROM file_events
      WHERE day >= ? AND day <= ? AND type = 'deleted'
      GROUP BY path
      ORDER BY total_size DESC
      LIMIT ?
    `)
    .all(startDay, endDay, limit) as TopCreatedPathRow[]
}

export interface CleanerRule {
  id?: number
  name: string
  type: 'recycle_bin' | 'ie_history' | 'temp_dir' | 'browser_cache' | 'custom'
  target?: string
  /** 仅 custom 类型使用：逗号分隔的 glob 文件名模式，限制删除范围（留空=清空整个目录） */
  patterns?: string | null
  schedule: string
  enabled?: number
  last_run?: number | null
  next_run?: number | null
  created_at?: number
  /** 由互联网订阅导入的规则记录其来源订阅 id（手动规则为 null） */
  source_subscription_id?: number | null
  /** 远程清单中的稳定外部 id，用于同步时幂等更新 */
  external_id?: string | null
}

export function getCleanerRules() {
  return db.prepare('SELECT * FROM cleaner_rules ORDER BY id').all() as CleanerRule[]
}

export function getCleanerRuleById(id: number): CleanerRule | undefined {
  return db.prepare('SELECT * FROM cleaner_rules WHERE id = ?').get(id) as CleanerRule | undefined
}

export function addCleanerRule(rule: CleanerRule) {
  const stmt = db.prepare(`
    INSERT INTO cleaner_rules (name, type, target, schedule, enabled, created_at)
    VALUES (@name, @type, @target, @schedule, @enabled, @created_at)
  `)
  return stmt.run({
    name: rule.name,
    type: rule.type,
    target: rule.target || '',
    schedule: rule.schedule,
    enabled: rule.enabled ?? 1,
    created_at: rule.created_at || Date.now(),
  })
}

export function updateCleanerRule(id: number, rule: Partial<CleanerRule>) {
  const existing = db.prepare('SELECT * FROM cleaner_rules WHERE id = ?').get(id) as CleanerRule | undefined
  if (!existing) return null
  const next = { ...existing, ...rule }
  const stmt = db.prepare(`
    UPDATE cleaner_rules
    SET name = @name, type = @type, target = @target, schedule = @schedule,
        enabled = @enabled, last_run = @last_run, next_run = @next_run
    WHERE id = @id
  `)
  return stmt.run({
    id,
    name: next.name,
    type: next.type,
    target: next.target || '',
    schedule: next.schedule,
    enabled: next.enabled ?? 1,
    last_run: next.last_run ?? existing.last_run ?? null,
    next_run: next.next_run ?? existing.next_run ?? null,
  })
}

export function deleteCleanerRule(id: number) {
  return db.prepare('DELETE FROM cleaner_rules WHERE id = ?').run(id)
}

/**
 * 写入一条内置规则（随包携带，不联网）。
 * external_id 形如 `builtin::<key>::<id>`，用于幂等去重。
 */
export function insertBuiltinRule(rule: {
  name: string
  type: CleanerRule['type']
  target?: string
  patterns?: string | null
  schedule: string
  enabled?: number
  external_id: string
}) {
  const info = db
    .prepare(`
      INSERT INTO cleaner_rules
        (name, type, target, schedule, enabled, external_id, patterns, created_at)
      VALUES
        (@name, @type, @target, @schedule, @enabled, @external_id, @patterns, @created_at)
    `)
    .run({
      name: rule.name,
      type: rule.type,
      target: rule.target || '',
      schedule: rule.schedule,
      enabled: rule.enabled ?? 1,
      external_id: rule.external_id,
      patterns: rule.patterns || null,
      created_at: Date.now(),
    })
  return Number(info.lastInsertRowid)
}

/** 统计某个内置 key 已写入的规则数（用于幂等播种判断） */
export function countBuiltinRulesByKey(prefix: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM cleaner_rules WHERE external_id LIKE ?")
    .get(prefix + '%') as { c: number }
  return row.c
}

export interface CleanerLog {
  id?: number
  rule_id?: number
  type: string
  name: string
  status: 'success' | 'failed'
  message?: string
  freed_bytes?: number
  started_at: number
  finished_at?: number
}

export function insertCleanerLog(log: CleanerLog) {
  const stmt = db.prepare(`
    INSERT INTO cleaner_logs (rule_id, type, name, status, message, freed_bytes, started_at, finished_at)
    VALUES (@rule_id, @type, @name, @status, @message, @freed_bytes, @started_at, @finished_at)
  `)
  return stmt.run({
    rule_id: log.rule_id ?? null,
    type: log.type,
    name: log.name,
    status: log.status,
    message: log.message || '',
    freed_bytes: log.freed_bytes ?? 0,
    started_at: log.started_at,
    finished_at: log.finished_at ?? null,
  })
}

export function getRecentCleanerLogs(limit = 50) {
  return db
    .prepare('SELECT * FROM cleaner_logs ORDER BY started_at DESC LIMIT ?')
    .all(limit) as CleanerLog[]
}

// 分页查询 cleaner_logs
export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function getCleanerLogsPaginated(page: number, pageSize: number = 20) {
  const total = (db.prepare('SELECT COUNT(*) AS count FROM cleaner_logs').get() as { count: number }).count
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const offset = (page - 1) * pageSize
  const items = db
    .prepare('SELECT * FROM cleaner_logs ORDER BY started_at DESC LIMIT ? OFFSET ?')
    .all(pageSize, offset) as CleanerLog[]
  return { items, total, page, pageSize, totalPages }
}

// ====== app_logs 应用日志 ======
export interface AppLog {
  id?: number
  level: 'info' | 'warn' | 'error'
  module: string
  message: string
  details?: string
  created_at: number
}

const insertAppLogStmt = db.prepare(`
  INSERT INTO app_logs (level, module, message, details, created_at)
  VALUES (@level, @module, @message, @details, @created_at)
`)

export function logToDb(level: AppLog['level'], module: string, message: string, details?: string) {
  try {
    insertAppLogStmt.run({ level, module, message, details: details || null, created_at: Date.now() })
  } catch {
    // 日志写入失败不应影响主流程
  }
}

export function getAppLogsPaginated(page: number, pageSize: number = 20, filter?: { level?: string; module?: string }) {
  let where = 'WHERE 1=1'
  const params: unknown[] = []
  if (filter?.level) {
    where += ' AND level = ?'
    params.push(filter.level)
  }
  if (filter?.module) {
    where += ' AND module = ?'
    params.push(filter.module)
  }
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM app_logs ${where}`).get(...params) as { count: number }
  const total = countRow.count
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const offset = (page - 1) * pageSize
  const items = db
    .prepare(`SELECT * FROM app_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as AppLog[]
  return { items, total, page, pageSize, totalPages }
}

export function getDistinctLogModules() {
  return db.prepare('SELECT DISTINCT module FROM app_logs ORDER BY module').all() as { module: string }[]
}

export function getExclusionRules() {
  return db.prepare('SELECT * FROM exclusion_rules ORDER BY id').all() as {
    id: number
    pattern: string
    reason: string
    enabled: number
    is_default?: number
  }[]
}

export function getEventCount() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM file_events').get() as { count: number }
  return row?.count || 0
}

export function getCleanerLogCount() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM cleaner_logs').get() as { count: number }
  return row?.count || 0
}

export function getAppLogCount() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM app_logs').get() as { count: number }
  return row?.count || 0
}

export function clearFileEvents() {
  return db.prepare('DELETE FROM file_events').run()
}

// 滚动清理：仅保留最近 keepDays 天的文件事件，防止 file_events 表无界膨胀
// （开启监控长时运行后行数可达数十万→百万，直接拖高内存与磁盘占用、拖慢聚合查询）。
// ── 滚动清理（分批执行）──
// 旧实现是单条大 DELETE：事件表积累几十万行后，一次删除要长时间持有写锁，
// better-sqlite3 是同步 API，主线程会在整个事务期间停摆（启动时正好撞上首屏），
// 大事务还会把 WAL 撑得很大。改为按主键分批删（每批 5000 条、批间让出事件循环），
// 删完做一次 wal_checkpoint(TRUNCATE) 把 WAL 收缩回去。
const PRUNE_BATCH_SIZE = 5000
const PRUNE_MAX_BATCHES = 400 // 单次最多删 200 万行，防异常数据导致无限循环

function yieldTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function checkpointWal(): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* 有并发读时 checkpoint 可能 busy，忽略即可 */
  }
}

export async function pruneFileEvents(keepDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
  const cutoffDay = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  // day 字段为 'YYYY-MM-DD'，按字典序比较即可；并兜底删除 > 365 天（极端脏数据）
  let deleted = 0
  try {
    const stmt = db.prepare(
      "DELETE FROM file_events WHERE id IN (SELECT id FROM file_events WHERE day < ? OR day < '2000-01-01' LIMIT ?)",
    )
    for (let i = 0; i < PRUNE_MAX_BATCHES; i++) {
      const r = stmt.run(cutoffDay, PRUNE_BATCH_SIZE)
      deleted += r.changes
      if (r.changes < PRUNE_BATCH_SIZE) break
      await yieldTick()
    }
    checkpointWal()
  } catch {
    return deleted
  }
  return deleted
}

// 滚动清理：仅保留最近 keepDays 天的应用日志
export async function pruneAppLogs(keepDays = 30): Promise<number> {
  // created_at 存的是 Date.now() 毫秒整数，之前拿 ISO 字符串去比较：
  // SQLite 的类型排序里「整数 < 文本」恒成立，于是这条 DELETE 实际清空了整张
  // app_logs 表 —— 每天都把日志抹掉，排查卡顿/崩溃时恰恰没有历史可看。
  const cutoffMs = Date.now() - keepDays * 24 * 60 * 60 * 1000
  let deleted = 0
  try {
    const stmt = db.prepare(
      'DELETE FROM app_logs WHERE id IN (SELECT id FROM app_logs WHERE created_at < ? LIMIT ?)',
    )
    for (let i = 0; i < PRUNE_MAX_BATCHES; i++) {
      const r = stmt.run(cutoffMs, PRUNE_BATCH_SIZE)
      deleted += r.changes
      if (r.changes < PRUNE_BATCH_SIZE) break
      await yieldTick()
    }
    checkpointWal()
  } catch {
    return deleted
  }
  return deleted
}

export function clearCleanerLogs() {
  return db.prepare('DELETE FROM cleaner_logs').run()
}

export function clearAppLogs() {
  return db.prepare('DELETE FROM app_logs').run()
}

// ── 排除规则匹配缓存 ─────────────────────────────────────────────
// isPathExcluded 位于每个文件事件的热路径上（watcher.recordEvent / scanner 遍历）。
// 旧实现每次都做一遍「查表 + 过滤 + 逐条 replace 构造 RegExp」，文件事件密集时
// （例如解压大包、编译构建）会在主进程同步堆出大量重复工作：一条 SQL 全表扫描加
// N 次正则编译，全部跑在 Electron 主线程上，直接卡住渲染进程的 IPC 响应。
// 这里把「启用中的规则」编译结果缓存起来，仅在规则增删改后失效。
interface CompiledExclusionRule { regex: RegExp; source: string }
let exclusionRegexCache: CompiledExclusionRule[] | null = null

/** 规则变更后调用，丢弃已编译的正则缓存 */
export function invalidateExclusionCache() {
  exclusionRegexCache = null
}

function getCompiledExclusionRules(): CompiledExclusionRule[] {
  if (exclusionRegexCache) return exclusionRegexCache
  const compiled: CompiledExclusionRule[] = []
  for (const rule of getExclusionRules()) {
    if (rule.enabled !== 1) continue
    const pat = rule.pattern.replace(/\\/g, '\\\\').replace(/\*/g, '.*').replace(/\?/g, '.')
    try {
      compiled.push({ regex: new RegExp(`^${pat}$`, 'i'), source: rule.pattern })
    } catch {
      // 非法通配符（用户手输的规则）不应拖垮整条热路径
    }
  }
  exclusionRegexCache = compiled
  return compiled
}

export function isPathExcluded(filePath: string) {
  const rules = getCompiledExclusionRules()
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].regex.test(filePath)) return true
  }
  return false
}

// ====== 系统定时任务（scheduled_tasks） ======
export interface ScheduledTaskRow {
  id: number
  name: string
  action: 'cleanup' | 'ai_insights' | 'ai_cleanup' | 'shell'
  schedule_type: 'interval' | 'daily' | 'weekly' | 'cron' | 'once'
  schedule_value: string
  params: string | null
  enabled: number
  last_run: number | null
  last_status: string | null
  next_run: number | null
  created_at: number
}

export type NewScheduledTask = Omit<
  ScheduledTaskRow,
  'id' | 'last_run' | 'last_status' | 'next_run' | 'created_at'
>

export function getScheduledTasks(): ScheduledTaskRow[] {
  return db.prepare('SELECT * FROM scheduled_tasks ORDER BY id').all() as ScheduledTaskRow[]
}

export function getScheduledTaskById(id: number): ScheduledTaskRow | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTaskRow | undefined
}

export function addScheduledTask(task: NewScheduledTask): number {
  const info = db
    .prepare(`
      INSERT INTO scheduled_tasks (name, action, schedule_type, schedule_value, params, enabled, created_at)
      VALUES (@name, @action, @schedule_type, @schedule_value, @params, @enabled, @created_at)
    `)
    .run({
      name: task.name,
      action: task.action,
      schedule_type: task.schedule_type,
      schedule_value: task.schedule_value,
      params: task.params ?? null,
      enabled: task.enabled ?? 1,
      created_at: Date.now(),
    })
  return Number(info.lastInsertRowid)
}

export function updateScheduledTask(
  id: number,
  patch: Partial<ScheduledTaskRow>,
): void {
  const existing = getScheduledTaskById(id)
  if (!existing) return
  const next = { ...existing, ...patch }
  db.prepare(`
    UPDATE scheduled_tasks
    SET name = @name,
        action = @action,
        schedule_type = @schedule_type,
        schedule_value = @schedule_value,
        params = @params,
        enabled = @enabled,
        last_run = @last_run,
        last_status = @last_status,
        next_run = @next_run
    WHERE id = @id
  `).run({
    id,
    name: next.name,
    action: next.action,
    schedule_type: next.schedule_type,
    schedule_value: next.schedule_value,
    params: next.params ?? null,
    enabled: next.enabled ?? 1,
    last_run: next.last_run ?? null,
    last_status: next.last_status ?? null,
    next_run: next.next_run ?? null,
  })
}

export function deleteScheduledTask(id: number): void {
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
}

export function closeDb() {
  db.close()
}

// ====== 硬件探测快照缓存 ======
export interface HardwareCache {
  info: HardwareInfo
  hosts: HostsInfo
  updatedAt: number
}

// 写入（或覆盖）硬件探测快照。单行表，UPSERT。
export function saveHardwareCache(info: HardwareInfo, hosts: HostsInfo): void {
  const stmt = db.prepare(`
    INSERT INTO hardware_cache (id, info_json, hosts_json, updated_at)
    VALUES (1, @info_json, @hosts_json, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      info_json = excluded.info_json,
      hosts_json = excluded.hosts_json,
      updated_at = excluded.updated_at
  `)
  stmt.run({
    info_json: JSON.stringify(info),
    hosts_json: JSON.stringify(hosts),
    updated_at: Date.now(),
  })
}

// 读取硬件探测快照；无缓存返回 null。
export function getHardwareCache(): HardwareCache | null {
  const row = db.prepare('SELECT info_json, hosts_json, updated_at FROM hardware_cache WHERE id = 1').get() as
    | { info_json: string; hosts_json: string; updated_at: number }
    | undefined
  if (!row) return null
  try {
    return {
      info: JSON.parse(row.info_json) as HardwareInfo,
      hosts: JSON.parse(row.hosts_json) as HostsInfo,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

// ───────────────────────────────────────────────────────────
// 注册表修改管理器
// ───────────────────────────────────────────────────────────
export type RegistryHive = 'HKLM' | 'HKCU' | 'HKCR' | 'HKU' | 'HKCC'

export type RegistryValueType = 'REG_SZ' | 'REG_DWORD' | 'REG_EXPAND_SZ' | 'REG_MULTI_SZ' | 'REG_BINARY'

export interface RegistryStep {
  hive: RegistryHive
  key: string
  valueName: string
  action: 'set' | 'delete' | 'deleteKey'
  type?: RegistryValueType
  data?: string
}

export interface RegistryOp {
  id: number
  name: string
  description: string
  enabled: number
  steps: RegistryStep[]
  createdAt: number
  lastApplied: number | null
  lastStatus: string | null
}

export interface RegistryHistoryEntry {
  id: number
  opId: number
  opName: string
  action: 'apply' | 'rollback'
  status: 'success' | 'failed' | 'partial'
  message: string | null
  backupDir: string | null
  backupFiles: string | null
  createdAt: number
}

function parseSteps(json: string): RegistryStep[] {
  try {
    const arr = JSON.parse(json)
    if (Array.isArray(arr)) return arr as RegistryStep[]
  } catch {
    /* ignore */
  }
  return []
}

export function getRegistryOps(): RegistryOp[] {
  const rows = db
    .prepare('SELECT * FROM registry_ops ORDER BY id')
    .all() as Array<{
    id: number
    name: string
    description: string | null
    enabled: number
    steps_json: string
    created_at: number
    last_applied: number | null
    last_status: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    enabled: r.enabled ? 1 : 0,
    steps: parseSteps(r.steps_json),
    createdAt: r.created_at,
    lastApplied: r.last_applied,
    lastStatus: r.last_status,
  }))
}

export function getRegistryOpById(id: number): RegistryOp | undefined {
  const r = db.prepare('SELECT * FROM registry_ops WHERE id = ?').get(id) as
    | {
        id: number
        name: string
        description: string | null
        enabled: number
        steps_json: string
        created_at: number
        last_applied: number | null
        last_status: string | null
      }
    | undefined
  if (!r) return undefined
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    enabled: r.enabled ? 1 : 0,
    steps: parseSteps(r.steps_json),
    createdAt: r.created_at,
    lastApplied: r.last_applied,
    lastStatus: r.last_status,
  }
}

export function addRegistryOp(input: {
  name: string
  description?: string
  enabled?: boolean
  steps: RegistryStep[]
}): number {
  const info = db
    .prepare(
      `INSERT INTO registry_ops (name, description, enabled, steps_json)
       VALUES (@name, @description, @enabled, @steps_json)`,
    )
    .run({
      name: input.name,
      description: input.description || '',
      enabled: input.enabled === false ? 0 : 1,
      steps_json: JSON.stringify(input.steps || []),
    })
  return Number(info.lastInsertRowid)
}

export function updateRegistryOp(
  id: number,
  patch: Partial<{ name: string; description: string; enabled: boolean; steps: RegistryStep[] }>,
): void {
  const existing = getRegistryOpById(id)
  if (!existing) return
  const stmt = db.prepare(`
    UPDATE registry_ops
    SET name = @name,
        description = @description,
        enabled = @enabled,
        steps_json = @steps_json
    WHERE id = @id
  `)
  stmt.run({
    id,
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
    steps_json: JSON.stringify(patch.steps ?? existing.steps),
  })
}

export function deleteRegistryOp(id: number): void {
  db.prepare('DELETE FROM registry_ops WHERE id = ?').run(id)
  db.prepare('DELETE FROM registry_history WHERE op_id = ?').run(id)
}

export function setRegistryOpResult(id: number, lastApplied: number, lastStatus: string): void {
  db.prepare('UPDATE registry_ops SET last_applied = ?, last_status = ? WHERE id = ?').run(
    lastApplied,
    lastStatus,
    id,
  )
}

export function addRegistryHistory(input: {
  opId: number
  opName: string
  action: 'apply' | 'rollback'
  status: 'success' | 'failed' | 'partial'
  message?: string
  backupDir?: string
  backupFiles?: string
}): void {
  db.prepare(
    `INSERT INTO registry_history (op_id, op_name, action, status, message, backup_dir, backup_files)
     VALUES (@opId, @opName, @action, @status, @message, @backupDir, @backupFiles)`,
  ).run({
    opId: input.opId,
    opName: input.opName,
    action: input.action,
    status: input.status,
    message: input.message || null,
    backupDir: input.backupDir || null,
    backupFiles: input.backupFiles || null,
  })
}

export function getRegistryHistory(limit = 200): RegistryHistoryEntry[] {
  const rows = db
    .prepare('SELECT * FROM registry_history ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<{
    id: number
    op_id: number
    op_name: string
    action: string
    status: string
    message: string | null
    backup_dir: string | null
    backup_files: string | null
    created_at: number
  }>
  return rows.map((r) => ({
    id: r.id,
    opId: r.op_id,
    opName: r.op_name,
    action: r.action as 'apply' | 'rollback',
    status: r.status as 'success' | 'failed' | 'partial',
    message: r.message,
    backupDir: r.backup_dir,
    backupFiles: r.backup_files,
    createdAt: r.created_at,
  }))
}

// ====== 全局搜索已迁移为 filesearch 模块（见 src/main/filesearch） ======

export { db }
