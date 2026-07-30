import { useEffect, useMemo, useState } from 'react'
import {
  Clock,
  Globe,
  Atom,
  Radio,
  RefreshCw,
  Plus,
  X,
  CheckCircle2,
  AlertTriangle,
  Settings2,
  Wifi,
  Timer,
  MapPin,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

// 可供「多时区」与「本地时区」选择的常用时区（语言无关，直接显示 IANA 名称）
const TIMEZONES: string[] = [
  'UTC',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Atlantic/Reykjavik',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
]

const LOCAL_TZ_KEY = 'agentsc-tz'
const WORLD_CLOCKS_KEY = 'agentsc-worldclocks'

// 偏差在 ±1 秒内视为同步正常
const SYNC_THRESHOLD_MS = 1000

interface AtomicRef {
  epoch: number // 估算的权威时间（ms）
  fetchedAtLocal: number // 获取时的本地 Date.now()
  source: string
  rttMs: number
}

type ResyncStatus = 'idle' | 'doing' | 'ok' | 'fail' | 'unsupported'

function detectLocalTz(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz) return tz
  } catch {
    /* ignore */
  }
  return 'Asia/Shanghai'
}

function fmtTime(tz: string, date: Date): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return '--:--:--'
  }
}

function fmtDate(tz: string, date: Date): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).format(date)
  } catch {
    return '----/--/--'
  }
}

// 解析时区偏移，输出形如 "UTC+08:00"
function getOffsetLabel(tz: string, date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(date)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    return name.replace('GMT', 'UTC')
  } catch {
    return ''
  }
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < 1000) return abs.toFixed(0)
  return (abs / 1000).toFixed(2)
}

