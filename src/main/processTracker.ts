import { spawn, execSync, execFile } from 'node:child_process'
import path from 'node:path'
import { db, logToDb } from './db'

export interface ProcessEvent {
  pid: number
  processName: string
  path: string
  timestamp: number
}

export interface ProcessTrackerStatus {
  active: boolean
  mode: 'etw' | 'snapshot' | 'idle'
  eventCount: number
  lastError?: string
}

// 事件存活窗口 12s：需略大于采样间隔（10s），否则两轮采样之间有归因盲区。
// 旧方案 30s 采样 + 8s 窗口有 22s 盲区，但那是 fork PowerShell 时代的妥协；
// tasklist 采样足够便宜，可以同时兼顾频率与连续性。
const MAX_AGE_MS = 12000
const MAX_EVENTS = 5000       // 最大存储从 15000 → 5000
const CLEANUP_INTERVAL_MS = 5000   // 清理间隔从 3s → 5s
// 轻采样间隔：tasklist 是原生小工具（毫秒级启动、无 .NET 运行时），10s 一次的
// 成本远低于旧方案（常驻 PowerShell 每 30s 跑一次 Get-Process 全列，光子进程
// 本身就常驻 100~200MB）。采样更密，事件溯源的时效窗口反而更好。
const SNAPSHOT_INTERVAL_MS = 10_000

const eventStore = new Map<string, ProcessEvent>()
const pathIndex = new Map<string, ProcessEvent>()
// 按时间排序的事件快照数组，用于加速 lookupProcess
const sortedEvents: ProcessEvent[] = []
let sortedEventsDirty = false

let etwProcess: ReturnType<typeof spawn> | null = null
let snapshotTimer: NodeJS.Timeout | null = null
let mode: ProcessTrackerStatus['mode'] = 'idle'
let eventCount = 0
let lastError = ''
let cleanupTimer: NodeJS.Timeout | null = null

// ── tasklist 输出解析 ──
// /FO CSV /NH 输出形如："chrome.exe","1234","Console","1","123,456 K"
// 用一个小状态机解析引号字段，进程名里带逗号也不会切错列。
function parseTasklistCsv(stdout: string): Array<{ pid: number; name: string }> {
  const out: Array<{ pid: number; name: string }> = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const fields: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuote) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++ } else inQuote = false
        } else cur += ch
      } else if (ch === '"') {
        inQuote = true
      } else if (ch === ',') {
        fields.push(cur)
        cur = ''
      } else cur += ch
    }
    fields.push(cur)
    if (fields.length < 2) continue
    const pid = Number.parseInt(fields[1], 10)
    if (!Number.isFinite(pid) || pid <= 0) continue
    out.push({ pid, name: fields[0] })
  }
  return out
}

function runTasklist(): Promise<Array<{ pid: number; name: string }>> {
  return new Promise((resolve, reject) => {
    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf-8' },
      (err, stdout) => (err ? reject(err) : resolve(parseTasklistCsv(String(stdout || '')))),
    )
  })
}

function normalizePath(p: string) {
  return path.normalize(p).toLowerCase()
}

// 进程名解析结果缓存：这里**不能用 execSync**，也不能逐 pid fork powershell。
// 旧实现缓存未命中时每个未知 pid 都同步/异步 fork 一次 powershell.exe（单次
// 300~500ms），进程风暴下主线程和子进程创建同时被打爆。现在改为：
//   1) 命中缓存直接返回；
//   2) 未命中先把 pid 攒进待查集合，去抖 400ms 后跑一次 tasklist 全量快照
//      （原生小工具，几十毫秒），一次性解析所有 pid 并回填缓存与已有事件。
const processNameCache = new Map<number, { name: string; ts: number }>()
const PROCESS_NAME_TTL = 5 * 60 * 1000
const pendingNameLookups = new Set<number>()
const MAX_PENDING_LOOKUPS = 128
let nameFlushTimer: NodeJS.Timeout | null = null
let nameFlushInFlight = false

function backfillProcessName(pid: number, name: string): void {
  if (!name) return
  for (const evt of eventStore.values()) {
    if (evt.pid === pid && !evt.processName) evt.processName = name
  }
  for (const [p, evt] of pathIndex) {
    if (evt.pid === pid && !evt.processName) {
      evt.processName = name
      pathIndex.set(p, evt)
    }
  }
}

