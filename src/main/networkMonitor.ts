import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export type Severity = 'high' | 'medium' | 'low' | 'info'
export type ArpAlertType = 'spoof' | 'mac-change' | 'gateway-mismatch' | 'new-device'
export type DhcpAlertType = 'rogue' | 'server-change' | 'multiple'

export interface NetAdapterStat {
  name: string
  bytesIn: number
  bytesOut: number
  recvRate: number
  sendRate: number
}

export interface TrafficSnapshot {
  adapters: NetAdapterStat[]
  totalRecvRate: number
  totalSendRate: number
  connections: number
  byState: Record<string, number>
  topProcesses: { pid: number; name: string; conns: number }[]
  timestamp: number
}

export interface ArpEntry {
  ip: string
  mac: string
  iface: string
  state: string
}

export interface ArpAlertItem {
  id: string
  type: ArpAlertType
  severity: Severity
  ip: string
  mac?: string
  message: string
  timestamp: number
  blocked: boolean
  blockIp?: string
}

export interface ArpSnapshot {
  table: ArpEntry[]
  gateway: { ip: string; mac: string; iface: string } | null
  baselineSet: boolean
  gatewayPinned: boolean
  blockedIps: string[]
  alerts: ArpAlertItem[]
  timestamp: number
}

export interface DhcpAdapter {
  name: string
  dhcpEnabled: boolean
  dhcpServer: string
  leaseObtained: string
  leaseExpires: string
}

export interface DhcpAlertItem {
  id: string
  type: DhcpAlertType
  severity: Severity
  adapter: string
  server: string
  message: string
  timestamp: number
  blocked: boolean
}

export interface DhcpSnapshot {
  adapters: DhcpAdapter[]
  allowlist: string[]
  authorized: boolean
  alerts: DhcpAlertItem[]
  timestamp: number
}

export interface NetEvent {
  id: string
  type: 'arp' | 'dhcp'
  severity: Severity
  title: string
  message: string
  timestamp: number
  action?: string
}

export interface NetStatus {
  enabled: boolean
  autoProtect: boolean
  traffic: TrafficSnapshot | null
  arp: ArpSnapshot | null
  dhcp: DhcpSnapshot | null
  events: NetEvent[]
  lastError?: string
}

interface PersistState {
  baseline: Record<string, { mac: string; iface: string }>
  gateway: { ip: string; mac: string; iface: string } | null
  gatewayPinned: boolean
  blockedIps: string[]
  dhcpAllowlist: string[]
  dhcpBaseline: Record<string, string>
  autoProtect: boolean
}

interface ArpActive {
  type: ArpAlertType
  severity: Severity
  ip: string
  mac?: string
  message: string
  autoBlock: boolean
  blockIp?: string
}

interface DhcpActive {
  type: DhcpAlertType
  severity: Severity
  adapter: string
  server: string
  message: string
  autoBlock: boolean
}

function ps(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr ? `${err.message} | stderr: ${stderr}` : err.message
          return reject(new Error(msg))
        }
        resolve(stdout || '')
      },
    )
  })
}

function cleanJson(out: string): string {
  let s = out.replace(/^﻿/, '').trim()
  if (!s) return s
  // 保留数组或对象结构的完整边界
  if (s.startsWith('[') && s.endsWith(']')) return s
  if (s.startsWith('{') && s.endsWith('}')) return s
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first >= 0 && last >= first) s = s.slice(first, last + 1)
  return s
}

export class NetworkMonitor {
  private enabled = false
  private timers: NodeJS.Timeout[] = []
  private push: (channel: string, payload: unknown) => void
  private loaded = false
  private state!: PersistState
  private prevTraffic: { ts: number; adapters: Record<string, { bytesIn: number; bytesOut: number }> } | null = null
  private arpAlerts: ArpAlertItem[] = []
  private dhcpAlerts: DhcpAlertItem[] = []
  private events: NetEvent[] = []
  private lastTraffic: TrafficSnapshot | null = null
  private lastArp: ArpSnapshot | null = null
  private lastDhcp: DhcpSnapshot | null = null
  private lastError = ''

  constructor(push: (channel: string, payload: unknown) => void) {
    this.push = push
  }

  // ── 持久化 ──
  private storePath(): string {
    return path.join(app.getPath('userData'), 'network-monitor.json')
  }