export default function TimeSync() {
  const { t, locale } = useI18n()
  const api = window.electronAPI

  // 每秒跳动一次
  const [now, setNow] = useState(() => Date.now())
  // 本地时区（时区设置）
  const [localTz, setLocalTz] = useState<string>(() => {
    try {
      const v = localStorage.getItem(LOCAL_TZ_KEY)
      if (v) return v
    } catch {
      /* ignore */
    }
    return detectLocalTz()
  })
  // 多时区列表
  const [worldClocks, setWorldClocks] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WORLD_CLOCKS_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string')
      }
    } catch {
      /* ignore */
    }
    return ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney']
  })

  // 原子钟参考
  const [reference, setReference] = useState<AtomicRef | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [resync, setResync] = useState<{ status: ResyncStatus; detail?: string }>({ status: 'idle' })
  const [addSelect, setAddSelect] = useState<string>(TIMEZONES[0])

  const date = useMemo(() => new Date(now), [now])

  // 原子钟实时估算：参考时间 + 自获取后流逝的本地时间
  const atomicNow = reference ? reference.epoch + (now - reference.fetchedAtLocal) : null
  const atomicDate = atomicNow !== null ? new Date(atomicNow) : null
  // 本机时钟误差 = 真实时间 - 本地时间（恒定值）
  const clockErrorMs = reference ? reference.epoch - reference.fetchedAtLocal : 0

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // 持久化
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_TZ_KEY, localTz)
    } catch {
      /* ignore */
    }
  }, [localTz])

  useEffect(() => {
    try {
      localStorage.setItem(WORLD_CLOCKS_KEY, JSON.stringify(worldClocks))
    } catch {
      /* ignore */
    }
  }, [worldClocks])

  const doSync = async () => {
    if (syncing) return
    setSyncing(true)
    setResync({ status: 'idle' })
    try {
      const res = (await api?.invoke('time:reference')) as
        | { ok: boolean; epoch?: number; source?: string; rttMs?: number; error?: string }
        | undefined
      if (res && res.ok && typeof res.epoch === 'number') {
        setReference({
          epoch: res.epoch,
          fetchedAtLocal: Date.now(),
          source: res.source || '—',
          rttMs: typeof res.rttMs === 'number' ? res.rttMs : 0,
        })
        setLastSyncAt(Date.now())
      }
    } catch {
      /* 网络异常，保持上次参考 */
    } finally {
      setSyncing(false)
    }
  }

  const doResync = async () => {
    if (resync.status === 'doing') return
    setResync({ status: 'doing' })
    try {
      const res = (await api?.invoke('time:resync')) as
        | { ok: boolean; output: string; supported: boolean }
        | undefined
      if (!res) {
        setResync({ status: 'fail', detail: 'no-response' })
      } else if (!res.supported) {
        setResync({ status: 'unsupported' })
      } else if (res.ok) {
        setResync({ status: 'ok', detail: res.output })
        // 触发系统校时后顺带刷新一次原子参考
        void doSync()
      } else {
        setResync({ status: 'fail', detail: res.output || 'unknown' })
      }
    } catch (e) {
      setResync({ status: 'fail', detail: String(e) })
    }
  }

  const addClock = () => {
    if (!worldClocks.includes(addSelect)) {
      setWorldClocks((prev) => [...prev, addSelect])
    }
  }

  const removeClock = (tz: string) => {
    setWorldClocks((prev) => prev.filter((x) => x !== tz))
  }

  // 本地日期 vs 原子日期（按本地时区比较，用于「日期同步」提示）
  const localDateStr = fmtDate(localTz, date)
  const atomicDateStr = atomicDate ? fmtDate(localTz, atomicDate) : null
  const dateMismatch = atomicDateStr ? localDateStr !== atomicDateStr : false

  const synced = reference ? Math.abs(clockErrorMs) <= SYNC_THRESHOLD_MS : false

  // 可选添加的时区（排除已添加项）
  const availableToAdd = TIMEZONES.filter((tz) => !worldClocks.includes(tz))

  return (
    <div className="space-y-6">
      {/* ── 头部 ── */}
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('time.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('time.subtitle')}</p>
          </div>
          <Button size="sm" className="ml-auto" onClick={() => void doSync()} disabled={syncing}>
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            {syncing ? t('time.syncing') : t('time.sync_now')}
          </Button>
        </div>
      </section>

      {/* ── 主时钟：本地时间 + 世界时 ── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="glass relative overflow-hidden rounded-2xl border border-white/5 p-6">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-transparent" />
          <div className="relative flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-primary" />
            {t('time.local_clock')}
          </div>
          <div className="relative mt-2 font-mono text-4xl font-bold tracking-tight tabular-nums">
            {fmtTime(localTz, date)}
          </div>
          <div className="relative mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            <span>{localTz}</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px]">{getOffsetLabel(localTz, date)}</span>
          </div>
          <div className="relative mt-3 text-sm text-foreground/80">{localDateStr}</div>
        </div>

        <div className="glass relative overflow-hidden rounded-2xl border border-white/5 p-6">
          <div className="absolute inset-0 bg-gradient-to-br from-info/8 via-transparent to-transparent" />
          <div className="relative flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            <Globe className="h-3.5 w-3.5 text-info" />
            {t('time.utc')}
          </div>
          <div className="relative mt-2 font-mono text-4xl font-bold tracking-tight tabular-nums text-info">
            {fmtTime('UTC', date)}
          </div>
          <div className="relative mt-1 text-xs text-muted-foreground">{t('time.utc_full')}</div>
          <div className="relative mt-3 text-sm text-foreground/80">{fmtDate('UTC', date)}</div>
        </div>
      </section>

      {/* ── 原子钟时间 / 时间同步状态 ── */}
      <section className="glass rounded-2xl border border-white/5 p-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <Atom className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t('time.atomic')}</h3>
            <p className="text-xs text-muted-foreground">{t('time.atomic_desc')}</p>
          </div>
          {reference && (
            <span
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                synced ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400',
              )}
            >
              {synced ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {synced ? t('time.drift_ok') : Math.abs(clockErrorMs) > SYNC_THRESHOLD_MS ? (clockErrorMs > 0 ? t('time.drift_slow', { sec: formatDuration(clockErrorMs) }) : t('time.drift_fast', { sec: formatDuration(clockErrorMs) })) : ''}
            </span>
          )}
        </div>

        {reference && atomicDate ? (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="text-[11px] text-muted-foreground">{t('time.live_atomic')}</div>
              <div className="mt-1 font-mono text-2xl font-bold tracking-tight tabular-nums">
                {fmtTime('UTC', atomicDate)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{fmtDate('UTC', atomicDate)}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="text-[11px] text-muted-foreground">{t('time.offset')}</div>
              <div
                className={cn(
                  'mt-1 font-mono text-2xl font-bold tracking-tight tabular-nums',
                  synced ? 'text-emerald-400' : clockErrorMs > 0 ? 'text-amber-400' : 'text-orange-400',
                )}
              >
                {synced
                  ? '±0 s'
                  : clockErrorMs > 0
                    ? `+${formatDuration(clockErrorMs)} s`
                    : `${formatDuration(clockErrorMs)} s`}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {synced
                  ? t('time.drift_ok')
                  : clockErrorMs > 0
                    ? t('time.drift_slow', { sec: formatDuration(clockErrorMs) })
                    : t('time.drift_fast', { sec: formatDuration(clockErrorMs) })}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs text-amber-300/90">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('time.reference_unavailable')}
            </span>
          </div>
        )}

        {/* 日期同步校验 */}
        {reference && dateMismatch && (
          <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('time.date_mismatch')}
            </span>
          </div>
        )}

        {/* 元数据 + 校时操作 */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {reference && (
            <>
              <span className="flex items-center gap-1.5">
                <Wifi className="h-3.5 w-3.5" />
                {t('time.source')}: <span className="text-foreground/80">{reference.source}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" />
                {t('time.rtt')}: <span className="text-foreground/80">{reference.rttMs} ms</span>
              </span>
            </>
          )}
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {t('time.last_sync')}:{' '}
            <span className="text-foreground/80">
              {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US') : t('time.never')}
            </span>
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => void doResync()} disabled={resync.status === 'doing'}>
            <Radio className={cn('h-3.5 w-3.5', resync.status === 'doing' && 'animate-pulse')} />
            {resync.status === 'doing' ? t('time.resyncing') : t('time.resync_os')}
          </Button>
          <span className="text-[11px] text-muted-foreground">{t('time.resync_os_desc')}</span>
        </div>

        {resync.status === 'ok' && (
          <div className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('time.resync_ok')}
            </span>
          </div>
        )}
        {resync.status === 'fail' && (
          <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('time.resync_fail', { detail: resync.detail || '' })}
            </span>
          </div>
        )}
        {resync.status === 'unsupported' && (
          <div className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('time.resync_unsupported')}
            </span>
          </div>
        )}
      </section>

      {/* ── 多时区时间 ── */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t('time.world_clocks')}</h3>
          <span className="text-xs text-muted-foreground">{t('time.world_clocks_desc')}</span>
        </div>

        {worldClocks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-muted-foreground">
            {t('time.no_clocks')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {worldClocks.map((tz) => (
              <div key={tz} className="glass group relative rounded-2xl border border-white/5 p-4">
                <button
                  onClick={() => removeClock(tz)}
                  className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/40 opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-red-400"
                  title={t('time.remove')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {tz}
                </div>
                <div className="mt-1 font-mono text-2xl font-bold tracking-tight tabular-nums">
                  {fmtTime(tz, date)}
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{fmtDate(tz, date)}</span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px]">{getOffsetLabel(tz, date)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 添加时区 */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <select
              value={addSelect}
              onChange={(e) => setAddSelect(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-card px-9 py-2 text-xs text-foreground"
            >
              {(availableToAdd.length ? availableToAdd : TIMEZONES).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" variant="outline" onClick={addClock} disabled={availableToAdd.length === 0}>
            <Plus className="h-3.5 w-3.5" />
            {t('time.add')}
          </Button>
        </div>
      </section>

      {/* ── 时区设置 ── */}
      <section className="glass rounded-2xl border border-white/5 p-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t('time.tz_setting')}</h3>
            <p className="text-xs text-muted-foreground">{t('time.local_timezone')}</p>
          </div>
        </div>
        <div className="mt-4 max-w-md">
          <select
            value={localTz}
            onChange={(e) => setLocalTz(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-card px-3 py-2 text-sm text-foreground"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz} · {getOffsetLabel(tz, date) || 'UTC'}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  )
}
