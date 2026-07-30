import { execFile } from 'node:child_process'
import dns from 'node:dns'
import { logToDb } from './db'

// ─────────────────────────────────────────────────────────────
// IP 追踪 / 网络动作路径采集模块
//
// 通过 PowerShell 的 Get-NetTCPConnection / Get-NetUDPEndpoint 拉取全量
// 网络连接，再用 Get-Process 关联 PID → 进程名 + exe 路径。两次采样之间做
// diff，生成 connect / close / listen 事件，形成「网络动作路径」时间线。
// ─────────────────────────────────────────────────────────────

export interface RawConnection {
  protocol: 'TCP' | 'UDP'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  owningProcess: number
}

export interface ProcMeta {
  name: string
  path: string
}

export interface NetConnection {
  id: string
  protocol: 'TCP' | 'UDP'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
  processPath: string
  remoteHost?: string
  isExternal: boolean
  firstSeen: number
  lastSeen: number
}

export type NetAction = 'connect' | 'close' | 'listen'

export interface NetEvent {
  id: string
  ts: number
  action: NetAction
  protocol: 'TCP' | 'UDP'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
  processPath: string
  isExternal: boolean
}

export interface NetStatus {
  active: boolean
  intervalMs: number
  resolveHosts: boolean
  lastError?: string
  connCount: number
  extCount: number
  eventCount: number
  lastSampleAt?: number
  startedAt?: number
}

const DEFAULT_INTERVAL = 4000
const MAX_EVENTS = 4000
const HOST_CONCURRENCY = 12

// 单次 PowerShell 调用同时取连接 + 进程元数据，减少 powershell.exe fork 次数。
// 注意：State 在 PowerShell 7 / 5.1 经 ConvertTo-Json 会被序列化为数值，必须显式 .ToString() 取名称。
const POWERSHELL_SCRIPT = `
$conns = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | ForEach-Object {
  [PSCustomObject]@{
    protocol='TCP'
    localAddress=$_.LocalAddress
    localPort=[int]$_.LocalPort
    remoteAddress=$_.RemoteAddress
    remotePort=[int]$_.RemotePort
    state=$(if($_.State){$_.State.ToString()}else{''})
    owningProcess=[int]$_.OwningProcess
  }
})
$udp = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object {
  [PSCustomObject]@{
    protocol='UDP'
    localAddress=$_.LocalAddress
    localPort=[int]$_.LocalPort
    remoteAddress=''
    remotePort=0
    state=''
    owningProcess=[int]$_.OwningProcess
  }
})
$all = $conns + $udp
$pids = @($all | Select-Object -ExpandProperty owningProcess -Unique)
$procs = @($pids | ForEach-Object {
  $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
  [PSCustomObject]@{ pid=[int]$_; name=$(if($p){$p.ProcessName}else{''}); path=$(if($p){$p.Path}else{''}) }
})
$fc = if($all.Count -eq 0){'[]'} elseif($all.Count -eq 1){'['+($all|ConvertTo-Json -Compress)+']'} else {$all|ConvertTo-Json -Compress}
$fp = if($procs.Count -eq 0){'[]'} elseif($procs.Count -eq 1){'['+($procs|ConvertTo-Json -Compress)+']'} else {$procs|ConvertTo-Json -Compress}
"CONNS:$fc"
"PROCS:$fp"
`

function runSnapshot(): Promise<{ conns: RawConnection[]; procs: Map<number, ProcMeta> }> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SCRIPT],
      { windowsHide: true, timeout: 20000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return reject(err)
        try {
          const conns: RawConnection[] = []
          const procs = new Map<number, ProcMeta>()
          for (const line of stdout.split(/\r?\n/)) {
            if (line.startsWith('CONNS:')) {
              const arr = JSON.parse(line.slice(6)) as Array<Record<string, unknown>>
              for (const c of arr) {
                conns.push({
                  protocol: c.protocol === 'UDP' ? 'UDP' : 'TCP',
                  localAddress: String(c.localAddress ?? ''),
                  localPort: Number(c.localPort) || 0,
                  remoteAddress: String(c.remoteAddress ?? ''),
                  remotePort: Number(c.remotePort) || 0,
                  state: String(c.state ?? ''),
                  owningProcess: Number(c.owningProcess) || 0,
                })
              }
            } else if (line.startsWith('PROCS:')) {
              const arr = JSON.parse(line.slice(6)) as Array<Record<string, unknown>>
              for (const p of arr) {
                procs.set(Number(p.pid) || 0, {
                  name: String(p.name ?? ''),
                  path: String(p.path ?? ''),
                })
              }
            }
          }
          resolve({ conns, procs })
        } catch (e) {
          reject(e)
        }
      },
    )
  })
}

// 判断地址是否为内部/本地地址（非公网）
function isInternalAddress(addr: string): boolean {
  if (!addr) return true // 空 = 监听 / 无远程端点
  if (addr === '::' || addr === '0.0.0.0' || addr === '::1' || addr === '127.0.0.1' || addr.toLowerCase() === 'localhost') {
    return true
  }
  let a = addr
  if (a.startsWith('::ffff:')) a = a.slice(7) // IPv4-mapped IPv6
  // IPv6：link-local / ULA / 组播
  if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('ff')) return true
  // IPv4 私有段
  if (a.startsWith('10.') || a.startsWith('192.168.') || a.startsWith('169.254.')) return true
  if (a.startsWith('172.')) {
    const seg = parseInt(a.split('.')[1] ?? '0', 10)
    if (seg >= 16 && seg <= 31) return true
  }
  return false
}