  private defaultState(): PersistState {
    return {
      baseline: {},
      gateway: null,
      gatewayPinned: false,
      blockedIps: [],
      dhcpAllowlist: [],
      dhcpBaseline: {},
      autoProtect: true,
    }
  }

  private ensureLoaded() {
    if (this.loaded) return
    this.loaded = true
    try {
      if (fs.existsSync(this.storePath())) {
        const raw = JSON.parse(fs.readFileSync(this.storePath(), 'utf-8'))
        this.state = { ...this.defaultState(), ...raw }
        return
      }
    } catch {
      /* ignore */
    }
    this.state = this.defaultState()
  }

  private saveState() {
    try {
      fs.writeFileSync(this.storePath(), JSON.stringify(this.state), 'utf-8')
    } catch {
      /* ignore */
    }
  }

  // ── netsh 辅助 ──
  private runNetsh(args: string[]): Promise<void> {
    return new Promise((resolve) => {
      execFile('netsh', args, { windowsHide: true, timeout: 15000 }, () => resolve())
    })
  }

  private blockIpInternal(ip: string) {
    if (!ip || this.state.blockedIps.includes(ip)) return
    void this.runNetsh(['advfirewall', 'firewall', 'add', 'rule', `name=AgentSC-Block-${ip}`, 'dir=out', 'action=block', `remoteip=${ip}`])
    void this.runNetsh(['advfirewall', 'firewall', 'add', 'rule', `name=AgentSC-Block-${ip}-in`, 'dir=in', 'action=block', `remoteip=${ip}`])
    this.state.blockedIps.push(ip)
    this.saveState()
  }

  private unblockIpInternal(ip: string) {
    void this.runNetsh(['advfirewall', 'firewall', 'delete', 'rule', `name=AgentSC-Block-${ip}`])
    void this.runNetsh(['advfirewall', 'firewall', 'delete', 'rule', `name=AgentSC-Block-${ip}-in`])
    this.state.blockedIps = this.state.blockedIps.filter((x) => x !== ip)
    this.saveState()
  }

  private pinGatewayInternal(iface: string, ip: string, mac: string) {
    if (!iface || !ip || !mac) return
    void this.runNetsh(['interface', 'ipv4', 'delete', 'neighbors', iface, ip])
    void this.runNetsh(['interface', 'ipv4', 'add', 'neighbors', iface, ip, mac, 'store=persistent'])
    this.state.gatewayPinned = true
    this.saveState()
  }

  private unpinGatewayInternal() {
    const g = this.state.gateway
    if (g) void this.runNetsh(['interface', 'ipv4', 'delete', 'neighbors', g.iface, g.ip])
    this.state.gatewayPinned = false
    this.saveState()
  }

  // ── 事件 ──
  private alertTitle(type: string): string {
    const map: Record<string, string> = {
      spoof: 'ARP 欺骗',
      'mac-change': 'MAC 变更',
      'gateway-mismatch': '网关异常',
      'new-device': '新设备',
      rogue: '非法 DHCP 服务器',
      'server-change': 'DHCP 服务器变更',
      multiple: '多个 DHCP 服务器',
    }
    return map[type] || '安全告警'
  }

  private pushEvent(e: Omit<NetEvent, 'id' | 'timestamp'>) {
    const ev: NetEvent = {
      ...e,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    }
    this.events.unshift(ev)
    if (this.events.length > 200) this.events.length = 200
    if (e.severity === 'high') {
      this.push('toast-notification', { title: e.title, body: e.message })
    }
  }

  private pushStatus() {
    this.push('netmon:update', this.getStatus())
  }

