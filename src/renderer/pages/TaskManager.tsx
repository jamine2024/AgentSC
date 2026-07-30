import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FixedSizeList, ListChildComponentProps } from 'react-window'
import {
  Activity,
  Cpu,
  MemoryStick,
  Search,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
  ListFilter,
  X,
  Box,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { ProcessInfo, ProcessAnalysisResult, LiveMetric } from '@/lib/systemTypes'

const tooltipStyle = {
  background: 'rgba(11,18,32,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 12,
  color: '#e2e8f0',
}

const severityColor: Record<string, string> = {
  high: '#f87171',
  medium: '#fbbf24',
  low: '#34d399',
}

const TM_GRID = 'grid grid-cols-[minmax(0,1.6fr)_64px_minmax(0,1fr)_64px_88px_120px_72px] items-center'

type RowData = {
  filtered: ProcessInfo[]
  icons: Record<string, string>
  onKill: (p: ProcessInfo) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

// 列表行提到组件外，仅依赖 itemData，函数引用稳定，
// react-window 不会因父组件重渲染而重建整列，只重渲染可见窗口。
const TmRow = ({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { filtered, icons, onKill, t } = data
  const p = filtered[index]
  if (!p) return null
  return (
    <div style={style} className={cn(TM_GRID, 'border-t border-white/5 hover:bg-white/[0.03]')}>
      <div className="px-4 py-2">
        <div className="flex items-center gap-2">
          {icons[p.path] ? (
            <img src={icons[p.path]} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
          ) : (
            <Box className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          )}
          <div className="font-medium text-foreground">{p.name}</div>
        </div>
        {p.title && (
          <div className="max-w-[220px] truncate pl-6 text-[10px] text-muted-foreground">{p.title}</div>
        )}
      </div>
      <div className="px-3 py-2 text-muted-foreground">{p.id}</div>
      <div className="px-3 py-2 text-muted-foreground">
        <span className="block max-w-[160px] truncate" title={p.company || ''}>
          {p.company || '—'}
        </span>
      </div>
      <div className="px-3 py-2 text-right">
        <span className={cn(p.cpu > 25 ? 'text-amber-400 font-medium' : 'text-muted-foreground')}>
          {p.cpu.toFixed(1)}%
        </span>
      </div>
      <div className="px-3 py-2 text-right text-muted-foreground">{formatBytes(p.memory)}</div>
      <div className="px-3 py-2">
        {p.responding ? (
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            {t('taskmgr.responding')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-red-400">
            <XCircle className="h-3 w-3" />
            {t('taskmgr.not_responding')}
          </span>
        )}
      </div>
      <div className="px-4 py-2 text-right">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-red-400 hover:bg-red-500/10"
          onClick={() => onKill(p)}
        >
          {t('taskmgr.end_task')}
        </Button>
      </div>
    </div>
  )
}

export default function TaskManager() {
  const { t, locale } = useI18n()
  const api = window.electronAPI

  const [procs, setProcs] = useState<ProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'cpu' | 'memory' | 'name'>('memory')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [memTotal, setMemTotal] = useState(0)

  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null)
  const [killing, setKilling] = useState(false)
  const [killMsg, setKillMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [analysis, setAnalysis] = useState<ProcessAnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  const [liveSeries, setLiveSeries] = useState<{ t: string; cpu: number; mem: number }[]>([])
  const [live, setLive] = useState<LiveMetric | null>(null)
  const loadingRef = useRef(false)

  const [icons, setIcons] = useState<Record<string, string>>({})
  // 已请求过的图标路径，防止重复请求（跨渲染持久）
  const requestedIcons = useRef<Set<string>>(new Set())

  const loadIcons = useCallback(
    async (paths: string[]) => {
      const need = paths.filter((p) => p && !requestedIcons.current.has(p))
      if (need.length === 0) return
      need.forEach((p) => requestedIcons.current.add(p))
      try {
        const r = await api?.invoke('get-file-icons', need)
        if (r && typeof r === 'object') {
          setIcons((prev) => ({ ...prev, ...(r as Record<string, string>) }))
        }
      } catch {
        /* ignore */
      }
    },
    [api],
  )

  // 图标懒加载所需状态：
  // - filteredRef：始终指向最新过滤后列表（供 rAF 回调读取，避免闭包拿旧值）
  // - visibleRangeRef：记录 FixedSizeList 当前可见窗口索引（供刷新后补加载）
  // - iconLoadTimer：滚动 debounce 合并
  const filteredRef = useRef<ProcessInfo[]>([])
  const visibleRangeRef = useRef<{ start: number; stop: number }>({ start: 0, stop: 0 })
  const iconLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const collectVisiblePaths = useCallback((f: ProcessInfo[], start: number, stop: number): string[] => {
    const s = Math.max(0, start - 5)
    const e = Math.min(f.length - 1, stop + 10)
    const paths: string[] = []
    for (let i = s; i <= e; i++) {
      const p = f[i]
      if (p?.path) paths.push(p.path)
    }
    return paths
  }, [])

  // 仅加载「可见窗口 + 少量预读缓冲」的图标，debounce 合并滚动过程中的连续请求。
  // 避免一次性向主进程请求数百个 exe 图标（PowerShell 长时间占满 CPU + 大对象 IPC 回传）造成卡顿。
  const handleItemsRendered = useCallback(
    (info: { visibleStartIndex: number; visibleStopIndex: number }) => {
      visibleRangeRef.current = { start: info.visibleStartIndex, stop: info.visibleStopIndex }
      if (iconLoadTimer.current) clearTimeout(iconLoadTimer.current)
      iconLoadTimer.current = setTimeout(() => {
        const paths = collectVisiblePaths(filteredRef.current, info.visibleStartIndex, info.visibleStopIndex)
        void loadIcons(paths)
      }, 180)
    },
    [collectVisiblePaths, loadIcons],
  )

  // 列表刷新（每 5s 自动或手动）后，补加载当前可见窗口图标，
  // 否则同位置换成新进程时其图标可能要等下次滚动才出现。
  const scheduleLoadVisible = useCallback(() => {
    const { start, stop } = visibleRangeRef.current
    const paths = collectVisiblePaths(filteredRef.current, start, stop)
    void loadIcons(paths)
  }, [collectVisiblePaths, loadIcons])

  const loadProcs = async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const r = await api?.invoke('list-processes')
      if (Array.isArray(r)) {
        const list = r as ProcessInfo[]
        setProcs(list)
        // 图标改为懒加载（仅可见窗口），不再一次性请求全部进程 exe 图标
        requestAnimationFrame(() => scheduleLoadVisible())
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }

  const loadLive = async () => {
    try {
      const r = await api?.invoke('get-live-metrics')
      if (r && !('error' in (r as object))) {
        const m = r as LiveMetric
        setLive(m)
        if (m.memTotal > 0) setMemTotal(m.memTotal)
        const label = new Date().toLocaleTimeString('zh-CN', { hour12: false })
        setLiveSeries((prev) => {
          const next = [...prev, { t: label, cpu: m.cpu, mem: m.memPct }]
          return next.slice(-60)
        })
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadProcs()
    void loadLive()
    const procTimer = setInterval(() => {
      if (autoRefresh) void loadProcs()
    }, 5000)
    const liveTimer = setInterval(() => void loadLive(), 5000)
    return () => {
      clearInterval(procTimer)
      clearInterval(liveTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = procs
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          String(p.id).includes(q) ||
          (p.company || '').toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    if (sortKey === 'cpu') sorted.sort((a, b) => b.cpu - a.cpu)
    else if (sortKey === 'memory') sorted.sort((a, b) => b.memory - a.memory)
    else sorted.sort((a, b) => a.name.localeCompare(b.name))
    return sorted
  }, [procs, search, sortKey])

  // 始终让 ref 指向最新过滤列表，供懒加载回调读取
  filteredRef.current = filtered

  const onKill = useCallback((p: ProcessInfo) => setKillTarget(p), [])

  // 列表行所需数据统一通过 itemData 传入，函数引用稳定，避免整列重渲染
  const rowData = useMemo<RowData>(
    () => ({ filtered, icons, onKill, t }),
    [filtered, icons, onKill, t],
  )

  const totalMem = useMemo(() => procs.reduce((s, p) => s + p.memory, 0), [procs])

  const topMem = useMemo(
    () => [...procs].sort((a, b) => b.memory - a.memory).slice(0, 10),
    [procs],
  )

  const runAnalysis = async () => {
    if (procs.length === 0) return
    setAnalyzing(true)
    try {
      const r = await api?.invoke('analyze-processes', procs, memTotal, locale)
      if (r && !('error' in (r as object))) setAnalysis(r as ProcessAnalysisResult)
    } catch {
      /* ignore */
    } finally {
      setAnalyzing(false)
    }
  }

  const confirmKill = async () => {
    if (!killTarget) return
    setKilling(true)
    try {
      const r = await api?.invoke('kill-process', killTarget.id)
      const res = r as { ok: boolean; error?: string }
      if (res?.ok) {
        setKillMsg({ ok: true, text: t('taskmgr.ended_ok') })
        void loadProcs()
      } else {
        setKillMsg({ ok: false, text: t('taskmgr.ended_failed', { reason: res?.error || '' }) })
      }
    } catch (err) {
      setKillMsg({ ok: false, text: t('taskmgr.ended_failed', { reason: String(err) }) })
    } finally {
      setKilling(false)
      setKillTarget(null)
    }
  }

  const stats = [
    {
      icon: Activity,
      label: t('taskmgr.total_processes'),
      value: procs.length.toLocaleString(),
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      icon: MemoryStick,
      label: t('taskmgr.total_memory'),
      value: formatBytes(totalMem),
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      icon: Cpu,
      label: t('taskmgr.live_cpu'),
      value: live ? `${live.cpu.toFixed(1)}%` : '–',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
    {
      icon: MemoryStick,
      label: t('taskmgr.live_mem'),
      value: live ? `${live.memPct.toFixed(1)}%` : '–',
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
  ]

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('taskmgr.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('taskmgr.subtitle')}</p>
          </div>
        </div>
      </section>

      {/* 工具栏 */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('taskmgr.search_placeholder')}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <button
            onClick={() => setSortKey('memory')}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
              sortKey === 'memory' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('taskmgr.col_memory')}
          </button>
          <button
            onClick={() => setSortKey('cpu')}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
              sortKey === 'cpu' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('taskmgr.col_cpu')}
          </button>
          <button
            onClick={() => setSortKey('name')}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
              sortKey === 'name' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('taskmgr.col_name')}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-primary"
            />
            {t('taskmgr.refresh')}
          </label>
          <Button size="sm" variant="outline" onClick={() => void loadProcs()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('taskmgr.refresh')}
          </Button>
          <Button size="sm" onClick={() => void runAnalysis()} disabled={analyzing || procs.length === 0}>
            <Sparkles className={cn('h-3.5 w-3.5', analyzing && 'animate-pulse')} />
            {analyzing ? t('taskmgr.ai_analyzing') : t('taskmgr.ai_analyze')}
          </Button>
        </div>
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

      {/* AI 分析面板 */}
      {analysis && (
        <section className="glass rounded-2xl border border-primary/15 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">{t('taskmgr.ai_summary')}</h3>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              {t('taskmgr.ai_source')}: {analysis.source}
            </span>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-foreground/90">{analysis.summary}</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('taskmgr.ai_anomalies')}
              </div>
              <div className="space-y-2">
                {analysis.anomalies.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                    <span
                      className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: severityColor[a.severity] }}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{a.title}</div>
                      <div className="text-[11px] text-muted-foreground">{a.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Zap className="h-3.5 w-3.5" />
                {t('taskmgr.ai_suggestions')}
              </div>
              <div className="space-y-2">
                {analysis.suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{s.title}</div>
                      <div className="text-[11px] text-muted-foreground">{s.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 实时图表 */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="glass rounded-2xl border border-white/5 p-5">
          <div className="mb-3 text-xs font-semibold">{t('taskmgr.live_cpu')}</div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={liveSeries} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#64748b' }} interval={Math.floor(liveSeries.length / 5)} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                <Area type="monotone" dataKey="cpu" stroke="#f59e0b" strokeWidth={2} fill="url(#gCpu)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="glass rounded-2xl border border-white/5 p-5">
          <div className="mb-3 text-xs font-semibold">{t('taskmgr.live_mem')}</div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={liveSeries} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#64748b' }} interval={Math.floor(liveSeries.length / 5)} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                <Area type="monotone" dataKey="mem" stroke="#60a5fa" strokeWidth={2} fill="url(#gMem)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* 内存占用 Top 10 */}
      <section className="glass rounded-2xl border border-white/5 p-5">
        <div className="mb-3 text-xs font-semibold">{t('taskmgr.top_memory_title')}</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topMem} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(v) => formatBytes(v, 0)} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} width={90} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(v: number) => formatBytes(v)}
              />
              <Bar dataKey="memory" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {topMem.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#818cf8' : 'rgba(129,140,248,0.5)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 进程表 */}
      <section className="glass rounded-2xl border border-white/5 p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            {loading ? t('taskmgr.refreshing') : t('common.no_data')}
          </div>
        ) : (
          <>
            <div
              className={cn(
                TM_GRID,
                'border-b border-white/10 bg-card/95 py-2.5 text-left text-xs font-medium text-muted-foreground',
              )}
            >
              <div className="px-4">{t('taskmgr.col_name')}</div>
              <div className="px-3">{t('taskmgr.col_pid')}</div>
              <div className="px-3">{t('taskmgr.col_publisher')}</div>
              <div className="px-3 text-right">{t('taskmgr.col_cpu')}</div>
              <div className="px-3 text-right">{t('taskmgr.col_memory')}</div>
              <div className="px-3">{t('taskmgr.col_status')}</div>
              <div className="px-4 text-right"></div>
            </div>
            <FixedSizeList
              height={Math.min(filtered.length * 48, 460)}
              itemCount={filtered.length}
              itemSize={48}
              width="100%"
              itemData={rowData}
              onItemsRendered={handleItemsRendered}
            >
              {TmRow}
            </FixedSizeList>
          </>
        )}
      </section>

      {/* 结束进程确认弹窗 */}
      {killTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[380px] rounded-2xl border border-white/10 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h3 className="text-sm font-semibold">{t('taskmgr.end_confirm_title')}</h3>
              <button
                className="ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => setKillTarget(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              {t('taskmgr.end_confirm_desc', { name: killTarget.name, pid: killTarget.id })}
            </p>
            {killMsg && (
              <div
                className={cn(
                  'mb-3 rounded-lg px-3 py-2 text-xs',
                  killMsg.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400',
                )}
              >
                {killMsg.text}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setKillTarget(null)
                  setKillMsg(null)
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void confirmKill()}
                disabled={killing}
              >
                {killing ? t('taskmgr.ending') : t('taskmgr.end_confirm_ok')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
