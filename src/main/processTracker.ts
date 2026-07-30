import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
import { logToDb } from './db'

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

const MAX_AGE_MS = 8000       // 事件存活时间从 12s → 8s
const MAX_EVENTS = 5000       // 最大存储从 15000 → 5000
const CLEANUP_INTERVAL_MS = 5000   // 清理间隔从 3s → 5s
// 快照轮询间隔：从 5s → 30s。每 5s fork 一次 powershell.exe 跑 Get-Process 全列（含 path）
// 在主进程事件循环上是有显著代价的——30s 已经足够把事件溯源精度做在「秒级」以内。
const SNAPSHOT_INTERVAL_MS = 30_000

const eventStore = new Map<string, ProcessEvent>()
const pathIndex = new Map<string, ProcessEvent>()
// 按时间排序的事件快照数组，用于加速 lookupProcess
const sortedEvents: ProcessEvent[] = []
let sortedEventsDirty = false

let etwProcess: ReturnType<typeof spawn> | null = null
let snapshotProcess: ReturnType<typeof spawn> | null = null
let mode: ProcessTrackerStatus['mode'] = 'idle'
let eventCount = 0
let lastError = ''
let cleanupTimer: NodeJS.Timeout | null = null

function normalizePath(p: string) {
  return path.normalize(p).toLowerCase()
}

// 进程名解析结果缓存：resolveProcessName 走同步 execSync 启动 PowerShell，
// 单次约 300~500ms 且会阻塞主进程事件循环；监控开启、高频文件事件反复缺失进程名时，
// 若每次都调用将拖慢所有 IPC（含对话框）。同一 pid 短时间内命中缓存即可跳过同步调用。
//（默认监控关闭，此兜底路径极少触发，但加上缓存可彻底消除极端情况下的主线程阻塞。）
const processNameCache = new Map<number, { name: string; ts: number }>()
const PROCESS_NAME_TTL = 5 * 60 * 1000

function resolveProcessName(pid: number): string {
  if (pid <= 0) return ''
  const now = Date.now()
  const hit = processNameCache.get(pid)
  if (hit && now - hit.ts < PROCESS_NAME_TTL) return hit.name
  let name = ''
  try {
    const out = execSync(
      `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName`,
      { shell: 'powershell', encoding: 'utf-8', windowsHide: true, timeout: 2000 },
    )
    name = out.trim()
  } catch {
    /* ignore */
  }
  processNameCache.set(pid, { name, ts: now })
  if (processNameCache.size > 2000) {
    const keep = [...processNameCache.entries()].slice(-1000)
    processNameCache.clear()
    for (const [k, v] of keep) processNameCache.set(k, v)
  }
  return name
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

const snapshotPsScript = `
$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 间隔放大到 30s 后，主进程 fork powershell + Get-Process 全列的频率从每 5s 降到每 30s，
# 大幅减少主进程事件循环上的高频 IO 抢占——避免与 chokidar / SQLite 抢资源。
$sleepSec = ${Math.floor(SNAPSHOT_INTERVAL_MS / 1000)}

while ($true) {
  try {
    $procs = Get-Process | Where-Object { $_.Id -gt 0 } | Select-Object Id, ProcessName, Path
    $arr = @()
    foreach ($p in $procs) {
      $arr += [ordered]@{
        pid = [int]$p.Id
        processName = [string]$p.ProcessName
        path = [string]$p.Path
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      }
    }
    Write-Host (@{ snapshot = $arr } | ConvertTo-Json -Compress)
  } catch {}
  Start-Sleep -Seconds $sleepSec
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

function startSnapshotTracking() {
  if (snapshotProcess && !snapshotProcess.killed) return
  mode = 'snapshot'
  snapshotProcess = spawnPowerShell(snapshotPsScript)
  bindChildOutput(snapshotProcess, 'Snapshot')
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

  // ETW 实时文件监听需要管理员权限启用 Microsoft-Windows-Kernel-File 提供程序。
  // 非管理员环境下 Get-WinEvent 必然失败并退出（exit 1），因此直接走快照模式，
  // 避免无意义的 ETW 尝试、3 秒等待与噪声日志。
  if (!isElevated()) {
    lastError = '需要管理员权限才能启用 ETW 实时监听，已使用快照模式'
    logToDb('info', 'processTracker', '未以管理员身份运行，ETW 需管理员权限，直接使用快照模式', '')
    startSnapshotTracking()
    return
  }

  // Prefer ETW; fall back to snapshot immediately on failure.
  startEtwTracking().catch((err) => {
    logToDb('info', 'processTracker', 'ETW 不可用，降级到快照模式', err.message)
    startSnapshotTracking()
  })
}

export function stopProcessTracking() {
  if (etwProcess && !etwProcess.killed) {
    etwProcess.kill()
    etwProcess = null
  }
  if (snapshotProcess && !snapshotProcess.killed) {
    snapshotProcess.kill()
    snapshotProcess = null
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

function buildSortedEvents() {
  if (!sortedEventsDirty) return
  sortedEvents.length = 0
  const now = Date.now()
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
