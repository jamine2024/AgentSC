import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  HardDrive,
  ArrowDownUp,
  Cpu,
  Filter,
  X,
  Workflow,
  AlertTriangle,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import RelationCanvas, { type VEvent, type VEventType } from '@/components/RelationCanvas'
import { Button } from '@/components/ui/button'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { WatcherStatus } from '@/App'

interface DiskInfo {
  letter: string
  label: string
  total: number
  used: number
}

interface TrendPoint {
  t: string
  created: number
  modified: number
  deleted: number
  usedPct: number
}

const TYPE_COLORS: Record<VEventType, string> = {
  created: '#34d399',
  modified: '#60a5fa',
  deleted: '#f87171',
  renamed: '#fbbf24',
}

const tooltipStyle = {
  background: 'rgba(11,18,32,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 12,
  color: '#e2e8f0',
}

export default function Visualize({ watcherStatus }: { watcherStatus: WatcherStatus }) {
  const { t } = useI18n()
  const api = window.electronAPI

  const [events, setEvents] = useState<VEvent[]>([])
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [diskUsedPct, setDiskUsedPct] = useState(0)
  const [totalSeen, setTotalSeen] = useState(0)
  const [perMin, setPerMin] = useState(0)

  const bufferRef = useRef<VEvent[]>([])
  const totalSeenRef = useRef(0)
  const rateRef = useRef({ created: 0, modified: 0, deleted: 0 })
  const diskUsedPctRef = useRef(0)

  const norm = (row: Record<string, unknown>): VEvent => ({
    type: (row.type as VEventType) || 'modified',
    path: (row.path as string) || '',
    size: typeof row.size === 'number' ? row.size : 0,
    recorded_at: (row.recorded_at as number) || Date.now(),
    process_name: (row.process_name as string) || '',
    process_id: typeof row.process_id === 'number' ? row.process_id : undefined,
  })

  // 订阅实时事件流 + 初始化历史
  useEffect(() => {
    api?.invoke('get-recent-events', 800).then((r) => {
      if (Array.isArray(r)) {
        const mapped = (r as Record<string, unknown>[]).map(norm)
        setEvents(mapped)
        totalSeenRef.current = mapped.length
        setTotalSeen(mapped.length)
      }
    })

    const handler = (batch: unknown) => {
      if (!Array.isArray(batch)) return
      const mapped = (batch as Record<string, unknown>[]).map(norm)
      bufferRef.current.push(...mapped)
      totalSeenRef.current += mapped.length
      for (const e of mapped) {
        if (e.type === 'created') rateRef.current.created++
        else if (e.type === 'modified') rateRef.current.modified++
        else if (e.type === 'deleted') rateRef.current.deleted++
      }
    }
    api?.on('file-events-batch', handler)

    const flush = setInterval(() => {
      if (bufferRef.current.length) {
        setEvents((prev) => {
          const next = [...bufferRef.current, ...prev].slice(0, 1500)
          return next
        })
        bufferRef.current = []
        setTotalSeen(totalSeenRef.current)
      }
    }, 500)

    return () => {
      api?.removeAllListeners('file-events-batch')
      clearInterval(flush)
    }
  }, [api])

  // 每秒采样趋势
  useEffect(() => {
    const sample = setInterval(() => {
      const { created, modified, deleted } = rateRef.current
      rateRef.current = { created: 0, modified: 0, deleted: 0 }
      const sum = created + modified + deleted
      const label = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      setTrend((prev) => {
        const next = [...prev, { t: label, created, modified, deleted, usedPct: diskUsedPctRef.current }]
        return next.slice(-60)
      })
      setPerMin(sum * 60)
    }, 1000)
    return () => clearInterval(sample)
  }, [])

  // 轮询磁盘占用
  useEffect(() => {
    const poll = async () => {
      const d = await api?.invoke('get-disk-info')
      if (Array.isArray(d) && d.length) {
        let used = 0
        let total = 0
        for (const x of d as DiskInfo[]) {
          used += x.used
          total += x.total
        }
        const pct = total > 0 ? (used / total) * 100 : 0
        diskUsedPctRef.current = pct
        setDiskUsedPct(pct)
      }
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => clearInterval(id)
  }, [api])

  const topProcesses = useMemo(() => {
    const m = new Map<string, { count: number; size: number }>()
    for (const e of events) {
      const p = e.process_name || t('event.unknown_process')
      const o = m.get(p) || { count: 0, size: 0 }
      o.count++
      o.size += e.size || 0
      m.set(p, o)
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
  }, [events, t])

  const topFiles = useMemo(() => events.slice(0, 12), [events])

  const netChange = useMemo(() => {
    let created = 0
    let deleted = 0
    for (const e of events) {
      if (e.type === 'created') created += e.size || 0
      else if (e.type === 'deleted') deleted += e.size || 0
    }
    return created - deleted
  }, [events])

  const goTracking = () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'tracking' }))
  }

  const stats = [
    {
      icon: Activity,
      label: t('visualize.stat_live_events'),
      value: totalSeen.toLocaleString(),
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      icon: ArrowDownUp,
      label: t('visualize.stat_events_per_min'),
      value: perMin.toLocaleString(),
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      icon: Workflow,
      label: t('visualize.stat_net_change'),
      value: `${netChange >= 0 ? '+' : '-'}${formatBytes(Math.abs(netChange))}`,
      color: netChange >= 0 ? 'text-blue-400' : 'text-red-400',
      bg: netChange >= 0 ? 'bg-blue-500/10' : 'bg-red-500/10',
    },
    {
      icon: HardDrive,
      label: t('visualize.stat_disk_used'),
      value: `${diskUsedPct.toFixed(1)}%`,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
  ]

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Workflow className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('visualize.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('visualize.subtitle')}</p>
          </div>
        </div>
        {!watcherStatus.active && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-amber-300/90">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t('visualize.monitor_off_hint')}
            </div>
            <Button size="sm" variant="outline" onClick={goTracking}>
              {t('visualize.go_tracking')}
            </Button>
          </div>
        )}
      </section>

      {/* 统计卡 */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.label} className="glass rounded-2xl border border-white/5 p-4">
              <div className="flex items-center gap-2.5">
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', s.bg, s.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
              <div className="mt-2 text-xl font-semibold tracking-tight">{s.value}</div>
            </div>
          )
        })}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* 左：趋势 + 画布 */}
        <div className="space-y-6 xl:col-span-2">
          {/* 实时趋势 */}
          <section className="glass rounded-2xl border border-white/5 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">{t('visualize.trend_title')}</h3>
                <p className="text-xs text-muted-foreground">{t('visualize.trend_subtitle')}</p>
              </div>
            </div>
            {trend.length === 0 ? (
              <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                {t('visualize.trend_empty')}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <div className="mb-1 text-[11px] text-muted-foreground">{t('visualize.trend_activity')}</div>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={TYPE_COLORS.created} stopOpacity={0.5} />
                            <stop offset="100%" stopColor={TYPE_COLORS.created} stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="gModified" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={TYPE_COLORS.modified} stopOpacity={0.5} />
                            <stop offset="100%" stopColor={TYPE_COLORS.modified} stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="gDeleted" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={TYPE_COLORS.deleted} stopOpacity={0.5} />
                            <stop offset="100%" stopColor={TYPE_COLORS.deleted} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#64748b' }} interval={Math.floor(trend.length / 5)} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                        <Area type="monotone" dataKey="created" stackId="1" stroke={TYPE_COLORS.created} fill="url(#gCreated)"  isAnimationActive={false}/>
                        <Area type="monotone" dataKey="modified" stackId="1" stroke={TYPE_COLORS.modified} fill="url(#gModified)"  isAnimationActive={false}/>
                        <Area type="monotone" dataKey="deleted" stackId="1" stroke={TYPE_COLORS.deleted} fill="url(#gDeleted)"  isAnimationActive={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-muted-foreground">{t('visualize.trend_disk')}</div>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#64748b' }} interval={Math.floor(trend.length / 5)} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#64748b' }} width={28} unit="%" />
                        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                        <Line type="monotone" dataKey="usedPct" stroke="#a78bfa" strokeWidth={2} dot={false}  isAnimationActive={false}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 关系画布 */}
          <section className="glass rounded-2xl border border-white/5 p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">{t('visualize.canvas_title')}</h3>
                <p className="text-xs text-muted-foreground">{t('visualize.canvas_subtitle')}</p>
              </div>
              {selectedProcess && (
                <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                  <Filter className="h-3 w-3" />
                  <span className="max-w-[160px] truncate">{selectedProcess}</span>
                  <button onClick={() => setSelectedProcess(null)} className="text-primary/70 hover:text-primary">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="h-[560px] overflow-hidden rounded-xl border border-white/5 bg-black/20">
              {events.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t('visualize.empty')}
                </div>
              ) : (
                <RelationCanvas
                  events={events}
                  selectedProcess={selectedProcess}
                  onSelectProcess={setSelectedProcess}
                />
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/70">{t('visualize.canvas_hint')}</p>
          </section>
        </div>

        {/* 右：面板 */}
        <div className="space-y-6">
          <section className="glass rounded-2xl border border-white/5 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">{t('visualize.panel_processes')}</h3>
            </div>
            {topProcesses.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{t('visualize.panel_empty')}</p>
            ) : (
              <div className="space-y-1.5">
                {topProcesses.map((p) => {
                  const active = selectedProcess === p.name
                  return (
                    <button
                      key={p.name}
                      onClick={() => setSelectedProcess(active ? null : p.name)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition',
                        active
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-white/5 bg-white/[0.02] hover:border-white/15',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                        <span className="truncate text-xs text-foreground" title={p.name}>
                          {p.name}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{p.count}</span>
                        <span>{formatBytes(p.size)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="glass rounded-2xl border border-white/5 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Workflow className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">{t('visualize.panel_files')}</h3>
            </div>
            {topFiles.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{t('visualize.panel_empty')}</p>
            ) : (
              <div className="space-y-1.5">
                {topFiles.map((f, idx) => (
                  <button
                    key={`${f.path}-${f.recorded_at}-${idx}`}
                    onClick={() => {
                      const p = f.process_name || t('event.unknown_process')
                      setSelectedProcess(selectedProcess === p ? null : p)
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-left transition hover:border-white/15"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: TYPE_COLORS[f.type] }}
                      />
                      <span className="truncate text-xs text-muted-foreground" title={f.path}>
                        {f.path.split(/[\\/]/).pop() || f.path}
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {f.size ? formatBytes(f.size) : '-'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
