import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Route,
  Network,
  Activity,
  Globe,
  RefreshCw,
  Search,
  Play,
  Pause,
  Trash2,
  ArrowRight,
  Radio,
  Server,
  Cpu,
  ExternalLink,
  ListFilter,
  EyeOff,
  Wifi,
  Link2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { NetConnection, NetEvent, NetStatus, NetAction } from '@/lib/systemTypes'

type ViewMode = 'connections' | 'paths' | 'activity'
type ProtocolFilter = 'all' | 'TCP' | 'UDP'

function remoteLabel(c: { remoteAddress: string; remotePort: number; remoteHost?: string }) {
  if (!c.remoteAddress) return ''
  const endpoint = c.remotePort ? `${c.remoteAddress}:${c.remotePort}` : c.remoteAddress
  return c.remoteHost ? `${c.remoteHost} · ${endpoint}` : endpoint
}

function stateBadgeClass(state: string) {
  switch (state) {
    case 'Established':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    case 'Listen':
      return 'bg-sky-500/10 text-sky-400 border-sky-500/20'
    case 'TimeWait':
      return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
    case 'CloseWait':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    case 'SynSent':
    case 'SynReceived':
      return 'bg-violet-500/10 text-violet-400 border-violet-500/20'
    default:
      return 'bg-white/5 text-muted-foreground border-white/10'
  }
}

function actionBadgeClass(action: NetAction) {
  switch (action) {
    case 'connect':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    case 'close':
      return 'bg-rose-500/10 text-rose-400 border-rose-500/20'
    case 'listen':
      return 'bg-sky-500/10 text-sky-400 border-sky-500/20'
  }
}

const actionLabelKey: Record<NetAction, string> = {
  connect: 'net.event_connect',
  close: 'net.event_close',
  listen: 'net.event_listen',
}