function flushProcessNameLookups(): void {
  nameFlushTimer = null
  if (nameFlushInFlight || pendingNameLookups.size === 0) return
  nameFlushInFlight = true
  const wanted = new Set(pendingNameLookups)
  pendingNameLookups.clear()
  runTasklist()
    .then((rows) => {
      const byPid = new Map(rows.map((r) => [r.pid, r.name]))
      const now = Date.now()
      for (const pid of wanted) {
        const name = byPid.get(pid) ?? ''
        processNameCache.set(pid, { name, ts: now })
        backfillProcessName(pid, name)
      }
    })
    .catch(() => {
      // tasklist 失败：给这些 pid 记一个空名短缓存，避免无限重试风暴
      const now = Date.now()
      for (const pid of wanted) processNameCache.set(pid, { name: '', ts: now - PROCESS_NAME_TTL / 2 })
    })
    .finally(() => {
      nameFlushInFlight = false
      if (processNameCache.size > 2000) {
        const keep = [...processNameCache.entries()].slice(-1000)
        processNameCache.clear()
        for (const [k, v] of keep) processNameCache.set(k, v)
      }
      // 期间又有新 pid 进来 → 继续下一轮
      if (pendingNameLookups.size > 0) scheduleNameFlush()
    })
}

function scheduleNameFlush(): void {
  if (nameFlushTimer) return
  nameFlushTimer = setTimeout(flushProcessNameLookups, 400)
  ;(nameFlushTimer as any).unref?.()
}

function resolveProcessName(pid: number): string {
  if (pid <= 0) return ''
  const now = Date.now()
  const hit = processNameCache.get(pid)
  if (hit && now - hit.ts < PROCESS_NAME_TTL) return hit.name
  if (!pendingNameLookups.has(pid) && pendingNameLookups.size < MAX_PENDING_LOOKUPS) {
    pendingNameLookups.add(pid)
    scheduleNameFlush()
  }
  return hit?.name ?? ''
}

function ingestEvent(evt: Partial<ProcessEvent>) {
  if (!evt.path && !evt.processName) return
  const pid = evt.pid ?? 0
  const processName = evt.processName || resolveProcessName(pid)
  const entry: ProcessEvent = {
    pid,
    processName,
    path: normalizePath(evt.path || ''),
    timestamp: evt.timestamp || Date.now(),
  }
  const eventKey = `${entry.pid}:${entry.path}:${entry.timestamp}`
  eventStore.set(eventKey, entry)
  if (entry.path) {
    pathIndex.set(entry.path, entry)
  }
  eventCount = eventStore.size
  sortedEventsDirty = true

  while (eventStore.size > MAX_EVENTS) {
    const firstKey = eventStore.keys().next().value
    if (!firstKey) break
    eventStore.delete(firstKey)
  }
}

function cleanupOldEvents() {
  const now = Date.now()
  let changed = false
  for (const [key, evt] of eventStore) {
    if (now - evt.timestamp > MAX_AGE_MS) {
      eventStore.delete(key)
      changed = true
    }
  }
  for (const [key, evt] of pathIndex) {
    if (now - evt.timestamp > MAX_AGE_MS) {
      pathIndex.delete(key)
      changed = true
    }
  }
  if (changed) {
    eventCount = eventStore.size
    sortedEventsDirty = true
  }
}

const etwPsScript = `
$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  wevtutil sl Microsoft-Windows-Kernel-File /e:true 2>&1 | Out-Null
} catch {}

$q = @'
<QueryList>
  <Query Id="0">
    <Select Path="Microsoft-Windows-Kernel-File">*</Select>
  </Query>
</QueryList>
'@

try {
  # 仅预取最近 200 条建立初始进程映射，避免 -Oldest 重放全部历史事件灌爆主进程
  Get-WinEvent -FilterXml $q -MaxEvents 200 | ForEach-Object {
    try {
      $xml = [xml]$_.ToXml()
      $eid = [int]$xml.Event.System.EventID
      $pid = [int]$xml.Event.System.Execution.ProcessID
      $data = @{}
      foreach ($d in $xml.Event.EventData.Data) {
        $data[$d.Name] = $d.'#text'
      }
      $fileName = $data['FileName']
      if (-not $fileName) { continue }
      $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      $procName = if ($proc) { $proc.ProcessName } else { '' }
      $obj = [ordered]@{
        pid = $pid
        processName = $procName
        path = $fileName
        eventId = $eid
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      }
      Write-Host ($obj | ConvertTo-Json -Compress)
    } catch {}
  }
} catch {
  Write-Error "ETW_FAILED: $_"
}
`