  // ── 流量采集 ──
  private async scanTraffic() {
    const script = `
$stats = @(Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Where-Object { $_.ReceivedBytes -ne $null } | Select-Object Name, ReceivedBytes, SentBytes)
$conns = @(Get-NetTCPConnection -ErrorAction SilentlyContinue)
$procs = Get-Process -ErrorAction SilentlyContinue
$map = @{}
foreach ($c in $conns) { $id = $c.OwningProcess; $map[$id] = ($map[$id] ?? 0) + 1 }
$top = $map.Keys | ForEach-Object { $p = $procs | Where-Object { $_.Id -eq [int]$_ } | Select-Object -First 1; [PSCustomObject]@{ pid=[int]$_; name=if($p){$p.ProcessName}else{'unknown'}; conns=$map[$_] } } | Sort-Object conns -Descending | Select-Object -First 12
$states = @{}
foreach ($g in ($conns | Group-Object State)) { $states[$g.Name] = $g.Count }
[PSCustomObject]@{
  adapters = $stats
  connections = if($conns){$conns.Count}else{0}
  byState = [PSCustomObject]$states
  topProcesses = @($top)
} | ConvertTo-Json -Depth 5 -Compress
`
    let parsed: any
    try {
      const out = await ps(script)
      const cleaned = cleanJson(out)
      if (!cleaned) throw new Error('traffic script returned empty output')
      parsed = JSON.parse(cleaned)
    } catch (err) {
      this.lastError = `traffic: ${err instanceof Error ? err.message : String(err)}`
      console.error('[netmon] scanTraffic failed:', err)
      return
    }
    this.lastError = ''
    const now = Date.now()
    const dt = this.prevTraffic ? (now - this.prevTraffic.ts) / 1000 : 0
    const adaptersRaw: any = parsed.adapters
    const adaptersArr: any[] = Array.isArray(adaptersRaw) ? adaptersRaw : adaptersRaw ? [adaptersRaw] : []
    const adapters: NetAdapterStat[] = adaptersArr.map((a: any) => {
      const name = String(a.Name)
      const bytesIn = Number(a.ReceivedBytes) || 0
      const bytesOut = Number(a.SentBytes) || 0
      let recvRate = 0
      let sendRate = 0
      if (this.prevTraffic && dt > 0) {
        const prev = this.prevTraffic.adapters[name]
        if (prev) {
          recvRate = Math.max(0, (bytesIn - prev.bytesIn) / dt)
          sendRate = Math.max(0, (bytesOut - prev.bytesOut) / dt)
        }
      }
      return { name, bytesIn, bytesOut, recvRate, sendRate }
    })
    this.prevTraffic = {
      ts: now,
      adapters: Object.fromEntries(adapters.map((a) => [a.name, { bytesIn: a.bytesIn, bytesOut: a.bytesOut }])),
    }
    this.lastTraffic = {
      adapters,
      totalRecvRate: adapters.reduce((s, a) => s + a.recvRate, 0),
      totalSendRate: adapters.reduce((s, a) => s + a.sendRate, 0),
      connections: Number(parsed.connections) || 0,
      byState: parsed.byState || {},
      topProcesses: (Array.isArray(parsed.topProcesses)
        ? parsed.topProcesses
        : parsed.topProcesses
          ? [parsed.topProcesses]
          : []
      ).map((p: any) => ({
        pid: Number(p.pid) || 0,
        name: String(p.name || 'unknown'),
        conns: Number(p.conns) || 0,
      })),
      timestamp: now,
    }
  }

  // ── ARP 采集与检测 ──
  private async scanArp() {
    const script = `
$nbrs = @(Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.LinkLayerAddress -and $_.LinkLayerAddress -ne '' } | Select-Object IPAddress, LinkLayerAddress, InterfaceAlias, State)
$gwRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
$gw = if($gwRoute){ $gwRoute.NextHop } else { $null }
[PSCustomObject]@{ neighbors = $nbrs; gateway = $gw } | ConvertTo-Json -Depth 4 -Compress
`
    let parsed: any
    try {
      const out = await ps(script)
      const cleaned = cleanJson(out)
      if (!cleaned) throw new Error('arp script returned empty output')
      parsed = JSON.parse(cleaned)
    } catch (err) {
      this.lastError = `arp: ${err instanceof Error ? err.message : String(err)}`
      console.error('[netmon] scanArp failed:', err)
      return
    }
    this.lastError = ''
    const neighbors: ArpEntry[] = (parsed.neighbors || [])
      .map((n: any) => ({
        ip: String(n.IPAddress),
        mac: String(n.LinkLayerAddress).toUpperCase(),
        iface: String(n.InterfaceAlias),
        state: String(n.State),
      }))
      .filter((n: ArpEntry) => n.mac && n.mac !== '00-00-00-00-00-00' && n.mac !== 'FF-FF-FF-FF-FF-FF')
    const gatewayIp = parsed.gateway ? String(parsed.gateway) : ''
    let gatewayMac = ''
    let gatewayIface = ''
    if (gatewayIp) {
      const g = neighbors.find((n) => n.ip === gatewayIp)
      if (g) {
        gatewayMac = g.mac
        gatewayIface = g.iface
      }
    }

    // 建立基线（首次发现网关时）
    if (!this.state.gateway && gatewayIp && gatewayMac) {
      this.state.gateway = { ip: gatewayIp, mac: gatewayMac, iface: gatewayIface }
      this.state.baseline = {}
      for (const n of neighbors) this.state.baseline[n.ip] = { mac: n.mac, iface: n.iface }
      this.saveState()
      if (this.state.autoProtect) this.pinGatewayInternal(gatewayIface, gatewayIp, gatewayMac)
    } else if (this.state.gateway && this.state.gateway.ip !== gatewayIp && gatewayIp && gatewayMac) {
      this.state.gateway = { ip: gatewayIp, mac: gatewayMac, iface: gatewayIface }
      this.saveState()
    }

    const active = this.scanArpBuildActive(neighbors, gatewayIp, gatewayMac)
    this.reconcileArp(active)
    this.lastArp = {
      table: neighbors,
      gateway: this.state.gateway,
      baselineSet: !!this.state.gateway,
      gatewayPinned: this.state.gatewayPinned,
      blockedIps: [...this.state.blockedIps],
      alerts: this.arpAlerts,
      timestamp: Date.now(),
    }
  }