export default function NetworkTracer() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [connections, setConnections] = useState<NetConnection[]>([])
  const [events, setEvents] = useState<NetEvent[]>([])
  const [status, setStatus] = useState<NetStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [view, setView] = useState<ViewMode>('connections')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshMs] = useState(2000)
  const [resolveHosts, setResolveHosts] = useState(false)
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>('all')
  const [hideTimeWait, setHideTimeWait] = useState(true)
  const [externalOnly, setExternalOnly] = useState(false)
  const [search, setSearch] = useState('')

  const poll = useCallback(async () => {
    try {
      const [conns, evts, st] = await Promise.all([
        api?.invoke('network:connections'),
        api?.invoke('network:events', 400),
        api?.invoke('network:status'),
      ])
      setConnections((conns as NetConnection[]) || [])
      setEvents((evts as NetEvent[]) || [])
      setStatus((st as NetStatus) || null)
      setError('')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    setLoading(true)
    void poll()
  }, [poll])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => void poll(), refreshMs)
    return () => clearInterval(id)
  }, [autoRefresh, refreshMs, poll])

  // 同步主机名解析开关
  const toggleResolve = (on: boolean) => {
    setResolveHosts(on)
    void api?.invoke('network:set-resolve', on)
  }

  const manualRefresh = () => {
    setLoading(true)
    void api?.invoke('network:snapshot')
    void poll()
  }

  const clearEvents = () => {
    void api?.invoke('network:clear-events')
    setEvents([])
  }

  // ── 统计 ──
  const stats = useMemo(() => {
    const ext = connections.filter((c) => c.isExternal).length
    const established = connections.filter((c) => c.state === 'Established').length
    const listen = connections.filter(
      (c) => c.state === 'Listen' || (c.protocol === 'TCP' && c.remotePort === 0),
    ).length
    const procs = new Set(connections.map((c) => c.pid)).size
    return { total: connections.length, ext, established, listen, procs }
  }, [connections])

  // ── 过滤（连接）──
  const filteredConns = useMemo(() => {
    const q = search.trim().toLowerCase()
    return connections.filter((c) => {
      if (protocolFilter !== 'all' && c.protocol !== protocolFilter) return false
      if (hideTimeWait && c.state === 'TimeWait') return false
      if (externalOnly && !c.isExternal) return false
      if (q) {
        const hay = `${c.processName} ${c.processPath} ${c.remoteAddress} ${c.remoteHost || ''} ${c.localAddress} ${c.pid}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [connections, protocolFilter, hideTimeWait, externalOnly, search])

  // ── 按进程分组（动作路径视图）──
  const pathGroups = useMemo(() => {
    const m = new Map<number, NetConnection[]>()
    for (const c of filteredConns) {
      if (externalOnly && !c.isExternal) continue
      const arr = m.get(c.pid) || []
      arr.push(c)
      m.set(c.pid, arr)
    }
    return Array.from(m.entries())
      .map(([pid, conns]) => ({
        pid,
        name: conns[0].processName || `PID ${pid}`,
        path: conns[0].processPath,
        conns: conns.sort((a, b) => Number(b.isExternal) - Number(a.isExternal) || b.lastSeen - a.lastSeen),
      }))
      .sort((a, b) => b.conns.length - a.conns.length)
  }, [filteredConns, externalOnly])

  // ── 过滤（事件）──
  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (hideTimeWait && e.state === 'TimeWait') return false
      if (externalOnly && !e.isExternal) return false
      if (q) {
        const hay = `${e.processName} ${e.processPath} ${e.remoteAddress} ${e.localAddress} ${e.pid}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, hideTimeWait, externalOnly, search])

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const StatCard = ({
    icon: Icon,
    label,
    value,
    color,
  }: {
    icon: typeof Network
    label: string
    value: number
    color: string
  }) => (
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

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <section className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Route className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold tracking-tight">{t('net.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('net.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
              status?.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-400',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status?.active ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500',
              )}
            />
            {status?.active ? t('net.live') : t('net.paused')}
          </span>
          <Button size="sm" variant="outline" onClick={manualRefresh} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('net.refresh')}
          </Button>
        </div>
      </section>

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <span className="flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            {error}
          </span>
        </div>
      )}

      {/* 统计卡 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Network} label={t('net.stat_total')} value={stats.total} color="bg-primary/10 text-primary" />
        <StatCard icon={Globe} label={t('net.stat_external')} value={stats.ext} color="bg-rose-500/10 text-rose-400" />
        <StatCard icon={Link2} label={t('net.stat_established')} value={stats.established} color="bg-emerald-500/10 text-emerald-400" />
        <StatCard icon={Radio} label={t('net.stat_listen')} value={stats.listen} color="bg-sky-500/10 text-sky-400" />
        <StatCard icon={Cpu} label={t('net.stat_processes')} value={stats.procs} color="bg-violet-500/10 text-violet-400" />
      </section>

      {/* 工具栏 */}
      <section className="glass rounded-2xl border border-white/5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* 视图切换 */}
          <div className="flex items-center rounded-lg border border-white/10 bg-card p-0.5">
            {([
              { id: 'connections', icon: ListFilter, key: 'net.tab_connections' },
              { id: 'paths', icon: Route, key: 'net.tab_paths' },
              { id: 'activity', icon: Activity, key: 'net.tab_activity' },
            ] as const).map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition',
                  view === v.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <v.icon className="h-3.5 w-3.5" />
                {t(v.key)}
              </button>
            ))}
          </div>

          <div className="mx-1 h-5 w-px bg-white/10" />

          {/* 协议 */}
          <select
            value={protocolFilter}
            onChange={(e) => setProtocolFilter(e.target.value as ProtocolFilter)}
            className="rounded-lg border border-white/10 bg-card px-2 py-1.5 text-xs text-foreground"
          >
            <option value="all">{t('net.filter_protocol')}</option>
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
          </select>

          {/* 仅外部 */}
          <button
            onClick={() => setExternalOnly((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
              externalOnly ? 'border-rose-500/30 bg-rose-500/10 text-rose-400' : 'border-white/10 text-muted-foreground hover:text-foreground',
            )}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('net.filter_external_only')}
          </button>

          {/* 隐藏 TimeWait */}
          <button
            onClick={() => setHideTimeWait((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
              hideTimeWait ? 'border-white/20 bg-white/5 text-foreground' : 'border-white/10 text-muted-foreground hover:text-foreground',
            )}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {t('net.hide_timewait')}
          </button>

          {/* 解析主机名 */}
          <button
            onClick={() => toggleResolve(!resolveHosts)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
              resolveHosts ? 'border-primary/30 bg-primary/10 text-primary' : 'border-white/10 text-muted-foreground hover:text-foreground',
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            {t('net.resolve_hosts')}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {/* 搜索 */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('net.filter_search')}
                className="w-44 rounded-lg border border-white/10 bg-card py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground/50"
              />
            </div>

            {/* 自动刷新 */}
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
                autoRefresh ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-white/10 text-muted-foreground hover:text-foreground',
              )}
            >
              {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {t('net.auto_refresh')}
            </button>

            {view === 'activity' && (
              <button
                onClick={clearEvents}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('net.clear_events')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 内容区 */}
      {view === 'connections' && (
        <ConnectionsTable conns={filteredConns} t={t} emptyText={t('net.no_connections')} />
      )}

      {view === 'paths' && (
        <PathsView groups={pathGroups} t={t} emptyText={t('net.no_connections')} />
      )}

      {view === 'activity' && (
        <ActivityView events={filteredEvents} t={t} fmtTime={fmtTime} emptyText={t('net.no_events')} />
      )}
    </div>
  )
}