// 检测当前进程是否已提权（管理员）。ETW 实时文件监听需要管理员权限来启用
// Microsoft-Windows-Kernel-File 提供程序；非管理员环境下 Get-WinEvent 必然失败。
function isElevated(): boolean {
  if (process.platform !== 'win32') return false
  try {
    execSync('net session >nul 2>&1', { windowsHide: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function spawnPowerShell(script: string) {
  return spawn('powershell', ['-NoProfile', '-NoLogo', '-Command', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function bindChildOutput(child: ReturnType<typeof spawn>, label: string) {
  child.stdout?.setEncoding('utf-8')
  let buffer = ''

  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed)
        if (Array.isArray(obj.snapshot)) {
          for (const item of obj.snapshot) {
            ingestEvent(item)
          }
        } else {
          ingestEvent(obj)
        }
      } catch {
        // ignore malformed lines
      }
    }
  })

  child.stderr?.setEncoding('utf-8')
  child.stderr?.on('data', (chunk: string) => {
    const text = chunk.trim()
    if (!text) return
    lastError = text.slice(0, 200)
    if (text.includes('ETW_FAILED')) {
      logToDb('error', 'processTracker', `[${label}] ETW 失败`, text)
    }
  })

  child.on('exit', (code) => {
    if (mode === label.toLowerCase() as ProcessTrackerStatus['mode']) {
      mode = 'idle'
    }
    if (code && code !== 0) {
      lastError = `${label} process exited with ${code}`
    }
  })
}

async function startEtwTracking(): Promise<void> {
  if (etwProcess && !etwProcess.killed) return

  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawnPowerShell(etwPsScript)
    etwProcess = child

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        mode = 'etw'
        resolve()
      }
    }, 3000)

    child.stdout?.once('data', () => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        mode = 'etw'
        resolve()
      }
    })

    child.stderr?.once('data', (chunk: string) => {
      if (settled) return
      const text = chunk.toString()
      if (text.includes('ETW_FAILED') || text.includes('拒绝访问') || text.includes('Access is denied')) {
        settled = true
        clearTimeout(timeout)
        child.kill()
        etwProcess = null
        reject(new Error(text))
      }
    })

    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        child.kill()
        etwProcess = null
        reject(err)
      }
    })

    child.on('exit', (code) => {
      if (!settled && code !== 0) {
        settled = true
        clearTimeout(timeout)
        etwProcess = null
        reject(new Error(`ETW process exited with ${code}`))
        return
      }
      if (settled && mode === 'etw') {
        mode = 'idle'
        startSnapshotTracking()
      }
    })

    bindChildOutput(child, 'ETW')
  })
}

// 轻采样模式：Node 定时跑 tasklist（原生工具，毫秒级启动、退出即释放全部资源），
// 不再常驻任何 PowerShell 子进程 —— 旧方案的光 powershell.exe 本身就常驻 100~200MB。
// 代价：tasklist 拿不到 exe 完整路径，快照事件的 path 为空，
// lookupProcess 里「exe 同目录加权」这条启发式会弱化，但按时效/进程名的匹配仍然有效。
function startSnapshotTracking() {
  if (snapshotTimer) return
  mode = 'snapshot'
  const sampleOnce = () => {
    runTasklist()
      .then((rows) => {
        const now = Date.now()
        for (const row of rows) {
          ingestEvent({ pid: row.pid, processName: row.name, path: '', timestamp: now })
        }
      })
      .catch((err) => {
        lastError = String((err as Error)?.message || err)
      })
  }
  sampleOnce()
  snapshotTimer = setInterval(sampleOnce, SNAPSHOT_INTERVAL_MS)
  ;(snapshotTimer as any).unref?.()
}