const activeMap = new Map<string, NetConnection>()
const eventLog: NetEvent[] = []
const hostCache = new Map<string, { host: string; ts: number }>()
let timer: NodeJS.Timeout | null = null
let intervalMs = DEFAULT_INTERVAL
let resolveHosts = false
let active = false
let lastError = ''
let lastSampleAt = 0
let startedAt = 0
let eventSeq = 0

function makeId(c: RawConnection): string {
  return `${c.protocol}|${c.localAddress}|${c.localPort}|${c.remoteAddress}|${c.remotePort}|${c.owningProcess}`
}

function connMeta(c: NetConnection) {
  return {
    protocol: c.protocol,
    localAddress: c.localAddress,
    localPort: c.localPort,
    remoteAddress: c.remoteAddress,
    remotePort: c.remotePort,
    state: c.state,
    pid: c.pid,
    processName: c.processName,
    processPath: c.processPath,
    isExternal: c.isExternal,
  }
}

function pushEvent(e: Omit<NetEvent, 'id'>) {
  eventSeq += 1
  eventLog.push({ id: `${e.ts}-${eventSeq}`, ...e })
  if (eventLog.length > MAX_EVENTS) {
    eventLog.splice(0, eventLog.length - MAX_EVENTS)
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ])
}

async function resolveHostsForActive() {
  const ips = new Set<string>()
  for (const c of activeMap.values()) {
    if (c.isExternal && c.remoteAddress && !hostCache.has(c.remoteAddress)) {
      ips.add(c.remoteAddress)
    }
  }
  const list = Array.from(ips).slice(0, 200)
  for (let i = 0; i < list.length; i += HOST_CONCURRENCY) {
    const batch = list.slice(i, i + HOST_CONCURRENCY)
    await Promise.all(
      batch.map(async (ip) => {
        try {
          const hosts = await withTimeout(dns.promises.reverse(ip), 2000)
          if (hosts && hosts.length) hostCache.set(ip, { host: hosts[0], ts: Date.now() })
        } catch {
          // 无 PTR 记录，保持 IP 原样
        }
      }),
    )
  }
  for (const c of activeMap.values()) {
    if (c.isExternal && c.remoteAddress) {
      const h = hostCache.get(c.remoteAddress)
      if (h) c.remoteHost = h.host
    }
  }
}

async function sample() {
  try {
    const { conns, procs } = await runSnapshot()
    const now = Date.now()
    const seen = new Set<string>()
    for (const c of conns) {
      const id = makeId(c)
      seen.add(id)
      const meta = procs.get(c.owningProcess) || { name: '', path: '' }
      const isExt = !isInternalAddress(c.remoteAddress)
      const prev = activeMap.get(id)
      if (!prev) {
        const conn: NetConnection = {
          id,
          protocol: c.protocol,
          localAddress: c.localAddress,
          localPort: c.localPort,
          remoteAddress: c.remoteAddress,
          remotePort: c.remotePort,
          state: c.state,
          pid: c.owningProcess,
          processName: meta.name,
          processPath: meta.path,
          isExternal: isExt,
          firstSeen: now,
          lastSeen: now,
        }
        activeMap.set(id, conn)
        const isListen = c.protocol === 'TCP' && (c.state === 'Listen' || c.remotePort === 0)
        pushEvent({ ts: now, action: isListen ? 'listen' : 'connect', ...connMeta(conn) })
      } else {
        prev.lastSeen = now
        prev.state = c.state
        if (meta.name) prev.processName = meta.name
        if (meta.path) prev.processPath = meta.path
      }
    }
    // 出现在上次采样、本次消失 → close
    for (const [id, conn] of activeMap) {
      if (!seen.has(id)) {
        pushEvent({ ts: now, action: 'close', ...connMeta(conn) })
        activeMap.delete(id)
      }
    }
    lastSampleAt = now
    lastError = ''
    if (resolveHosts) void resolveHostsForActive()
  } catch (e) {
    lastError = String((e as Error)?.message || e)
    logToDb('error', 'network', '网络快照采集失败', lastError)
  }
}

// ── 对外 API ──

export function startNetworkTracer(interval = DEFAULT_INTERVAL) {
  if (active) {
    if (interval) setNetInterval(interval)
    return
  }
  intervalMs = Math.max(1000, interval)
  active = true
  startedAt = Date.now()
  void sample()
  timer = setInterval(() => void sample(), intervalMs)
  logToDb('info', 'network', '网络追踪已启动', `interval=${intervalMs}ms`)
}

export function stopNetworkTracer() {
  active = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  logToDb('info', 'network', '网络追踪已停止', '')
}

export function setNetInterval(ms: number) {
  intervalMs = Math.max(1000, ms)
  if (active && timer) {
    clearInterval(timer)
    timer = setInterval(() => void sample(), intervalMs)
  }
}

export function setNetResolve(on: boolean) {
  resolveHosts = !!on
  if (on) void resolveHostsForActive()
}

export function clearNetEvents() {
  eventLog.length = 0
}

export function snapshotNetNow() {
  return sample()
}

export function getNetConnections(): NetConnection[] {
  return Array.from(activeMap.values()).sort((a, b) => {
    if (a.isExternal !== b.isExternal) return a.isExternal ? -1 : 1
    return b.lastSeen - a.lastSeen
  })
}

export function getNetEvents(limit = 200): NetEvent[] {
  return eventLog.slice(-limit).reverse()
}

export function getNetStatus(): NetStatus {
  let ext = 0
  for (const c of activeMap.values()) if (c.isExternal) ext += 1
  return {
    active,
    intervalMs,
    resolveHosts,
    lastError: lastError || undefined,
    connCount: activeMap.size,
    extCount: ext,
    eventCount: eventLog.length,
    lastSampleAt: lastSampleAt || undefined,
    startedAt: startedAt || undefined,
  }
}