// ── 连接表 ──
function ConnectionsTable({
  conns,
  t,
  emptyText,
}: {
  conns: NetConnection[]
  t: (k: string) => string
  emptyText: string
}) {
  if (conns.length === 0) return <EmptyHint text={emptyText} />
  return (
    <div className="glass rounded-2xl border border-white/5 overflow-hidden">
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t('net.col_protocol')}</th>
              <th className="px-3 py-2 font-medium">{t('net.col_local')}</th>
              <th className="px-3 py-2 font-medium">{t('net.col_remote')}</th>
              <th className="px-3 py-2 font-medium">{t('net.col_state')}</th>
              <th className="px-3 py-2 font-medium">{t('net.col_pid')}</th>
              <th className="px-3 py-2 font-medium">{t('net.col_process')}</th>
              <th className="px-3 py-2 font-medium">{t('net.col_path')}</th>
            </tr>
          </thead>
          <tbody>
            {conns.map((c) => (
              <tr key={c.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                      c.protocol === 'TCP' ? 'bg-sky-500/10 text-sky-400' : 'bg-violet-500/10 text-violet-400',
                    )}
                  >
                    {c.protocol}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {c.localPort ? `${c.localAddress}:${c.localPort}` : c.localAddress}
                </td>
                <td className="px-3 py-2 font-mono">
                  {c.remoteAddress ? (
                    <span className={c.isExternal ? 'text-rose-300' : 'text-muted-foreground'}>
                      {remoteLabel(c)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {c.state ? (
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', stateBadgeClass(c.state))}>
                      {c.state}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{c.pid}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <Server className="h-3 w-3 text-muted-foreground/50" />
                    {c.processName || '—'}
                  </span>
                </td>
                <td className="px-3 py-2 max-w-[260px] truncate font-mono text-[10px] text-muted-foreground/70" title={c.processPath}>
                  {c.processPath || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-white/5 px-3 py-1.5 text-[10px] text-muted-foreground/60">
        {t('net.count_shown')} {conns.length}
      </div>
    </div>
  )
}

// ── 动作路径（按进程分组）──
function PathsView({
  groups,
  t,
  emptyText,
}: {
  groups: { pid: number; name: string; path: string; conns: NetConnection[] }[]
  t: (k: string) => string
  emptyText: string
}) {
  if (groups.length === 0) return <EmptyHint text={emptyText} />
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const ext = g.conns.filter((c) => c.isExternal).length
        return (
          <div key={g.pid} className="glass rounded-2xl border border-white/5 p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-muted-foreground">
                <Cpu className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{g.name}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    PID {g.pid}
                  </span>
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground/60" title={g.path}>
                  {g.path || t('net.unknown_path')}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Globe className="h-3.5 w-3.5 text-rose-400/70" />
                {ext} {t('net.external_tag')}
              </div>
            </div>

            <div className="mt-3 space-y-1.5 border-l border-white/10 pl-3">
              {g.conns.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {c.localPort ? `${c.localAddress}:${c.localPort}` : c.localAddress}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                  {c.remoteAddress ? (
                    <>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 font-mono text-[10px]',
                          c.isExternal ? 'bg-rose-500/10 text-rose-300' : 'bg-white/5 text-muted-foreground',
                        )}
                      >
                        {remoteLabel(c)}
                      </span>
                      {c.state && (
                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', stateBadgeClass(c.state))}>
                          {c.state}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground/50">{t('net.listening')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 动作时间线 ──
function ActivityView({
  events,
  t,
  fmtTime,
  emptyText,
}: {
  events: NetEvent[]
  t: (k: string) => string
  fmtTime: (ts: number) => string
  emptyText: string
}) {
  if (events.length === 0) return <EmptyHint text={emptyText} />
  return (
    <div className="glass rounded-2xl border border-white/5 p-4">
      <div className="max-h-[60vh] space-y-2 overflow-auto">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-3">
            <div className="w-20 shrink-0 pt-0.5 text-right font-mono text-[10px] text-muted-foreground/70">
              {fmtTime(e.ts)}
            </div>
            <div className="flex flex-col items-center pt-1">
              <span className={cn('flex h-2 w-2 rounded-full', e.action === 'connect' ? 'bg-emerald-400' : e.action === 'close' ? 'bg-rose-400' : 'bg-sky-400')} />
              <span className="mt-1 w-px flex-1 bg-white/10" />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', actionBadgeClass(e.action))}>
                  {t(actionLabelKey[e.action])}
                </span>
                <span className="text-sm font-medium">{e.processName || `PID ${e.pid}`}</span>
                <span className="font-mono text-[10px] text-muted-foreground/60">{e.processPath || t('net.unknown_path')}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
                  {e.localPort ? `${e.localAddress}:${e.localPort}` : e.localAddress}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                {e.remoteAddress ? (
                  <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px]', e.isExternal ? 'bg-rose-500/10 text-rose-300' : 'bg-white/5 text-muted-foreground')}>
                    {e.remotePort ? `${e.remoteAddress}:${e.remotePort}` : e.remoteAddress}
                  </span>
                ) : (
                  <span className="text-muted-foreground/50">{t('net.listening')}</span>
                )}
                {e.state && <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', stateBadgeClass(e.state))}>{e.state}</span>}
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">{e.protocol}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="glass flex flex-col items-center justify-center rounded-2xl border border-white/5 py-16 text-muted-foreground">
      <Wifi className="mb-3 h-8 w-8 opacity-40" />
      <p className="text-sm">{text}</p>
    </div>
  )
}
