import { useEffect, useMemo, useState } from 'react'
import {
  History, Search, RefreshCw, X, AlertTriangle, XCircle, Info, Circle, Copy, Check, Download,
  Filter, ArrowUpDown, Clock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

// ── 与主进程 eventViewer.ts 对应的本地类型 ──
interface SystemEvent {
  recordId: number
  timeCreated: string
  level: number
  provider: string
  id: number
  task: string
  message: string
}

// 级别定义：1=关键 2=错误 3=警告 4=信息 5=详细
const LEVEL_META: Record<number, { label: string; enLabel: string; badge: string; icon: typeof Info; rank: number }> = {
  1: { label: '关键', enLabel: 'Critical', badge: 'bg-red-500/15 text-red-400 border border-red-500/25', icon: XCircle, rank: 5 },
  2: { label: '错误', enLabel: 'Error', badge: 'bg-red-500/12 text-red-400 border border-red-500/20', icon: XCircle, rank: 4 },
  3: { label: '警告', enLabel: 'Warning', badge: 'bg-amber-500/12 text-amber-400 border border-amber-500/20', icon: AlertTriangle, rank: 3 },
  4: { label: '信息', enLabel: 'Information', badge: 'bg-sky-500/12 text-sky-400 border border-sky-500/20', icon: Info, rank: 2 },
  5: { label: '详细', enLabel: 'Verbose', badge: 'bg-zinc-500/12 text-zinc-400 border border-zinc-500/20', icon: Circle, rank: 1 },
}
const FALLBACK_META = { label: '其他', enLabel: 'Other', badge: 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/15', icon: Circle, rank: 0 }

function levelMeta(level: number) {
  return LEVEL_META[level] || { ...FALLBACK_META, rank: 0 }
}

// 内置常用日志（用户也可自定义任意日志名）
const BUILTIN_LOGS = ['Application', 'System', 'Security', 'Setup']

type SortKey = 'timeDesc' | 'timeAsc' | 'levelDesc' | 'levelAsc'

export default function EventViewer() {
  const api = window.electronAPI
  const { t, locale } = useI18n()

  const [logName, setLogName] = useState('System')
  const [customLog, setCustomLog] = useState('')
  const [search, setSearch] = useState('')
  const [levels, setLevels] = useState<number[]>([1, 2, 3]) // 默认只看异常
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [max, setMax] = useState(300)
  const [sort, setSort] = useState<SortKey>('timeDesc')

  // 分页
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const [events, setEvents] = useState<SystemEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastQuery, setLastQuery] = useState<{ logName: string } | null>(null)

  // 详情抽屉
  const [detail, setDetail] = useState<SystemEvent | null>(null)
  const [xml, setXml] = useState('')
  const [xmlLoading, setXmlLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // 查询结果或排序变化时，回到第一页
  useEffect(() => { setPage(1) }, [events, sort])

  const effectiveLog = customLog.trim() || logName

  function toggleLevel(lv: number) {
    setLevels((prev) => (prev.includes(lv) ? prev.filter((x) => x !== lv) : [...prev, lv]))
  }

  async function runQuery() {
    if (!api) return
    setLoading(true)
    setError('')
    try {
      const res = (await api.invoke('eventviewer:query', {
        logName: effectiveLog,
        levels: levels.length > 0 ? levels : undefined,
        search: search.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        max,
      })) as { events: SystemEvent[]; error?: string }
      if (res.error) {
        setError(res.error)
        setEvents([])
      } else {
        setEvents(res.events || [])
      }
      setLastQuery({ logName: effectiveLog })
    } catch (e) {
      setError(String(e))
      setEvents([])
    } finally {
      setLoading(false)
    }
  }

  // 首次进入自动查询
  useEffect(() => {
    void runQuery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 排序（前端，已限制在 max 条内）
  const sorted = useMemo(() => {
    const arr = [...events]
    arr.sort((a, b) => {
      if (sort === 'timeDesc') return b.timeCreated.localeCompare(a.timeCreated)
      if (sort === 'timeAsc') return a.timeCreated.localeCompare(b.timeCreated)
      const ra = levelMeta(a.level).rank
      const rb = levelMeta(b.level).rank
      if (sort === 'levelDesc') return rb - ra || b.timeCreated.localeCompare(a.timeCreated)
      return ra - rb || b.timeCreated.localeCompare(a.timeCreated)
    })
    return arr
  }, [events, sort])

  // 各级别计数
  const levelCounts = useMemo(() => {
    const c: Record<number, number> = {}
    for (const e of events) c[e.level] = (c[e.level] || 0) + 1
    return c
  }, [events])

  // 分页切片（基于已排序、已过滤的数据集）
  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageItems = sorted.slice(pageStart, pageStart + pageSize)

  // 打开详情时拉取 XML
  async function openDetail(ev: SystemEvent) {
    setDetail(ev)
    setXml('')
    setCopied(false)
    if (!api) return
    setXmlLoading(true)
    try {
      const res = (await api.invoke('eventviewer:xml', effectiveLog, ev.recordId)) as { xml?: string; error?: string }
      setXml(res.xml || (res.error ? `获取 XML 失败：${res.error}` : '（无内容）'))
    } catch (e) {
      setXml(`获取 XML 失败：${String(e)}`)
    } finally {
      setXmlLoading(false)
    }
  }

  async function copyXml() {
    try {
      await navigator.clipboard.writeText(xml)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  async function handleExport() {
    if (!api) return
    await api.invoke('export-events', sorted, `eventlog-${effectiveLog}-${Date.now()}.json`)
  }

  function setQuickRange(hours: number) {
    const end = new Date()
    const start = new Date(end.getTime() - hours * 3600 * 1000)
    const fmt = (d: Date) => {
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
    }
    setFrom(fmt(start))
    setTo(fmt(end))
  }

  const lvlLabel = (lv: number) => (locale === 'en' ? levelMeta(lv).enLabel : levelMeta(lv).label)

  return (
    <div className="space-y-4">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl border border-white/[0.05] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <History className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight text-foreground/90">{t('eventv.title')}</h2>
              <p className="text-[11px] text-muted-foreground/50">
                {lastQuery ? `${t('eventv.results_for')} ${lastQuery.logName} · ${sorted.length} ${t('eventv.records')}` : t('eventv.loading')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void runQuery()} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleExport()} disabled={sorted.length === 0}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {t('common.export')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── 过滤 / 工具栏 ── */}
      <section className="glass rounded-2xl border border-white/[0.05] p-4 space-y-3">
        {/* 行1：日志选择 + 搜索 */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">{t('eventv.log')}</span>
            <select
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-foreground/80 outline-none"
              value={customLog ? '__custom__' : logName}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setCustomLog(customLog || 'Application')
                } else {
                  setCustomLog('')
                  setLogName(e.target.value)
                }
              }}
            >
              {BUILTIN_LOGS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
              <option value="__custom__">{t('eventv.custom_log')}</option>
            </select>
          </div>
          {customLog !== '' && (
            <Input
              placeholder={t('eventv.custom_log_placeholder')}
              value={customLog}
              onChange={(e) => setCustomLog(e.target.value)}
              className="w-56 text-xs"
            />
          )}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              placeholder={t('eventv.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runQuery() }}
              className="w-full pl-9"
            />
          </div>
          <Button size="sm" onClick={() => void runQuery()} disabled={loading}>
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            {t('eventv.apply')}
          </Button>
        </div>

        {/* 行2：级别过滤（只看异常） */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">{t('eventv.level')}</span>
          <button
            onClick={() => setLevels([])}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all',
              levels.length === 0 ? 'bg-primary/15 text-primary' : 'bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
            )}
          >
            {t('eventv.all_levels')}
          </button>
          {[1, 2, 3, 4, 5].map((lv) => {
            const meta = levelMeta(lv)
            const Icon = meta.icon
            const active = levels.includes(lv)
            return (
              <button
                key={lv}
                onClick={() => toggleLevel(lv)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all',
                  active ? meta.badge : 'bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
                )}
              >
                <Icon className="h-3 w-3" />
                {lvlLabel(lv)}
                {levelCounts[lv] ? <span className="opacity-70">·{levelCounts[lv]}</span> : null}
              </button>
            )
          })}
        </div>

        {/* 行3：时间范围 + 排序 + 最大条数 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-foreground/80 outline-none"
            />
            <span className="text-[11px] text-muted-foreground/50">~</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-foreground/80 outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setQuickRange(24)}>{t('eventv.last_24h')}</Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setQuickRange(24 * 7)}>{t('eventv.last_7d')}</Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => { setFrom(''); setTo('') }}>{t('eventv.clear_range')}</Button>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
            <select
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-foreground/80 outline-none"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="timeDesc">{t('eventv.sort_time_desc')}</option>
              <option value="timeAsc">{t('eventv.sort_time_asc')}</option>
              <option value="levelDesc">{t('eventv.sort_level_desc')}</option>
              <option value="levelAsc">{t('eventv.sort_level_asc')}</option>
            </select>
            <span className="text-[11px] text-muted-foreground/50">{t('eventv.max')}</span>
            <input
              type="number"
              min={10}
              max={2000}
              value={max}
              onChange={(e) => setMax(Math.min(2000, Math.max(10, Number(e.target.value) || 300)))}
              className="w-20 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-foreground/80 outline-none"
            />
          </div>
        </div>
      </section>

      {/* ── 结果列表 ── */}
      <section className="glass rounded-2xl border border-white/[0.05] overflow-hidden">
        {/* 表头 */}
        <div className="grid grid-cols-[170px_88px_1fr_auto] gap-3 border-b border-white/[0.06] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          <div>{t('eventv.col_time')}</div>
          <div>{t('eventv.col_level')}</div>
          <div>{t('eventv.col_source')} / ID</div>
          <div className="text-right">{t('eventv.col_message')}</div>
        </div>

        <div className="max-h-[560px] overflow-auto">
          {loading && events.length === 0 ? (
            <div className="py-20 text-center">
              <div className="inline-flex h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground/40">{t('eventv.loading')}</p>
            </div>
          ) : error ? (
            <div className="py-16 text-center">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 mb-3">
                <AlertTriangle className="h-5 w-5 text-destructive/70" />
              </div>
              <p className="text-sm text-destructive/80">{t('eventv.query_failed')}</p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground/50 break-all px-6">{error}</p>
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-20 text-center">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03] mb-3">
                <History className="h-5 w-5 text-muted-foreground/20" />
              </div>
              <p className="text-sm text-muted-foreground/40">{t('eventv.no_events')}</p>
            </div>
          ) : (
            pageItems.map((ev) => {
              const meta = levelMeta(ev.level)
              const Icon = meta.icon
              return (
                <button
                  key={`${ev.recordId}-${ev.timeCreated}`}
                  onClick={() => void openDetail(ev)}
                  className="grid w-full grid-cols-[170px_88px_1fr_auto] gap-3 border-b border-white/[0.04] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.025]"
                >
                  <div className="shrink-0 text-[11px] font-mono text-muted-foreground/70 tabular-nums">
                    {formatTime(ev.timeCreated, locale)}
                  </div>
                  <div>
                    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', meta.badge)}>
                      <Icon className="h-3 w-3" />
                      {lvlLabel(ev.level)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-foreground/80" title={ev.provider}>{ev.provider}</div>
                    <div className="text-[10px] text-muted-foreground/50">Event ID: {ev.id}{ev.task ? ` · ${ev.task}` : ''}</div>
                  </div>
                  <div className="min-w-0 max-w-[420px]">
                    <div className="truncate text-[12px] text-muted-foreground/70" title={ev.message}>{ev.message || '—'}</div>
                  </div>
                </button>
              )
            })
          )}
        </div>
        {!error && !loading && sorted.length > 0 && (
          <div className="space-y-2 border-t border-white/[0.06] px-4 py-3">
            {sorted.length >= max && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/8 px-3 py-1.5 text-[11px] text-amber-400/90">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t('eventv.sampled_hint', { max })}
              </div>
            )}
            <Pager
              page={currentPage}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPage={(p) => setPage(p)}
              onPageSize={(n) => { setPageSize(n); setPage(1) }}
              t={t}
            />
          </div>
        )}
      </section>

      {/* ── 详情抽屉：完整消息 + XML ── */}
      {detail && (
        <div className="fixed inset-0 z-[9998] flex items-stretch justify-end bg-black/60 p-0 backdrop-blur-sm md:p-6">
          <div className="glass flex h-full w-full max-w-3xl flex-col rounded-none border border-white/10 md:rounded-2xl">
            <div className="flex items-center justify-between border-b border-white/5 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <History className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">
                    {lvlLabel(detail.level)} · Event {detail.id}
                  </h3>
                  <p className="font-mono text-[10px] text-muted-foreground">{detail.provider} · #{detail.recordId}</p>
                </div>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-auto p-4">
              <div className="grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
                <DetailField label={t('eventv.col_time')} value={formatTime(detail.timeCreated, locale, true)} />
                <DetailField label={t('eventv.col_level')} value={lvlLabel(detail.level)} />
                <DetailField label="Event ID" value={String(detail.id)} />
                <DetailField label="Record ID" value={String(detail.recordId)} />
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{t('eventv.message')}</div>
                <div className="whitespace-pre-wrap break-words rounded-lg border border-white/[0.05] bg-black/20 p-3 text-[12px] leading-relaxed text-foreground/80">
                  {detail.message || '—'}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{t('eventv.xml')}</span>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void copyXml()} disabled={!xml}>
                    {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                    {copied ? t('eventv.copied') : t('eventv.copy_xml')}
                  </Button>
                </div>
                <pre className="max-h-[340px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.05] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
                  {xmlLoading ? t('eventv.loading_xml') : xml}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50">{label}</div>
      <div className="mt-0.5 truncate text-[12px] text-foreground/80" title={value}>{value}</div>
    </div>
  )
}

// ── 分页控件（基于已查询数据集的前端分页） ──
function Pager({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
  t,
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize: (n: number) => void
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const [jump, setJump] = useState('')
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  const span = 5
  let start = Math.max(1, page - Math.floor(span / 2))
  let end = Math.min(totalPages, start + span - 1)
  start = Math.max(1, end - span + 1)
  const pages: number[] = []
  for (let i = start; i <= end; i++) pages.push(i)

  const go = (p: number) => onPage(Math.min(totalPages, Math.max(1, p)))

  const btn = (disabled: boolean) =>
    cn(
      'flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-[11px] font-medium transition-colors',
      disabled
        ? 'cursor-not-allowed text-muted-foreground/30'
        : 'bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
    )

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="text-[11px] text-muted-foreground/60">
        {t('eventv.page_showing', { from, to })} · {t('eventv.page_total', { total })}
      </div>

      <div className="flex items-center gap-1">
        <button className={btn(page === 1)} disabled={page === 1} onClick={() => go(1)} title={t('eventv.page_first')}>
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button className={btn(page === 1)} disabled={page === 1} onClick={() => go(page - 1)} title={t('eventv.page_prev')}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {start > 1 && (
          <button className={btn(false)} onClick={() => go(1)}>{1}</button>
        )}
        {start > 2 && <span className="px-1 text-[11px] text-muted-foreground/40">…</span>}
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => go(p)}
            className={cn(
              'flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-[11px] font-medium transition-colors',
              p === page
                ? 'bg-primary/15 text-primary'
                : 'bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
            )}
          >
            {p}
          </button>
        ))}
        {end < totalPages - 1 && <span className="px-1 text-[11px] text-muted-foreground/40">…</span>}
        {end < totalPages && (
          <button className={btn(false)} onClick={() => go(totalPages)}>{totalPages}</button>
        )}
        <button className={btn(page === totalPages)} disabled={page === totalPages} onClick={() => go(page + 1)} title={t('eventv.page_next')}>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button className={btn(page === totalPages)} disabled={page === totalPages} onClick={() => go(totalPages)} title={t('eventv.page_last')}>
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground/60">{t('eventv.page_per')}</span>
        <select
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-foreground/80 outline-none"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {[20, 50, 100, 200].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground/60">{t('eventv.page_of', { cur: page, total: totalPages })}</span>
        <span className="text-[11px] text-muted-foreground/60">{t('eventv.page_jump')}</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jump}
          placeholder={String(page)}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = Math.trunc(Number(jump))
              if (Number.isFinite(n) && n > 0) go(n)
              setJump('')
            }
          }}
          className="w-16 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-foreground/80 outline-none"
        />
      </div>
    </div>
  )
}

function formatTime(iso: string, locale: string, full = false): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  if (!full) return locale === 'en' ? `${date} ${time}` : `${date} ${time}`
  return `${date} ${time}`
}
