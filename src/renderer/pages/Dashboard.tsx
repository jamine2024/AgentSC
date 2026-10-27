import {
  useEffect, useState, useCallback, useRef, useMemo, memo,
} from 'react'
import {
  Activity, Eye, FileSearch, FolderOpen, HardDrive, Trash2,
  Brain, AlertTriangle, Lightbulb, ChevronRight, Radio, Sparkles,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { AiInsightsResult } from '@/App'

interface DiskInfo {
  letter: string
  label: string
  total: number
  used: number
}

interface FileEvent {
  id?: number
  type: 'created' | 'modified' | 'deleted' | 'renamed'
  path: string
  size?: number
  recorded_at: number
  process_name?: string
  process_id?: number
}

interface DailyStats {
  created_count: number
  deleted_count: number
  created_bytes: number
  deleted_bytes: number
}

interface DailyTrendRow {
  day: string
  created_count: number
  deleted_count: number
  created_bytes: number
  deleted_bytes: number
}

interface TopCreatedPathRow {
  path: string
  total_size: number
  count: number
}

interface TopProcessRow {
  process_name: string
  event_count: number
}

// ─── Live Dot Indicator ───────────────────────────────────────────

function LiveDot() {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-live-dot rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
    </span>
  )
}

// ─── Real-time Event Rate Wave ────────────────────────────────────

// 波形柱高必须由 rate 确定性地推导：原实现每次 rate 变化都用 Math.random()
// 重新洗牌，柱子高度在动画中途被改写，触发 16 个元素逐个重排重绘，
// 看上去是"一直在抖"，也白白消耗渲染帧。
const EventWave = memo(function EventWave({ rate }: { rate: number }) {
  const bars = useMemo(() => {
    const intensity = Math.min(rate / 30, 1)
    return Array.from({ length: 16 }, (_, i) => {
      // 用正弦叠加固定相位，形成稳定的波形起伏（无随机数）
      const wobble = Math.sin(i * 1.7) * 0.08 + Math.sin(i * 0.6 + 1.2) * 0.06
      return {
        height: 0.3 + Math.sin((i / 16) * Math.PI * 2) * 0.35 * intensity + wobble * intensity,
        delay: (i / 16) * 1.2,
      }
    })
  }, [rate])

  return (
    <div className="flex h-10 items-end gap-[2px]">
      {bars.map((bar, i) => (
        <div
          key={i}
          className="w-[4px] animate-wave rounded-sm"
          style={{
            height: `${Math.max(bar.height * 100, 8)}%`,
            animationDelay: `${bar.delay}s`,
            backgroundColor: rate > 20
              ? 'hsl(var(--destructive) / 0.7)'
              : rate > 5
                ? 'hsl(38 92% 52% / 0.7)'
                : 'hsl(var(--primary) / 0.55)',
            transition: 'background-color 0.5s ease',
          }}
        />
      ))}
    </div>
  )
})

// ─── Stat Card — Premium version ─────────────────────────────────

const StatCard = memo(function StatCard({ label, value, sub, icon: Icon, tone = 'primary', live = false }: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  tone?: 'primary' | 'accent' | 'destructive' | 'success'
  live?: boolean
}) {
  const toneConfig = {
    primary:   { bg: 'bg-indigo-500/12 text-indigo-400 border border-indigo-500/15', iconBg: 'bg-gradient-to-br from-indigo-500/15 to-indigo-500/5' },
    accent:    { bg: 'bg-violet-500/12 text-violet-400 border border-violet-500/15', iconBg: 'bg-gradient-to-br from-violet-500/15 to-violet-500/5' },
    destructive:{ bg: 'bg-red-500/12 text-red-400 border border-red-500/15', iconBg: 'bg-gradient-to-br from-red-500/15 to-red-500/5' },
    success:   { bg: 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/15', iconBg: 'bg-gradient-to-br from-emerald-500/15 to-emerald-500/5' },
  }
  const tc = toneConfig[tone]

  return (
    <div className="group glass glass-hover relative overflow-hidden rounded-2xl p-5 transition-all duration-300">
      {/* Subtle gradient glow on hover */}
      <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-bl from-primary/[0.06] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">
            {live && <LiveDot />}
            {label}
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-foreground tabular-nums transition-all duration-300">
            {value}
          </div>
          {sub && <div className="mt-1 text-[11px] text-muted-foreground/60">{sub}</div>}
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg', tc.bg, tc.iconBg)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </div>
  )
})

