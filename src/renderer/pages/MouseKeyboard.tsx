import { useEffect, useMemo, useState } from 'react'
import {
  MousePointer2,
  Keyboard,
  BarChart3,
  Activity,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Battery,
  Usb,
  Bluetooth,
  Monitor,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { MouseKeyboardInfo, MouseKbStats, RemapRule, InputInterface } from '@/lib/systemTypes'

// 与主进程 SCANCODES 的键保持一致（用于重映射下拉选择）
const KEY_OPTIONS = [
  'Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace', 'Tab',
  'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\',
  'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter',
  'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Space', 'CapsLock',
  'LShift', 'RShift', 'LCtrl', 'LAlt', 'LWin', 'RWin',
  'PrtSc', 'ScrollLock', 'Pause', 'Insert', 'Home', 'PageUp', 'Delete', 'End', 'PageDown',
  'Up', 'Left', 'Down', 'Right',
]

type TabKey = 'devices' | 'stats' | 'remap'

const tooltipStyle = {
  background: 'rgba(11,18,32,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 12,
  color: '#e2e8f0',
}

function interfaceIcon(it: InputInterface) {
  if (it === 'USB') return Usb
  if (it === '蓝牙') return Bluetooth
  if (it === '内置') return Monitor
  return MousePointer2
}

export default function MouseKeyboard() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [tab, setTab] = useState<TabKey>('devices')
  const [info, setInfo] = useState<MouseKeyboardInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<MouseKbStats | null>(null)
  const [statsRunning, setStatsRunning] = useState(false)
  const [rules, setRules] = useState<RemapRule[]>([])
  const [fromKey, setFromKey] = useState(KEY_OPTIONS[0])
  const [toKey, setToKey] = useState(KEY_OPTIONS[0])
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const loadInfo = async () => {
    setLoading(true)
    try {
      const r = (await api?.invoke('mouse-kb:info')) as MouseKeyboardInfo | { error: string }
      if (r && !('error' in r)) setInfo(r as MouseKeyboardInfo)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const s = (await api?.invoke('mouse-kb:stats:get')) as MouseKbStats
      setStats(s)
      setStatsRunning(!!s?.running)
    } catch {
      /* ignore */
    }
  }

  const loadRules = async () => {
    try {
      const r = (await api?.invoke('mouse-kb:remap:list')) as RemapRule[]
      setRules(Array.isArray(r) ? r : [])
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (tab === 'stats') void loadStats()
    if (tab === 'remap') void loadRules()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const startStats = async () => {
    const ok = await api?.invoke('mouse-kb:stats:start')
    setStatsRunning(ok === true)
    void loadStats()
  }
  const stopStats = async () => {
    await api?.invoke('mouse-kb:stats:stop')
    setStatsRunning(false)
  }
  const resetStats = async () => {
    await api?.invoke('mouse-kb:stats:reset')
    void loadStats()
  }
  const addRule = async () => {
    const r = (await api?.invoke('mouse-kb:remap:add', fromKey, toKey)) as { ok: boolean; error?: string }
    if (r?.ok) {
      setMsg({ type: 'ok', text: t('mousekb.remap_add') })
      void loadRules()
    } else {
      const key = r?.error
      setMsg({
        type: 'err',
        text:
          key === 'duplicate-from'
            ? t('mousekb.remap_dup')
            : key === 'invalid-key'
              ? t('mousekb.remap_invalid')
              : String(r?.error || 'error'),
      })
    }
  }
  const delRule = async (id: string) => {
    await api?.invoke('mouse-kb:remap:delete', id)
    void loadRules()
  }
  const applyRules = async () => {
    const r = (await api?.invoke('mouse-kb:remap:apply')) as { ok: boolean; message?: string; error?: string }
    if (r?.ok) setMsg({ type: 'ok', text: t('mousekb.remap_need_restart') })
    else setMsg({ type: 'err', text: String(r?.error || 'error') })
  }

  const topKeys = useMemo(() => {
    if (!stats) return []
    return Object.entries(stats.keysByCode)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }))
  }, [stats])

  const activeHours = useMemo(() => {
    if (!stats) return []
    return stats.activeByHour.map((count, hour) => ({ hour: `${hour}`, count }))
  }, [stats])

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'devices', label: t('mousekb.tab_devices'), icon: MousePointer2 },
    { key: 'stats', label: t('mousekb.tab_stats'), icon: BarChart3 },
    { key: 'remap', label: t('mousekb.tab_remap'), icon: Keyboard },
  ]

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MousePointer2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('mousekb.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('mousekb.subtitle')}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              if (tab === 'devices') void loadInfo()
              if (tab === 'stats') void loadStats()
              if (tab === 'remap') void loadRules()
            }}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('mousekb.refresh')}
          </Button>
        </div>
      </section>

      {/* Tab 分段控制 */}
      <div className="flex gap-1 rounded-xl border border-white/5 bg-white/[0.02] p-1">
        {tabs.map((tb) => {
          const Icon = tb.icon
          const active = tab === tb.key
          return (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all',
                active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:text-foreground/80',
              )}
            >
              <Icon className="h-4 w-4" />
              {tb.label}
            </button>
          )
        })}
      </div>

      {msg && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
            msg.type === 'ok'
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
        >
          {msg.type === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {msg.text}
        </div>
      )}

      {/* ── 设备 Tab ── */}
      {tab === 'devices' && (
        <div className="space-y-6">
          {loading && !info && (
            <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
              {t('mousekb.refreshing')}
            </div>
          )}
          {info && (
            <>
              {info.detectedAt > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  {t('mousekb.detected_at', {
                    time: new Date(info.detectedAt).toLocaleString('zh-CN', { hour12: false }),
                  })}
                </div>
              )}

              {/* 鼠标 */}
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <MousePointer2 className="h-4 w-4 text-primary" />
                  {t('mousekb.section_mice')}
                  <span className="text-[11px] font-normal text-muted-foreground">({info.mice.length})</span>
                </h3>
                {info.mice.length === 0 ? (
                  <div className="glass rounded-2xl p-6 text-center text-xs text-muted-foreground">
                    {t('mousekb.empty_none')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {info.mice.map((m, i) => (
                      <DeviceCard
                        key={m.deviceId || i}
                        name={m.name}
                        manufacturer={m.manufacturer}
                        interfaceType={m.interfaceType}
                        status={m.status}
                        batteryPercent={m.batteryPercent}
                        pnpId={m.pnpId}
                        extra={m.description}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* 键盘 */}
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <Keyboard className="h-4 w-4 text-primary" />
                  {t('mousekb.section_keyboards')}
                  <span className="text-[11px] font-normal text-muted-foreground">({info.keyboards.length})</span>
                </h3>
                {info.keyboards.length === 0 ? (
                  <div className="glass rounded-2xl p-6 text-center text-xs text-muted-foreground">
                    {t('mousekb.empty_none')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {info.keyboards.map((k, i) => (
                      <DeviceCard
                        key={k.deviceId || i}
                        name={k.name}
                        manufacturer={k.manufacturer}
                        interfaceType={k.interfaceType}
                        status={k.status}
                        batteryPercent={k.batteryPercent}
                        pnpId={k.pnpId}
                        extra={k.layout ? `${t('mousekb.col_layout')}: ${k.layout}` : k.description}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* ── 使用统计 Tab ── */}
      {tab === 'stats' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                statsRunning
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-muted-foreground',
              )}
            >
              <Activity className="h-3 w-3" />
              {statsRunning ? t('mousekb.stats_enabled') : t('mousekb.stats_disabled')}
            </span>
            {!statsRunning ? (
              <Button size="sm" variant="outline" onClick={() => void startStats()}>
                {t('mousekb.stats_enable')}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void stopStats()}>
                {t('mousekb.stats_disable')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void resetStats()}>
              {t('mousekb.stats_session')}
            </Button>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-300/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('mousekb.stats_hint')}
          </div>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="glass rounded-2xl border border-white/5 p-4">
              <div className="text-[11px] text-muted-foreground">{t('mousekb.stats_total_keys')}</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">
                {stats ? stats.totalKeys.toLocaleString() : 0}
              </div>
            </div>
            <div className="glass rounded-2xl border border-white/5 p-4">
              <div className="text-[11px] text-muted-foreground">{t('mousekb.stats_total_clicks')}</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">
                {stats ? stats.totalClicks.toLocaleString() : 0}
              </div>
            </div>
          </section>

          <section className="glass rounded-2xl border border-white/5 p-5">
            <div className="mb-3 text-sm font-semibold tracking-tight">{t('mousekb.stats_top_keys')}</div>
            <div className="h-56">
              {topKeys.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t('mousekb.empty_none')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topKeys} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#818cf8"  isAnimationActive={false}/>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="glass rounded-2xl border border-white/5 p-5">
            <div className="mb-3 text-sm font-semibold tracking-tight">{t('mousekb.stats_active')}</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeHours} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#94a3b8' }} interval={1} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#34d399"  isAnimationActive={false}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}

      {/* ── 重映射 Tab ── */}
      {tab === 'remap' && (
        <div className="space-y-6">
          <section className="glass rounded-2xl border border-white/5 p-5">
            <div className="mb-1 text-sm font-semibold tracking-tight">{t('mousekb.remap_title')}</div>
            <p className="mb-4 text-xs text-muted-foreground">{t('mousekb.remap_desc')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                {t('mousekb.remap_from_select')}
                <select
                  value={fromKey}
                  onChange={(e) => setFromKey(e.target.value)}
                  className="rounded-lg border border-white/10 bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                >
                  {KEY_OPTIONS.map((k) => (
                    <option key={`f-${k}`} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <span className="pb-2 text-muted-foreground">→</span>
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                {t('mousekb.remap_to_select')}
                <select
                  value={toKey}
                  onChange={(e) => setToKey(e.target.value)}
                  className="rounded-lg border border-white/10 bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                >
                  {KEY_OPTIONS.map((k) => (
                    <option key={`t-${k}`} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" onClick={() => void addRule()}>
                <Plus className="h-3.5 w-3.5" />
                {t('mousekb.remap_add')}
              </Button>
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => void applyRules()}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('mousekb.remap_apply')}
              </Button>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold tracking-tight">
              {t('mousekb.remap_title')} ({rules.length})
            </h3>
            {rules.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center text-xs text-muted-foreground">
                {t('mousekb.remap_empty')}
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3"
                  >
                    <div className="flex items-center gap-3 text-sm">
                      <span className="rounded-md bg-primary/10 px-2 py-1 font-mono text-xs text-primary">
                        {r.fromLabel}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="rounded-md bg-emerald-400/10 px-2 py-1 font-mono text-xs text-emerald-300">
                        {r.toLabel}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void delRule(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('mousekb.remap_delete')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function DeviceCard({
  name,
  manufacturer,
  interfaceType,
  status,
  batteryPercent,
  pnpId,
  extra,
  t,
}: {
  name: string
  manufacturer: string
  interfaceType: InputInterface
  status: string
  batteryPercent: number | null
  pnpId: string
  extra: string
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const IfIcon = interfaceIcon(interfaceType)
  const ok = status === 'OK'
  return (
    <div className="glass rounded-2xl border border-white/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IfIcon className="h-3.5 w-3.5" />
        </div>
        <span className="truncate text-sm font-medium text-foreground" title={name}>
          {name}
        </span>
        <span
          className={cn(
            'ml-auto inline-flex shrink-0 items-center gap-1 text-[11px]',
            ok ? 'text-emerald-400' : 'text-muted-foreground',
          )}
        >
          {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {ok ? t('mousekb.col_status') && status : status}
        </span>
      </div>
      <div className="space-y-1 text-[11px]">
        <Row label={t('mousekb.col_manufacturer')} value={manufacturer || '—'} />
        <Row
          label={t('mousekb.col_interface')}
          value={
            interfaceType === 'USB'
              ? t('mousekb.interface_usb')
              : interfaceType === '蓝牙'
                ? t('mousekb.interface_bt')
                : interfaceType === 'HID'
                  ? t('mousekb.interface_hid')
                  : interfaceType === '内置'
                    ? t('mousekb.interface_internal')
                    : t('mousekb.interface_other')
          }
        />
        <Row
          label={t('mousekb.col_battery')}
          value={
            batteryPercent !== null ? (
              <span className="inline-flex items-center gap-1">
                <Battery className="h-3 w-3" />
                {batteryPercent}%
              </span>
            ) : (
              t('mousekb.battery_na')
            )
          }
        />
        {extra && <Row label="" value={extra} />}
        <Row label={t('mousekb.col_pnpid')} value={pnpId || '—'} />
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1 last:border-0">
      {label && <span className="text-[11px] text-muted-foreground">{label}</span>}
      <span className="truncate text-right text-[11px] font-medium text-foreground">{value || '—'}</span>
    </div>
  )
}