  private scanArpBuildActive(neighbors: ArpEntry[], gatewayIp: string, gatewayMac: string): Map<string, ArpActive> {
    const active = new Map<string, ArpActive>()
    const byIp: Record<string, string[]> = {}
    for (const n of neighbors) {
      if (!byIp[n.ip]) byIp[n.ip] = []
      if (!byIp[n.ip].includes(n.mac)) byIp[n.ip].push(n.mac)
    }
    // 冲突 / 欺骗
    for (const ip of Object.keys(byIp)) {
      if (byIp[ip].length > 1) {
        const baseMac = this.state.baseline[ip]?.mac || this.state.gateway?.mac
        const extraMac = byIp[ip].find((m) => m !== baseMac) || byIp[ip][0]
        const attackerEntry = neighbors.find((n) => n.mac === extraMac && n.ip !== ip)
        active.set(`spoof:${ip}`, {
          type: 'spoof',
          severity: 'high',
          ip,
          mac: extraMac,
          message: `检测到 ARP 欺骗：IP ${ip} 映射到多个 MAC（${byIp[ip].join(' / ')}），疑似中间人攻击`,
          autoBlock: !!attackerEntry,
          blockIp: attackerEntry ? attackerEntry.ip : '',
        })
      }
    }
    // 网关 MAC 异常
    const g = this.state.gateway
    if (g?.mac && gatewayMac && gatewayMac !== g.mac && gatewayIp) {
      active.set('gateway-mismatch', {
        type: 'gateway-mismatch',
        severity: 'high',
        ip: gatewayIp,
        mac: gatewayMac,
        message: `网关 MAC 异常：基线 ${g.mac}，当前 ${gatewayMac}，可能存在网关劫持`,
        autoBlock: false,
      })
      if (this.state.autoProtect && g.iface) {
        this.pinGatewayInternal(g.iface, g.ip, g.mac)
      }
    }
    // 已知主机 MAC 变更
    for (const n of neighbors) {
      const base = this.state.baseline[n.ip]
      if (base?.mac && base.mac !== n.mac && n.ip !== this.state.gateway?.ip) {
        active.set(`mac:${n.ip}`, {
          type: 'mac-change',
          severity: 'medium',
          ip: n.ip,
          mac: n.mac,
          message: `主机 ${n.ip} 的 MAC 发生变更：基线 ${base.mac} → 当前 ${n.mac}`,
          autoBlock: false,
        })
      }
    }
    // 新设备（info）
    for (const n of neighbors) {
      if (this.state.baseline && !this.state.baseline[n.ip] && !(byIp[n.ip]?.length > 1)) {
        active.set(`new:${n.ip}`, {
          type: 'new-device',
          severity: 'low',
          ip: n.ip,
          mac: n.mac,
          message: `发现新设备 ${n.ip}（${n.mac}）`,
          autoBlock: false,
        })
      }
    }
    return active
  }