export function startProcessTracking() {
  if (process.platform !== 'win32') {
    mode = 'idle'
    lastError = '仅支持 Windows 平台'
    return
  }
  if (mode !== 'idle') return

  if (!cleanupTimer) {
    cleanupTimer = setInterval(cleanupOldEvents, CLEANUP_INTERVAL_MS)
  }

  // ETW 会执行 wevtutil 启用**全系统**的 Kernel-File 事件通道（所有文件 I/O 都
  // 进事件日志，系统级内存/磁盘开销巨大），因此改为显式 opt-in：
  // 设置 process_tracker_etw=true 且以管理员运行时才启用；默认走 tasklist 轻采样。
  let etwEnabled = false
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'process_tracker_etw'").get() as
      | { value: string }
      | undefined
    if (row) etwEnabled = JSON.parse(row.value) === true
  } catch {
    /* ignore */
  }

  if (etwEnabled) {
    if (!isElevated()) {
      lastError = 'ETW 实时监听需要管理员权限，已使用轻采样模式'
      logToDb('info', 'processTracker', '未以管理员身份运行，ETW 需管理员权限，使用轻采样模式', '')
      startSnapshotTracking()
      return
    }
    // Prefer ETW; fall back to snapshot immediately on failure.
    startEtwTracking().catch((err) => {
      logToDb('info', 'processTracker', 'ETW 不可用，降级到轻采样模式', err.message)
      startSnapshotTracking()
    })
    return
  }

  startSnapshotTracking()
}

export function stopProcessTracking() {
  if (etwProcess && !etwProcess.killed) {
    etwProcess.kill()
    etwProcess = null
  }
  if (snapshotTimer) {
    clearInterval(snapshotTimer)
    snapshotTimer = null
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
  mode = 'idle'
  eventStore.clear()
  pathIndex.clear()
  sortedEvents.length = 0
  sortedEventsDirty = false
  eventCount = 0
}

// 重建节流：lookupProcess 位于每个文件事件的热路径上。事件风暴时每条事件都
// 会触发 buildSortedEvents（对最多 5000 条全量排序）—— O(n log n)/事件。
// 加 500ms 最小重建间隔：归因精度本就是秒级，代价几乎为零。
const SORTED_REBUILD_MIN_INTERVAL_MS = 500
let lastSortedBuildAt = 0

function buildSortedEvents() {
  if (!sortedEventsDirty) return
  const now = Date.now()
  if (now - lastSortedBuildAt < SORTED_REBUILD_MIN_INTERVAL_MS) return
  lastSortedBuildAt = now
  sortedEvents.length = 0
  for (const evt of eventStore.values()) {
    if (!evt.processName) continue
    if (now - evt.timestamp >= MAX_AGE_MS) continue
    sortedEvents.push(evt)
  }
  sortedEvents.sort((a, b) => b.timestamp - a.timestamp)
  sortedEventsDirty = false
}

export function lookupProcess(filePath: string): ProcessEvent | undefined {
  const normalized = normalizePath(filePath)

  // exact path match (from ETW)
  const exact = pathIndex.get(normalized)
  if (exact) return exact

  // parent directory match (from ETW)
  let current = normalized
  for (let i = 0; i < 8 && current.length > 3; i++) {
    const parent = path.dirname(current)
    if (parent === current) break
    const parentEvt = pathIndex.get(parent)
    if (parentEvt) return parentEvt
    current = parent
  }

  // snapshot heuristic: only scan recent events, with early exit
  if (mode === 'snapshot') {
    buildSortedEvents()
    let best: ProcessEvent | undefined
    let bestScore = -1
    const now = Date.now()
    const iterLimit = Math.min(sortedEvents.length, 200) // 最多检查 200 条

    for (let i = 0; i < iterLimit; i++) {
      const evt = sortedEvents[i]
      if (!evt.processName) continue
      const delta = now - evt.timestamp
      if (delta >= MAX_AGE_MS) break  // sorted by time desc, rest are older

      let score = 0
      // prefer recent events
      if (delta < 3000) score += 10
      else if (delta < 6000) score += 5
      else score += 1

      // boost if file path is under the process executable directory
      if (evt.path && normalized.startsWith(normalizePath(path.dirname(evt.path)))) {
        score += 20
      }
      // boost if process name appears in the file path
      if (evt.processName && normalized.includes(evt.processName.toLowerCase())) {
        score += 5
      }

      if (score > bestScore) {
        bestScore = score
        best = evt
        if (score >= 30) break  // high-confidence match, early exit
      }
    }
    return best
  }

  return undefined
}

export function getProcessTrackerStatus(): ProcessTrackerStatus {
  return {
    active: mode !== 'idle',
    mode,
    eventCount,
    lastError: lastError || undefined,
  }
}
