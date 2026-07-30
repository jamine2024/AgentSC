import { useEffect, useState } from 'react'
import {
  Activity,
  ShieldCheck,
  ShieldAlert,
  Server,
  Play,
  Square,
  RefreshCw,
  Ban,
  ShieldOff,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Network,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

type Severity = 'high' | 'medium' | 'low' | 'info'

interface NetAdapterStat {
  name: string
  bytesIn: number
  bytesOut: number
  recvRate: number
  sendRate: number
}
interface TrafficSnapshot {
  adapters: NetAdapterStat[]
  totalRecvRate: number
  totalSendRate: number
  connections: number
  byState: Record<string, number>
  topProcesses: { pid: number; name: string; conns: number }[]
  timestamp: number
}
interface ArpEntry {
  ip: string
  mac: string
  iface: string
  state: string
}
interface ArpAlertItem {
  id: string
  type: string
  severity: Severity
  ip: string
  mac?: string
  message: string
  timestamp: number
  blocked: boolean
  blockIp?: string
}
interface ArpSnapshot {
  table: ArpEntry[]
  gateway: { ip: string; mac: string; iface: string } | null
  baselineSet: boolean
  gatewayPinned: boolean
  blockedIps: string[]
  alerts: ArpAlertItem[]
  timestamp: number
}
interface DhcpAdapter {
  name: string
  dhcpEnabled: boolean
  dhcpServer: string
  leaseObtained: string
  leaseExpires: string
}
interface DhcpAlertItem {
  id: string
  type: string
  severity: Severity
  adapter: string
  server: string
  message: string
  timestamp: number
  blocked: boolean
}
interface DhcpSnapshot {
  adapters: DhcpAdapter[]
  allowlist: string[]
  authorized: boolean
  alerts: DhcpAlertItem[]
  timestamp: number
}
interface NetEvent {
  id: string
  type: 'arp' | 'dhcp'
  severity: Severity
  title: string
  message: string
  timestamp: number
  action?: string
}
interface NetStatus {
  enabled: boolean
  autoProtect: boolean
  traffic: TrafficSnapshot | null
  arp: ArpSnapshot | null
  dhcp: DhcpSnapshot | null
  events: NetEvent[]
  lastError?: string
}

type Tab = 'traffic' | 'arp' | 'dhcp'

function formatRate(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1048576).toFixed(1)} MB/s`
  if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${Math.max(0, bps).toFixed(0)} B/s`
}
function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1073741824).toFixed(2)} GB`
  if (n >= 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}
function sevClass(s: Severity): string {
  if (s === 'high') return 'bg-red-500/10 text-red-400 border-red-500/20'
  if (s === 'medium') return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  if (s === 'low') return 'bg-sky-500/10 text-sky-400 border-sky-500/20'
  return 'bg-white/5 text-muted-foreground border-white/10'
}

export default function NetworkSecurity() {
  const { t } = useI18n()
  const api = window.electronAPI
  const [status, setStatus] = useState<NetStatus | null>(null)
  const [tab, setTab] = useState<Tab>('traffic')
  const [history, setHistory] = useState<{ t: string; rx: number; tx: number }[]>([])
  const [dhcpInput, setDhcpInput] = useState('')

  useEffect(() => {
    let mounted = true
    api?.invoke('netmon:status').then((s) => {
      if (mounted && s) setStatus(s as NetStatus)
    })
    if (!status?.enabled) api?.invoke('netmon:start').then((s) => { if (mounted && s) setStatus(s as NetStatus) })
    const onUpdate = (p: unknown) => {
      if (!mounted) return
      const s = p as NetStatus
      setStatus(s)
      if (s.traffic) {
        const time = new Date(s.traffic.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        setHistory((prev) =>
          [...prev, { t: time, rx: +(s.traffic!.totalRecvRate / 1024).toFixed(1), tx: +(s.traffic!.totalSendRate / 1024).toFixed(1) }].slice(-40),
        )
      }
    }
    api?.on('netmon:update', onUpdate)
    return () => {
      mounted = false
      api?.removeAllListeners('netmon:update')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleMonitor = () => {
    if (status?.enabled) api?.invoke('netmon:stop').then((s) => s && setStatus(s as NetStatus))
    else api?.invoke('netmon:start').then((s) => s && setStatus(s as NetStatus))
  }
  const setAuto = (v: boolean) => api?.invoke('netmon:set-auto-protect', v).then((s) => s && setStatus(s as NetStatus))
  const resetBaseline = () => api?.invoke('netmon:reset-arp-baseline').then((s) => s && setStatus(s as NetStatus))
  const pinGateway = () => api?.invoke('netmon:pin-gateway').then((s) => s && setStatus(s as NetStatus))
  const unpinGateway = () => api?.invoke('netmon:unpin-gateway').then((s) => s && setStatus(s as NetStatus))
  const blockIp = (ip: string) => api?.invoke('netmon:block-ip', ip).then((s) => s && setStatus(s as NetStatus))
  const unblockIp = (ip: string) => api?.invoke('netmon:unblock-ip', ip).then((s) => s && setStatus(s as NetStatus))
  const addAllow = () => {
    const v = dhcpInput.trim()
    if (!v) return
    setDhcpInput('')
    api?.invoke('netmon:dhcp-add', v).then((s) => s && setStatus(s as NetStatus))
  }
  const removeAllow = (ip: string) => api?.invoke('netmon:dhcp-remove', ip).then((s) => s && setStatus(s as NetStatus))
  const clearEvents = () => api?.invoke('netmon:clear-events').then((s) => s && setStatus(s as NetStatus))

  const TabBtn = ({ id, label, icon: Icon }: { id: Tab; label: string; icon: typeof Activity }) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all',
        tab === id ? 'bg-gradient-to-r from-primary/15 to-info/10 text-foreground border border-primary/10' : 'text-muted-foreground hover:text-foreground/80',
      )}
    >
      <Icon className={cn('h-4 w-4', tab === id ? 'text-primary' : 'text-muted-foreground/60')} />
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      {/* 头部 + 总开关 */}
      <section className="flex flex-wrap items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{t('netsec.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('netsec.subtitle')}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={!!status?.autoProtect} onCheckedChange={setAuto} />
            {t('netsec.auto_protect')}
          </label>
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              status?.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-muted-foreground',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', status?.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/50')} />
            {status?.enabled ? t('netsec.monitoring') : t('netsec.idle')}
          </span>
          <Button size="sm" variant={status?.enabled ? 'outline' : 'default'} onClick={toggleMonitor}>
            {status?.enabled ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {status?.enabled ? t('netsec.stop') : t('netsec.start')}
          </Button>
        </div>
      </section>

      {/* Tab 切换 */}
      <div className="flex flex-wrap items-center gap-2">
        <TabBtn id="traffic" label={t('netsec.tab_traffic')} icon={Activity} />
        <TabBtn id="arp" label={t('netsec.tab_arp')} icon={ShieldAlert} />
        <TabBtn id="dhcp" label={t('netsec.tab_dhcp')} icon={Server} />
      </div>

      {status?.lastError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">{t('netsec.error_title')}</div>
            <div className="mt-0.5 break-words opacity-90">{status.lastError}</div>
          </div>
        </div>
      )}

      {!status?.enabled && !status?.traffic && !status?.arp && (
        <div className="rounded-lg bg-white/5 px-3 py-3 text-xs text-muted-foreground">{t('netsec.no_data')}</div>
      )}

      {tab === 'traffic' && <TrafficTab status={status} history={history} t={t} />}
      {tab === 'arp' && (
        <ArpTab
          status={status}
          t={t}
          onReset={resetBaseline}
          onPin={pinGateway}
          onUnpin={unpinGateway}
          onBlock={blockIp}
          onUnblock={unblockIp}
        />
      )}
      {tab === 'dhcp' && (
        <DhcpTab
          status={status}
          t={t}
          input={dhcpInput}
          setInput={setDhcpInput}
          onAdd={addAllow}
          onRemove={removeAllow}
        />
      )}

      {/* 安全事件 */}
      <EventsPanel status={status} t={t} onClear={clearEvents} />
    </div>
  )
}

// ── 流量监控 ──
function TrafficTab({ status, history, t }: { status: NetStatus | null; history: { t: string; rx: number; tx: number }[]; t: (k: string) => string }) {
  const tr = status?.traffic
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric icon={ArrowDownToLine} label={t('netsec.traffic.recv')} value={formatRate(tr?.totalRecvRate || 0)} color="bg-emerald-500/10 text-emerald-400" />
        <Metric icon={ArrowUpFromLine} label={t('netsec.traffic.send')} value={formatRate(tr?.totalSendRate || 0)} color="bg-primary/10 text-primary" />
        <Metric icon={Network} label={t('netsec.traffic.connections')} value={String(tr?.connections ?? 0)} color="bg-info/10 text-info" />
      </section>

      <section className="glass rounded-2xl border border-white/5 p-4">
        <div className="mb-3 text-xs font-semibold text-muted-foreground">{t('netsec.traffic.total')}</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--info))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--info))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} minTickGap={28} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} width={42} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
                formatter={(v: number, name: string) => [`${v} KB/s`, name === 'rx' ? t('netsec.traffic.recv') : t('netsec.traffic.send')]}
              />
              <Area type="monotone" dataKey="rx" stroke="hsl(var(--info))" fill="url(#rx)" strokeWidth={2}  isAnimationActive={false}/>
              <Area type="monotone" dataKey="tx" stroke="hsl(var(--primary))" fill="url(#tx)" strokeWidth={2}  isAnimationActive={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="glass rounded-2xl border border-white/5 p-4">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('netsec.traffic.adapters')}</h3>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">{t('netsec.traffic.adapter')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('netsec.traffic.recv')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('netsec.traffic.send')}</th>
                  <th className="px-2 py-1.5 font-medium text-right">{t('netsec.traffic.rx_rate')}</th>
                  <th className="px-2 py-1.5 font-medium text-right">{t('netsec.traffic.tx_rate')}</th>
                </tr>
              </thead>
              <tbody>
                {(tr?.adapters || []).map((a) => (
                  <tr key={a.name} className="border-t border-white/5">
                    <td className="px-2 py-1.5 text-foreground/90">{a.name}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{formatBytes(a.bytesIn)}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{formatBytes(a.bytesOut)}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-400">{formatRate(a.recvRate)}</td>
                    <td className="px-2 py-1.5 text-right text-primary">{formatRate(a.sendRate)}</td>
                  </tr>
                ))}
                {(tr?.adapters || []).length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">{t('netsec.no_data')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="glass rounded-2xl border border-white/5 p-4">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('netsec.traffic.top_procs')}</h3>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card/95 backdrop-blur">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">{t('netsec.traffic.proc')}</th>
                  <th className="px-2 py-1.5 font-medium text-right">{t('netsec.traffic.pid')}</th>
                  <th className="px-2 py-1.5 font-medium text-right">{t('netsec.traffic.conns')}</th>
                </tr>
              </thead>
              <tbody>
                {(tr?.topProcesses || []).map((p, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1.5 text-foreground/90">{p.name}</td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">{p.pid}</td>
                    <td className="px-2 py-1.5 text-right text-info">{p.conns}</td>
                  </tr>
                ))}
                {(tr?.topProcesses || []).length === 0 && (
                  <tr><td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">{t('netsec.no_data')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {tr && tr.byState && Object.keys(tr.byState).length > 0 && (
        <section className="glass rounded-2xl border border-white/5 p-4">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('netsec.traffic.by_state')}</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(tr.byState).map(([k, v]) => (
              <span key={k} className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-muted-foreground">
                {k}: <span className="text-foreground">{v}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── ARP 防护 ──
function ArpTab({
  status, t, onReset, onPin, onUnpin, onBlock, onUnblock,
}: {
  status: NetStatus | null
  t: (k: string) => string
  onReset: () => void
  onPin: () => void
  onUnpin: () => void
  onBlock: (ip: string) => void
  onUnblock: (ip: string) => void
}) {
  const arp = status?.arp
  const gateway = arp?.gateway
  const conflictIps = new Set<string>()
  const counts: Record<string, number> = {}
  for (const e of arp?.table || []) {
    counts[e.ip] = (counts[e.ip] || 0) + 1
    if (counts[e.ip] > 1) conflictIps.add(e.ip)
  }

  return (
    <div className="space-y-4">
      <section className="glass rounded-2xl border border-white/5 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-muted-foreground">{t('netsec.arp.gateway')}</div>
            {gateway ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span><span className="text-muted-foreground">{t('netsec.arp.gateway_ip')}: </span><span className="font-mono">{gateway.ip}</span></span>
                <span><span className="text-muted-foreground">{t('netsec.arp.gateway_mac')}: </span><span className="font-mono">{gateway.mac}</span></span>
                <span><span className="text-muted-foreground">{t('netsec.arp.gateway_iface')}: </span><span className="font-mono">{gateway.iface}</span></span>
                {arp?.gatewayPinned && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                    <ShieldCheck className="h-3 w-3" />{t('netsec.arp.pinned')}
                  </span>
                )}
              </div>
            ) : (
              <div className="mt-0.5 text-sm text-muted-foreground">{t('netsec.no_data')}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onReset}>
              <RefreshCw className="h-3.5 w-3.5" />{t('netsec.arp.learn')}
            </Button>
            {arp?.gatewayPinned ? (
              <Button size="sm" variant="outline" onClick={onUnpin}>
                <ShieldOff className="h-3.5 w-3.5" />{t('netsec.arp.unpin')}
              </Button>
            ) : (
              <Button size="sm" onClick={onPin} disabled={!gateway}>
                <ShieldCheck className="h-3.5 w-3.5" />{t('netsec.arp.pin')}
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="glass rounded-2xl border border-white/5 p-4">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('netsec.arp.alerts')}</h3>
          <div className="max-h-72 space-y-2 overflow-auto">
            {(arp?.alerts || []).map((a) => (
              <div key={a.id} className={cn('rounded-lg border px-3 py-2 text-xs', sevClass(a.severity))}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{arpTypeLabel(a.type, t)}</span>
                  <span className="font-mono text-muted-foreground">{a.ip}</span>
                </div>
                <div className="mt-0.5 text-muted-foreground">{a.message}</div>
                {a.blocked && <div className="mt-1 flex items-center gap-1 text-emerald-400"><Ban className="h-3 w-3" />{t('netsec.arp.blocked')}</div>}
                {!a.blocked && a.blockIp && (
                  <button onClick={() => onBlock(a.blockIp!)} className="mt-1 text-xs text-red-400 hover:underline">{t('netsec.arp.block')} {a.blockIp}</button>
                )}
              </div>
            ))}
            {(arp?.alerts || []).length === 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />{t('netsec.arp.no_alerts')}
              </div>
            )}
          </div>
        </section>

        <section className="glass rounded-2xl border border-white/5 p-4">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('netsec.arp.blocked')}</h3>
          <div className="max-h-72 space-y-2 overflow-auto">
            {(arp?.blockedIps || []).map((ip) => (
              <div key={ip} className="flex items-center justify-between rounded-lg bg-red-500/5 px-3 py-1.5 text-xs">
                <span className="font-mono text-red-300">{ip}</span>
                <button onClick={() => onUnblock(ip)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <Trash2 className="h-3 w-3" />{t('netsec.arp.unblock')}
                </button>
              </div>
            ))}
            {(arp?.blockedIps || []).length === 0 && (
              <div className="px-1 py-2 text-xs text-muted-foreground">{t('netsec.arp.no_alerts')}</div>
            )}
          </div>
        </section>
      </div>

      <section className="glass rounded-2xl border border-white/5 p-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
          {t('netsec.arp.table')}
          {arp?.baselineSet && <span className="ml-2 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground">{t('netsec.arp.baseline')}</span>}
        </h3>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">{t('netsec.arp.ip')}</th>
                <th className="px-2 py-1.5 font-medium">{t('netsec.arp.mac')}</th>
                <th className="px-2 py-1.5 font-medium">{t('netsec.arp.iface')}</th>
                <th className="px-2 py-1.5 font-medium">{t('netsec.arp.state')}</th>
                <th className="px-2 py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {(arp?.table || []).map((e, i) => (
                <tr key={i} className={cn('border-t border-white/5', conflictIps.has(e.ip) && 'bg-red-500/5')}>
                  <td className="px-2 py-1.5 font-mono text-foreground/90">{e.ip}</td>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{e.mac}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{e.iface}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{e.state}</td>
                  <td className="px-2 py-1.5 text-right">
                    {conflictIps.has(e.ip) && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">{t('netsec.arp.conflict')}</span>}
                  </td>
                </tr>
              ))}
              {(arp?.table || []).length === 0 && (
                <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">{t('netsec.no_data')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ── DHCP 检测 ──
function DhcpTab({
  status, t, input, setInput, onAdd, onRemove,
}: {
  status: NetStatus | null
  t: (k: string) => string
  input: string
  setInput: (v: string) => void
  onAdd: () => void
  onRemove: (ip: string) => void
}) {
  const dhcp = status?.dhcp
  return (
    <div className="space-y-4">
      <section className={cn('flex items-center gap-3 rounded-2xl border px-4 py-3', dhcp?.authorized ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5')}>
        {dhcp?.authorized ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-red-400" />}
        <span className={cn('text-sm font-medium', dhcp?.authorized ? 'text-emerald-400' : 'text-red-400')}>
          {dhcp?.authorized ? t('netsec.dhcp.authorized') : t('netsec.dhcp.unauthorized')}
        </span>
      </section>

      <section className="glass rounded-2xl border border-white/5 p-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('netsec.dhcp.adapters')}</h3>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">{t('netsec.dhcp.adapter')}</th>
                <th className="px-2 py-1.5 font-medium">{t('netsec.dhcp.enabled')}</th>
                <th className="px-2 py-1.5 font-medium">{t('netsec.dhcp.server')}</th>
                <th className="px-2 py-1.5 font-medium">{t('netsec.dhcp.lease')}</th>
              </tr>
            </thead>
            <tbody>
              {(dhcp?.adapters || []).map((a, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-2 py-1.5 text-foreground/90">{a.name}</td>
                  <td className="px-2 py-1.5">{a.dhcpEnabled ? <span className="text-emerald-400">ON</span> : <span className="text-muted-foreground">OFF</span>}</td>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{a.dhcpServer || '—'}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{a.leaseExpires || '—'}</td>
                </tr>
              ))}
              {(dhcp?.adapters || []).length === 0 && (
                <tr><td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">{t('netsec.no_data')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass rounded-2xl border border-white/5 p-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('netsec.dhcp.allowlist')}</h3>
        <div className="mb-3 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAdd()}
            placeholder={t('netsec.dhcp.add_placeholder')}
            className="flex-1 rounded-lg border border-white/10 bg-card px-3 py-2 text-xs text-foreground"
          />
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />{t('netsec.dhcp.add')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(dhcp?.allowlist || []).map((ip) => (
            <span key={ip} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-xs font-mono text-foreground/90">
              {ip}
              <button onClick={() => onRemove(ip)} className="text-muted-foreground hover:text-red-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
          {(dhcp?.allowlist || []).length === 0 && <span className="text-xs text-muted-foreground">{t('netsec.dhcp.no_alerts')}</span>}
        </div>
      </section>

      <section className="glass rounded-2xl border border-white/5 p-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('netsec.dhcp.alerts')}</h3>
        <div className="max-h-72 space-y-2 overflow-auto">
          {(dhcp?.alerts || []).map((a) => (
            <div key={a.id} className={cn('rounded-lg border px-3 py-2 text-xs', sevClass(a.severity))}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{dhcpTypeLabel(a.type, t)}</span>
                <span className="font-mono text-muted-foreground">{a.server}</span>
              </div>
              <div className="mt-0.5 text-muted-foreground">{a.message}</div>
            </div>
          ))}
          {(dhcp?.alerts || []).length === 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />{t('netsec.dhcp.no_alerts')}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// ── 安全事件面板 ──
function EventsPanel({ status, t, onClear }: { status: NetStatus | null; t: (k: string) => string; onClear: () => void }) {
  const events = status?.events || []
  return (
    <section className="glass rounded-2xl border border-white/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />{t('netsec.events')}
        </h3>
        {events.length > 0 && (
          <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">{t('netsec.clear_events')}</button>
        )}
      </div>
      <div className="max-h-60 space-y-1.5 overflow-auto">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs">
            <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', e.severity === 'high' ? 'bg-red-400' : e.severity === 'medium' ? 'bg-amber-400' : 'bg-sky-400')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground/90">{e.title}</span>
                <span className="shrink-0 text-muted-foreground/70">{new Date(e.timestamp).toLocaleTimeString('zh-CN')}</span>
              </div>
              <div className="text-muted-foreground">{e.message}</div>
              {e.action && <div className="mt-0.5 text-emerald-400">{e.action}</div>}
            </div>
          </div>
        ))}
        {events.length === 0 && <div className="px-1 py-2 text-xs text-muted-foreground">{t('netsec.no_data')}</div>}
      </div>
    </section>
  )
}

function Metric({ icon: Icon, label, value, color }: { icon: typeof Activity; label: string; value: string; color: string }) {
  return (
    <div className="glass rounded-2xl border border-white/5 p-4">
      <div className="flex items-center gap-2.5">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', color)}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  )
}

function arpTypeLabel(type: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    spoof: t('netsec.arp.spoof'),
    'mac-change': t('netsec.arp.mac_change'),
    'gateway-mismatch': t('netsec.arp.gateway_mismatch'),
    'new-device': t('netsec.arp.new_device'),
  }
  return map[type] || type
}
function dhcpTypeLabel(type: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    rogue: t('netsec.dhcp.rogue'),
    'server-change': t('netsec.dhcp.server_change'),
    multiple: t('netsec.dhcp.multiple'),
  }
  return map[type] || type
}