  private reconcileArp(active: Map<string, ArpActive>) {
    const now = Date.now()
    for (const [key, a] of active) {
      if (!this.arpAlerts.find((x) => x.id === key)) {
        const alert: ArpAlertItem = {
          id: key,
          type: a.type,
          severity: a.severity,
          ip: a.ip,
          mac: a.mac,
          message: a.message,
          timestamp: now,
          blocked: false,
          blockIp: a.blockIp,
        }
        this.arpAlerts.push(alert)
        this.pushEvent({
          type: 'arp',
          severity: a.severity,
          title: this.alertTitle(a.type),
          message: a.message,
          action: a.autoBlock && a.blockIp ? `已自动封禁攻击者 IP ${a.blockIp}` : undefined,
        })
        if (a.autoBlock && this.state.autoProtect && a.blockIp) this.blockIpInternal(a.blockIp)
      }
    }
    this.arpAlerts = this.arpAlerts.filter((x) => active.has(x.id))
    this.arpAlerts = this.arpAlerts.map((x) => ({
      ...x,
      blocked: this.state.blockedIps.includes(x.ip) || (x.blockIp ? this.state.blockedIps.includes(x.blockIp) : false),
    }))
  }

  // ── DHCP 采集与检测 ──
  private async scanDhcp() {
    const script = `
$cfgs = @(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=TRUE" -ErrorAction SilentlyContinue)
$adapters = @($cfgs | ForEach-Object {
  [PSCustomObject]@{
    name = $_.Description
    dhcpEnabled = [bool]$_.DHCPEnabled
    dhcpServer = if($_.DHCPEnabled){ [string]$_.DHCPServer } else { '' }
    leaseObtained = if($_.DHCPLeaseObtained){ $_.DHCPLeaseObtained.ToString() } else { '' }
    leaseExpires = if($_.DHCPLeaseExpires){ $_.DHCPLeaseExpires.ToString() } else { '' }
  }
})
$adapters | ConvertTo-Json -Depth 4 -Compress
`
    let parsed: any
    try {
      const out = await ps(script)
      const cleaned = cleanJson(out)
      if (!cleaned) throw new Error('dhcp script returned empty output')
      parsed = JSON.parse(cleaned)
    } catch (err) {
      this.lastError = `dhcp: ${err instanceof Error ? err.message : String(err)}`
      console.error('[netmon] scanDhcp failed:', err)
      return
    }
    this.lastError = ''
    const adapters: DhcpAdapter[] = (Array.isArray(parsed) ? parsed : [parsed])
      .filter((a: any) => a && a.name)
      .map((a: any) => ({
        name: String(a.name),
        dhcpEnabled: a.dhcpEnabled === true || a.dhcpEnabled === 'True',
        dhcpServer: String(a.dhcpServer || ''),
        leaseObtained: String(a.leaseObtained || ''),
        leaseExpires: String(a.leaseExpires || ''),
      }))
    const active = this.scanDhcpBuildActive(adapters)
    this.reconcileDhcp(active)
    this.lastDhcp = {
      adapters,
      allowlist: [...this.state.dhcpAllowlist],
      authorized: !this.dhcpAlerts.some((a) => a.type === 'rogue'),
      alerts: this.dhcpAlerts,
      timestamp: Date.now(),
    }
  }

  private scanDhcpBuildActive(adapters: DhcpAdapter[]): Map<string, DhcpActive> {
    const active = new Map<string, DhcpActive>()
    const activeServers: string[] = []
    for (const a of adapters) {
      if (!a.dhcpEnabled || !a.dhcpServer) continue
      activeServers.push(a.dhcpServer)
      if (this.state.dhcpAllowlist.length > 0 && !this.state.dhcpAllowlist.includes(a.dhcpServer)) {
        active.set(`dhcp-rogue:${a.name}`, {
          type: 'rogue',
          severity: 'high',
          adapter: a.name,
          server: a.dhcpServer,
          message: `适配器「${a.name}」发现未授权 DHCP 服务器 ${a.dhcpServer}`,
          autoBlock: false,
        })
      }
      const prev = this.state.dhcpBaseline[a.name]
      if (prev && prev !== a.dhcpServer) {
        active.set(`dhcp-change:${a.name}`, {
          type: 'server-change',
          severity: 'medium',
          adapter: a.name,
          server: a.dhcpServer,
          message: `适配器「${a.name}」DHCP 服务器变更：${prev} → ${a.dhcpServer}`,
          autoBlock: false,
        })
      }
      this.state.dhcpBaseline[a.name] = a.dhcpServer
    }
    this.saveState()
    const distinct = Array.from(new Set(activeServers))
    if (distinct.length > 1) {
      active.set('dhcp-multiple', {
        type: 'multiple',
        severity: 'medium',
        adapter: '',
        server: distinct.join(', '),
        message: `检测到多个 DHCP 服务器（${distinct.join(', ')}），可能存在非法服务器`,
        autoBlock: false,
      })
    }
    return active
  }