// ─── Event Row ─────────────────────────────────────────────────────

const EventRow = memo(function EventRow({ event, isNew }: { event: FileEvent; isNew: boolean }) {
  const { t } = useI18n()
  const typeConfig = {
    created:  { label: t('event.created'),  class: 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/20' },
    modified:  { label: t('event.modified'), class: 'bg-blue-500/12 text-blue-400 border border-blue-500/20' },
    deleted:  { label: t('event.deleted'),  class: 'bg-red-500/12 text-red-400 border border-red-500/20' },
    renamed:  { label: t('event.renamed'),  class: 'bg-amber-500/12 text-amber-400 border border-amber-500/20' },
  }
  const cfg = typeConfig[event.type]
  return (
    <div
      className={cn(
        'group flex items-center justify-between border-b border-white/[0.04] py-2.5 last:border-0 transition-colors duration-200 hover:bg-white/[0.02]',
        // 只给「刚到达」的行加动画。之前 else 分支挂了 animate-fade-in，导致 isNew
        // 在 1.5s 后翻回 false 时整行再播一次淡入 —— 每批事件都会让列表二次闪动，
        // 同时也是 50 行 × 每帧动画的额外合成开销。
        isNew && 'animate-slide-down bg-gradient-to-r from-primary/[0.03] via-transparent to-transparent',
      )}
    >
      <div className="flex items-center gap-3 overflow-hidden min-w-0">
        <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide', cfg.class)}>
          {cfg.label}
        </span>
        <span className="truncate text-[13px] text-muted-foreground/80 group-hover:text-foreground/70 transition-colors" title={event.path}>
          {event.path}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground/50">
        <span
          className={cn(
            'max-w-[130px] truncate rounded-full px-2 py-0.5 transition-colors',
            event.process_name
              ? 'border-primary/15 bg-primary/8 text-primary/80'
              : 'border-white/[0.06] bg-white/[0.03] text-muted-foreground/50'
          )}
          title={event.process_name ? `PID ${event.process_id ?? '-'}` : t('event.unidentified')}
        >
          {event.process_name || t('event.unknown_process')}
        </span>
        <span className="w-14 text-right tabular-nums">{event.size ? formatBytes(event.size) : '-'}</span>
        <span className="w-18 text-right tabular-nums">{new Date(event.recorded_at).toLocaleTimeString()}</span>
      </div>
    </div>
  )
})

// ─── AI Mini Card ─────────────────────────────────────────────────

function AiMiniCard({ result, loading, glowKey }: { result: AiInsightsResult | null; loading: boolean; glowKey: number }) {
  const { t } = useI18n()
  const highCount = result?.anomalies.filter((a) => a.severity === 'high').length ?? 0
  const mediumCount = result?.anomalies.filter((a) => a.severity === 'medium').length ?? 0
  const totalAnomalies = result?.anomalies.length ?? 0
  const totalSuggestions = result?.suggestions.length ?? 0

  if (loading && !result) {
    return (
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-info/10 border border-primary/10">
            <Brain className="h-5 w-5 animate-pulse text-primary" />
          </div>
          <div className="flex-1 space-y-2.5">
            <div className="h-4 w-32 rounded-md shimmer" />
            <div className="h-3 w-52 rounded shimmer" />
          </div>
        </div>
      </div>
    )
  }

  if (!result) return null

  const hasAlert = highCount > 0

  return (
    <div
      key={glowKey}
      className={cn(
        'glass glass-hover relative overflow-hidden rounded-2xl p-5 transition-all duration-700',
        hasAlert
          ? 'border-red-500/15 bg-gradient-to-br from-red-950/[0.08] via-transparent to-transparent'
          : 'border-white/[0.06]'
      )}
    >
      {/* Alert glow effect */}
      {hasAlert && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      )}

      <div className="relative flex items-start justify-between">
        <div className="flex items-start gap-3.5 min-w-0">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-500',
              hasAlert
                ? 'bg-red-500/12 text-red-400 border-red-500/20'
                : 'bg-gradient-to-br from-primary/15 to-info/10 text-primary border-primary/15'
            )}
          >
            {hasAlert ? <AlertTriangle className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[14px] font-semibold tracking-tight text-foreground">{t('dashboard.ai_title')}</span>
              {(highCount > 0 || mediumCount > 0) && (
                <span className="rounded-full bg-red-500/12 border border-red-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-red-400">
                  {highCount > 0
                    ? `${highCount} ${t('dashboard.ai_high_alerts')}`
                    : `${totalAnomalies} ${t('dashboard.ai_anomalies')}`}
                </span>
              )}
              {highCount === 0 && totalAnomalies > 0 && (
                <span className="rounded-full bg-amber-500/12 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400">
                  {totalAnomalies} {t('dashboard.ai_anomalies')}
                </span>
              )}
              {highCount === 0 && totalAnomalies === 0 && (
                <span className="rounded-full bg-emerald-500/12 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                  {t('dashboard.ai_good_news')}
                </span>
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/80">
              {result.summary || t('dashboard.ai_no_data')}
            </p>
            <div className="mt-2.5 flex items-center gap-3 flex-wrap">
              {totalAnomalies > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-amber-400/80">
                  <AlertTriangle className="h-3 w-3" />
                  {totalAnomalies} {t('dashboard.ai_anomalies')}
                </span>
              )}
              {totalSuggestions > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400/80">
                  <Lightbulb className="h-3 w-3" />
                  {totalSuggestions} {t('dashboard.ai_suggestions')}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground/40">
                {t('dashboard.ai_last_analysis')}: {new Date(result.generatedAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
        <a
          href="#reports"
          onClick={(e) => {
            e.preventDefault()
            window.dispatchEvent(new CustomEvent('navigate', { detail: 'reports' }))
          }}
          className="group/btn flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-[11px] text-muted-foreground/70 transition-all duration-200 hover:border-primary/25 hover:text-primary hover:bg-primary/5"
        >
          {t('dashboard.ai_click_to_insights')}
          <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
        </a>
      </div>
    </div>
  )
}

// ─── Data Flow Stream ─────────────────────────────────────────────

function DataStream({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2">
      <Radio className={cn('h-3.5 w-3.5 shrink-0 transition-colors', active ? 'text-emerald-400' : 'text-muted-foreground/30')} />
      <div className="flex items-center gap-4 overflow-hidden">
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: active ? 'hsl(160 67% 45%)' : 'hsl(var(--muted-foreground) / 0.4)' }}>
          {active ? 'LIVE' : 'OFF'}
        </span>
        <div className="flex h-3 items-end gap-[3px]">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className={cn('w-[2px] rounded-full', active ? 'animate-wave' : 'opacity-30')}
              style={{
                height: active ? '100%' : '3px',
                transformOrigin: 'bottom',
                animationDelay: `${i * 0.06}s`,
                backgroundColor: active
                  ? `hsl(${160 + (i % 6) * 6} 60% ${55 - (i % 4) * 5}% / 0.7)`
                  : 'hsl(var(--muted-foreground) / 0.15)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Disk Card ────────────────────────────────────────────────────

const DiskCard = memo(function DiskCard({ disk }: { disk: DiskInfo }) {
  const percent = disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0
  const isCritical = percent > 85
  const isWarning = percent > 60 && !isCritical

  return (
    <div className="group glass glass-hover relative overflow-hidden rounded-2xl p-5 transition-all duration-300">
      {/* Subtle disk icon watermark */}
      <div className="absolute -right-3 -bottom-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <HardDrive className="h-16 w-16 text-primary/[0.04]" />
      </div>

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-300 group-hover:scale-110',
            isCritical
              ? 'bg-red-500/12 text-red-400 border-red-500/20'
              : isWarning
                ? 'bg-amber-500/12 text-amber-400 border-amber-500/20'
                : 'bg-indigo-500/12 text-indigo-400 border-indigo-500/15'
          )}>
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-tight text-foreground">{disk.letter}</div>
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">{disk.label}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={cn(
            'text-sm font-bold tabular-nums transition-colors duration-300',
            isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-foreground'
          )}>
            {percent}%
          </div>
          <div className="text-[10px] text-muted-foreground/50 mt-0.5">
            {formatBytes(disk.used)} / {formatBytes(disk.total)}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary/50">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-1000 ease-out',
            isCritical
              ? 'bg-gradient-to-r from-red-500 to-orange-500'
              : isWarning
                ? 'bg-gradient-to-r from-amber-400 to-yellow-400'
                : 'bg-gradient-to-r from-primary to-info'
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
})

const TrendChart = memo(function TrendChart({ trendData }: { trendData: DailyTrendRow[] }) {
  const { t } = useI18n()
  const hasTrendData = trendData.some((d) => (d.created_count + d.deleted_count) > 0)
  return (
    <div className="lg:col-span-1 space-y-4">
      <h2 className="text-[13px] font-semibold tracking-tight text-foreground/90 flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground/40" />
        {t('dashboard.seven_day_trend')}
      </h2>
      <div className="glass rounded-2xl border border-white/[0.05] p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground/60">{t('dashboard.daily_new_events')}</span>
          <span className="text-lg font-bold tabular-nums text-primary">
            {trendData.length > 0 ? trendData[trendData.length - 1].created_count.toLocaleString() : '0'}
          </span>
        </div>
        <div className="mt-2 h-36 w-full">
          {hasTrendData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 4, right: 4, left: -18, bottom: 4 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground) / 0.5)' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <Tooltip content={<TrendTooltip />} cursor={{ fill: 'hsl(var(--primary) / 0.06)' }} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                  {trendData.map((_entry, idx) => (
                    <Cell
                      key={`cell-${idx}`}
                      fill="hsl(var(--primary) / 0.75)"
                      className="transition-all duration-300"
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.06] bg-white/[0.02]">
              <Activity className="h-6 w-6 text-muted-foreground/20 mb-2" />
              <span className="text-[11px] text-muted-foreground/40">{t('dashboard.no_trend_data')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ─── Trend Tooltip ────────────────────────────────────────────────

function TrendTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: DailyTrendRow; color: string }>
  label?: string
}) {
  const { t } = useI18n()
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  return (
    <div className="rounded-xl border border-white/10 bg-[hsl(222,41%,7%)]/95 backdrop-blur-xl px-4 py-3 text-xs shadow-2xl">
      <div className="mb-2 text-sm font-semibold text-white/90">{label}</div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-emerald-400">{t('reports.created')}</span>
          <span className="text-white/90">
            {row.created_count.toLocaleString()}
            <span className="ml-1 text-muted-foreground/50">({formatBytes(row.created_bytes)})</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-red-400">{t('reports.deleted')}</span>
          <span className="text-white/90">
            {row.deleted_count.toLocaleString()}
            <span className="ml-1 text-muted-foreground/50">({formatBytes(row.deleted_bytes)})</span>
          </span>
        </div>
        <div className="border-t border-white/10 pt-1.5 mt-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground/60">{t('reports.daily_trend')}</span>
            <span className="font-medium text-white/90">
              {(row.created_count + row.deleted_count).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Top Active Processes Mini ────────────────────────────────────

function TopProcessesMini({ processes }: { processes: TopProcessRow[] }) {
  const { t } = useI18n()
  const max = Math.max(1, processes[0]?.event_count ?? 1)
  return (
    <div className="mt-4 border-t border-white/[0.05] pt-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          {t('dashboard.top_active_processes')}
        </span>
        <span className="text-[10px] text-muted-foreground/40">
          {processes.length > 0 ? `${processes.length} ${t('dashboard.processes')}` : t('common.no_data')}
        </span>
      </div>
      {processes.length > 0 ? (
        <div className="space-y-2">
          {processes.slice(0, 4).map((p) => (
            <div key={p.process_name} className="group relative">
              <div className="relative z-10 flex items-center justify-between text-[11px]">
                <span className="truncate text-muted-foreground/80 group-hover:text-foreground/70 transition-colors" title={p.process_name}>
                  {p.process_name}
                </span>
                <span className="ml-2 shrink-0 tabular-nums text-foreground/70">{p.event_count}</span>
              </div>
              <div
                className="absolute bottom-0 left-0 h-full rounded-md bg-primary/[0.06] transition-all duration-500 group-hover:bg-primary/[0.10]"
                style={{ width: `${Math.max((p.event_count / max) * 100, 2)}%` }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="py-2 text-center text-[11px] text-muted-foreground/40">
          {t('dashboard.no_process_data')}
        </div>
      )}
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────

export default function Dashboard() {
  const { t } = useI18n()
  const api = window.electronAPI
  const [disks, setDisks] = useState<DiskInfo[]>([])
  const [stats, setStats] = useState<DailyStats>({
    created_count: 0,
    deleted_count: 0,
    created_bytes: 0,
    deleted_bytes: 0,
  })
  const [events, setEvents] = useState<FileEvent[]>([])
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set())
  const [eventRate, setEventRate] = useState(0)
  const [trend, setTrend] = useState<DailyTrendRow[]>([])
  const [topPaths, setTopPaths] = useState<TopCreatedPathRow[]>([])
  const [topProcesses, setTopProcesses] = useState<TopProcessRow[]>([])

  // AI state
  const [aiResult, setAiResult] = useState<AiInsightsResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiGlowKey, setAiGlowKey] = useState(0)
  const aiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const eventCounterRef = useRef(0)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Data loaders ──────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    const s = await api?.invoke('get-daily-stats')
    if (s && typeof s === 'object') setStats(s as DailyStats)
  }, [api])

  const loadEvents = useCallback(async () => {
    const e = await api?.invoke('get-recent-events', 50)
    if (Array.isArray(e)) setEvents(e as FileEvent[])
  }, [api])

  const loadTrend = useCallback(async () => {
    const tr = await api?.invoke('get-daily-trend', 7)
    if (Array.isArray(tr)) setTrend(tr as DailyTrendRow[])
  }, [api])

  const loadTopPaths = useCallback(async () => {
    const p = await api?.invoke('get-top-created-paths', undefined, 10)
    if (Array.isArray(p)) setTopPaths(p as TopCreatedPathRow[])
  }, [api])

  const loadTopProcesses = useCallback(async () => {
    const p = await api?.invoke('get-top-processes')
    if (Array.isArray(p)) setTopProcesses(p as TopProcessRow[])
  }, [api])

  const loadAiSummary = useCallback(async () => {
    setAiLoading(true)
    try {
      const res = await api?.invoke('get-ai-quick-summary')
      if (res && typeof res === 'object') {
        setAiResult(res as AiInsightsResult)
        setAiGlowKey((k) => k + 1)
      }
    } catch {
      // silently fail on dashboard
    } finally {
      setAiLoading(false)
    }
  }, [api])

  // 事件驱动刷新：自适应节流。事件流活跃时每 2s 刷新一次（与旧版一致）；
  // 无事件时降到 12s 慢刷新 —— 空闲时看板数据基本不变，2s 轮询等于让主进程
  // 每秒都在空跑 4 个聚合查询 + 整页 recharts 重渲染。
  // 原纯 debounce 在持续事件流下会因定时器不断被重置而永不触发，导致实时统计
  // 卡在旧值；因此保留基于时间戳的节流，只是间隔随事件活跃度切换。
  const REFRESH_INTERVAL_ACTIVE = 2000   // 事件流活跃时的刷新下限
  const REFRESH_INTERVAL_IDLE = 12000    // 无事件时的慢刷新
  const EVENT_IDLE_THRESHOLD_MS = 10000  // 超过 10s 无新事件视为空闲
  const lastRefreshRef = useRef(0)
  const lastEventAtRef = useRef(0)
  const runRefresh = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    loadStats()
    loadTrend()
    loadTopPaths()
    loadTopProcesses()
  }, [loadStats, loadTrend, loadTopPaths, loadTopProcesses])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    const interval =
      Date.now() - lastEventAtRef.current < EVENT_IDLE_THRESHOLD_MS
        ? REFRESH_INTERVAL_ACTIVE
        : REFRESH_INTERVAL_IDLE
    const elapsed = Date.now() - lastRefreshRef.current
    if (elapsed >= interval) {
      lastRefreshRef.current = Date.now()
      runRefresh()
    } else {
      refreshTimerRef.current = setTimeout(() => {
        lastRefreshRef.current = Date.now()
        runRefresh()
      }, interval - elapsed)
    }
  }, [runRefresh])

  // ── Effects ───────────────────────────────────────────────────

  useEffect(() => {
    // 分帧加载首页数据，降低启动时主进程与渲染线程压力
    const loaders = [
      () => api?.invoke('get-disk-info').then((d) => { if (Array.isArray(d)) setDisks(d) }),
      loadStats,
      loadEvents,
      loadTrend,
      loadTopPaths,
      loadTopProcesses,
    ]
    // 首屏关键数据全部加载完成后，通知 App 收起启动动画（无论成功/失败都计数）
    const total = loaders.length
    let done = 0
    let firedReady = false
    const maybeReady = () => {
      done += 1
      if (done >= total && !firedReady) {
        firedReady = true
        window.dispatchEvent(new CustomEvent('dashboard:ready'))
      }
    }
    loaders.forEach((fn, idx) => {
      const run = () => { Promise.resolve(fn()).then(maybeReady, maybeReady) }
      if (idx === 0) run()
      else if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: 200 + idx * 150 })
      } else {
        setTimeout(run, idx * 80)
      }
    })

    // AI 摘要延迟加载，避免阻塞关键首屏数据
    const aiTimeout = setTimeout(() => { loadAiSummary().catch(() => {}) }, 600)

    // 事件流入合并：主进程 500ms 一批推送，批次密集时若每个批次都立刻 setState，
    // 一帧内可能连续触发多次整表重渲染（50 行 × 多个 state）。这里先攒进 ref，
    // 用 rAF 合并到「每帧最多一次」提交，事件风暴下渲染压力从 O(批次) 降到 O(帧)。
    let pending: FileEvent[] = []
    let flushScheduled = false
    let newIdsTimer: ReturnType<typeof setTimeout> | null = null

    const commitPending = () => {
      flushScheduled = false
      if (pending.length === 0) return
      const incoming = pending
      pending = []
      lastEventAtRef.current = Date.now()
      const ids = new Set(incoming.map((e) => `${e.path}-${e.recorded_at}`))
      setEvents((prev) => [...incoming, ...prev].slice(0, 50))
      setNewEventIds(ids)
      setEventRate((r) => Math.min(r + incoming.length, 999))
      if (newIdsTimer) clearTimeout(newIdsTimer)
      newIdsTimer = setTimeout(() => setNewEventIds(new Set()), 1500)
      scheduleRefresh()
    }

    const enqueue = (items: FileEvent[]) => {
      pending.push(...items)
      if (flushScheduled) return
      flushScheduled = true
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(commitPending)
      } else {
        setTimeout(commitPending, 16)
      }
    }

    const onBatchEvent = (...args: unknown[]) => {
      const batch = args[0] as FileEvent[] | undefined
      if (!Array.isArray(batch) || batch.length === 0) return
      eventCounterRef.current += batch.length
      enqueue(batch)
    }

    const onSingleEvent = (...args: unknown[]) => {
      const evt = args[0] as FileEvent
      if (evt && typeof evt === 'object' && 'path' in evt) {
        eventCounterRef.current += 1
        enqueue([evt])
      }
    }

    api?.on('file-events-batch', onBatchEvent)
    api?.on('file-event', onSingleEvent)
    // 空闲心跳：事件稀疏时 scheduleRefresh 不会被调用，靠这个 12s 定时器兜底，
    // 保证趋势/Top 榜等仍按慢节奏刷新（事件活跃时它调用 scheduleRefresh，
    // 会被 2s 节流挡住，不会造成重复刷新）
    const idleHeartbeat = setInterval(scheduleRefresh, REFRESH_INTERVAL_IDLE)
    return () => {
      api?.removeAllListeners('file-events-batch')
      api?.removeAllListeners('file-event')
      clearInterval(idleHeartbeat)
      clearTimeout(aiTimeout)
      if (newIdsTimer) clearTimeout(newIdsTimer)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [])

  useEffect(() => {
    aiTimerRef.current = setInterval(() => {
      loadAiSummary()
    }, 60_000)
    return () => {
      if (aiTimerRef.current) clearInterval(aiTimerRef.current)
    }
  }, [loadAiSummary])

  // 事件速率的自然衰减：只在「确实还有速率」时才 setState。
  // 原实现每秒无条件写入一次新值（即使已经是 0），空转也会让整个看板每秒重渲染一遍。
  useEffect(() => {
    const t = setInterval(() => {
      setEventRate((r) => (r > 0 ? Math.max(0, Math.round(r * 0.7)) : r))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const monitoringActive = eventRate > 0 || events.length > 0

  const trendData = useMemo(() => trend.map((row) => ({
    ...row,
    label: row.day.slice(5),
    total: row.created_count + row.deleted_count,
  })), [trend])

  return (
    <div className="space-y-6">
      {/* ── Top Bar: Live Status + Data Stream ──────────────── */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <LiveDot />
            <span className="text-xs font-medium text-emerald-400/90">
              {t('header.monitoring_active')}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground/50">
            {events.length > 0
              ? `${eventCounterRef.current || events.length} ${t('dashboard.events_per_min')}`
              : t('dashboard.loading_disks')}
          </span>
        </div>
        <DataStream active={monitoringActive} />
      </section>

      {/* ── Top Stats Grid ───────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('dashboard.today_created')} value={stats?.created_count?.toLocaleString() ?? '0'} sub={`${formatBytes(stats?.created_bytes ?? 0)}`} icon={FileSearch} tone="success" live />
        <StatCard label={t('dashboard.today_deleted')} value={stats?.deleted_count?.toLocaleString() ?? '0'} sub={`${t('dashboard.freed')} ${formatBytes(stats?.deleted_bytes ?? 0)}`} icon={Trash2} tone="destructive" live />
        <StatCard label={t('dashboard.events_per_min')} value={eventRate.toString()} sub={t('dashboard.realtime_fluctuation')} icon={Activity} tone="accent" live />
        <StatCard label={t('dashboard.monitored_disks')} value={disks.length.toString()} sub={t('dashboard.auto_discovered')} icon={Eye} tone="primary" />
      </section>

      {/* ── AI Insights Section ──────────────────────────────── */}
      <section>
        <AiMiniCard result={aiResult} loading={aiLoading} glowKey={aiGlowKey} />
      </section>

      {/* ── Event Rate Wave + Disk Overview + 7-Day Trend ──────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Event Rate Wave */}
        <div className="lg:col-span-1 glass rounded-2xl border border-white/[0.05] p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">{t('dashboard.events_per_min')}</span>
            <span className="text-xl font-bold tabular-nums tracking-tight" style={{ color: eventRate > 20 ? 'hsl(var(--destructive))' : eventRate > 5 ? 'hsl(38 92% 52%)' : 'hsl(var(--foreground))' }}>
              {eventRate}
            </span>
          </div>
          <EventWave rate={eventRate} />
          <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground/40">
            <span>{t('dashboard.realtime_fluctuation')}</span>
            <span className="tabular-nums font-mono">{new Date().toLocaleTimeString()}</span>
          </div>
          <TopProcessesMini processes={topProcesses} />
        </div>

        {/* Disk Overview */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground/90 flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground/40" />
            {t('dashboard.disk_overview')}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {disks.length > 0 ? (
              disks.map((disk) => <DiskCard key={disk.letter} disk={disk} />)
            ) : (
              <div className="glass rounded-2xl border border-white/[0.05] p-10 text-center md:col-span-2">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03] mb-3">
                  <HardDrive className="h-5 w-5 text-muted-foreground/30" />
                </div>
                <p className="text-sm text-muted-foreground/50">{t('dashboard.loading_disks')}</p>
              </div>
            )}
          </div>
        </div>

        <TrendChart trendData={trendData} />
      </section>

      {/* ── Recent Events + Top Paths ─────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 glass rounded-2xl border border-white/[0.05] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground/90 flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary/50" />
              {t('dashboard.recent_events')}
            </h2>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[10px] text-muted-foreground/50 tabular-nums">
              {events.length} / 50
            </span>
          </div>
          {events.length > 0 ? (
            <div className="max-h-[480px] overflow-auto">
              {events.map((event) => {
                const id = `${event.path}-${event.recorded_at}`
                // key 里不能带下标：新事件总是插到数组头部，带下标会让「每一行」的
                // key 都发生变化，React 于是整列表卸载重建（50 行 × 每次事件），
                // 叠加 slide-down 动画就是肉眼可见的卡顿。id 本身已足够唯一。
                return (
                  <EventRow key={id} event={event} isNew={newEventIds.has(id)} />
                )
              })}
            </div>
          ) : (
            <div className="py-12 text-center">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03] mb-3">
                <Radio className="h-5 w-5 text-muted-foreground/20" />
              </div>
              <p className="text-sm text-muted-foreground/40">{t('dashboard.no_events_hint')}</p>
            </div>
          )}
        </div>
        <div className="glass rounded-2xl border border-white/[0.05] p-5">
          <h2 className="mb-4 text-[13px] font-semibold tracking-tight text-foreground/90 flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary/50" />
            {t('dashboard.top_created_paths')}
          </h2>
          <div className="max-h-[480px] overflow-auto">
            {topPaths.length > 0 ? (
              topPaths.map((item, idx) => {
                const maxSize = topPaths[0]?.total_size || 1
                const barWidth = Math.round((item.total_size / maxSize) * 100)
                return (
                  <div
                    key={item.path}
                    className="group relative border-b border-white/[0.04] py-2.5 last:border-0"
                  >
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-2 overflow-hidden min-w-0">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.03] text-[10px] font-bold text-muted-foreground/40">
                          {idx + 1}
                        </span>
                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
                        <span className="truncate text-[12px] text-muted-foreground/70 group-hover:text-foreground/60 transition-colors" title={item.path}>
                          {item.path}
                        </span>
                      </div>
                      <span className="ml-2 shrink-0 text-[11px] font-medium tabular-nums text-foreground/70">{formatBytes(item.total_size)}</span>
                    </div>
                    {/* Visual bar */}
                    <div
                      className="absolute bottom-0 left-0 h-full rounded-lg bg-gradient-to-r from-primary/[0.04] to-transparent transition-all duration-500 ease-out group-hover:from-primary/[0.08]"
                      style={{ width: `${Math.max(barWidth, 2)}%` }}
                    />
                  </div>
                )
              })
            ) : (
              <div className="py-12 text-center">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03] mb-3">
                  <FolderOpen className="h-5 w-5 text-muted-foreground/20" />
                </div>
                <p className="text-sm text-muted-foreground/40">{t('dashboard.no_new_files')}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