  private reconcileDhcp(active: Map<string, DhcpActive>) {
    const now = Date.now()
    for (const [key, a] of active) {
      if (!this.dhcpAlerts.find((x) => x.id === key)) {
        const alert: DhcpAlertItem = {
          id: key,
          type: a.type,
          severity: a.severity,
          adapter: a.adapter,
          server: a.server,
          message: a.message,
          timestamp: now,
          blocked: this.state.blockedIps.includes(a.server),
        }
        this.dhcpAlerts.push(alert)
        this.pushEvent({
          type: 'dhcp',
          severity: a.severity,
          title: this.alertTitle(a.type),
          message: a.message,
        })
      }
    }
    this.dhcpAlerts = this.dhcpAlerts.filter((x) => active.has(x.id))
    this.dhcpAlerts = this.dhcpAlerts.map((x) => ({ ...x, blocked: this.state.blockedIps.includes(x.server) }))
  }

  // ── 公共控制 ──
  start() {
    this.ensureLoaded()
    if (this.enabled) return
    this.enabled = true
    this.prevTraffic = null
    this.lastError = ''
    void this.tickTraffic()
    this.timers.push(setInterval(() => void this.tickTraffic(), 3000))
    this.timers.push(setInterval(() => void this.tickArp(), 6000))
    this.timers.push(setInterval(() => void this.tickDhcp(), 12000))
    this.pushStatus()
  }

  stop() {
    this.enabled = false
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    this.prevTraffic = null
    this.pushStatus()
  }

  isEnabled() {
    return this.enabled
  }

  getStatus(): NetStatus {
    this.ensureLoaded()
    return {
      enabled: this.enabled,
      autoProtect: this.state.autoProtect,
      traffic: this.lastTraffic,
      arp: this.lastArp,
      dhcp: this.lastDhcp,
      events: this.events.slice(0, 100),
      lastError: this.lastError,
    }
  }

  async resetArpBaseline() {
    this.ensureLoaded()
    if (this.state.gateway) this.unpinGatewayInternal()
    this.state.baseline = {}
    this.state.gateway = null
    this.state.gatewayPinned = false
    this.arpAlerts = []
    this.saveState()
    await this.scanArp()
    this.pushStatus()
  }

  async pinGateway() {
    this.ensureLoaded()
    if (!this.state.gateway) await this.scanArp()
    if (this.state.gateway) this.pinGatewayInternal(this.state.gateway.iface, this.state.gateway.ip, this.state.gateway.mac)
    this.pushStatus()
  }

  unpinGateway() {
    this.ensureLoaded()
    this.unpinGatewayInternal()
    this.pushStatus()
  }

  blockIp(ip: string) {
    this.ensureLoaded()
    this.blockIpInternal(ip)
    this.pushStatus()
  }

  unblockIp(ip: string) {
    this.ensureLoaded()
    this.unblockIpInternal(ip)
    this.pushStatus()
  }

  setAutoProtect(v: boolean) {
    this.ensureLoaded()
    this.state.autoProtect = v
    this.saveState()
    this.pushStatus()
  }

  getDhcpAllowlist(): string[] {
    this.ensureLoaded()
    return [...this.state.dhcpAllowlist]
  }

  addDhcpAllowlist(ip: string) {
    this.ensureLoaded()
    const v = (ip || '').trim()
    if (v && !this.state.dhcpAllowlist.includes(v)) {
      this.state.dhcpAllowlist.push(v)
      this.saveState()
    }
    void this.tickDhcp()
    this.pushStatus()
  }

  removeDhcpAllowlist(ip: string) {
    this.ensureLoaded()
    this.state.dhcpAllowlist = this.state.dhcpAllowlist.filter((x) => x !== ip)
    this.saveState()
    void this.tickDhcp()
    this.pushStatus()
  }

  getEvents(): NetEvent[] {
    return this.events.slice(0, 100)
  }

  clearEvents() {
    this.events = []
    this.pushStatus()
  }

  private async tickTraffic() {
    await this.scanTraffic()
    this.pushStatus()
  }

  private async tickArp() {
    await this.scanArp()
    this.pushStatus()
  }

  private async tickDhcp() {
    await this.scanDhcp()
    this.pushStatus()
  }
}
