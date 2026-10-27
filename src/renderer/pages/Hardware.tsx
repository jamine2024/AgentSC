import { useEffect, useMemo, useState } from 'react'
import {
  Cpu,
  Monitor,
  MemoryStick,
  Network,
  Server,
  FileText,
  Thermometer,
  RefreshCw,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Camera,
  Mic,
  Tv,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { BrandLogo } from '@/components/BrandLogo'
import type { HardwareInfo, LiveMetric, HostsInfo } from '@/lib/systemTypes'

const tooltipStyle = {
  background: 'rgba(11,18,32,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 12,
  color: '#e2e8f0',
}

function tempColor(c: number): string {
  if (c >= 80) return '#f87171'
  if (c >= 60) return '#fbbf24'
  return '#34d399'
}

const TEMP_SOURCE_META: Record<string, { label: string; color: string }> = {
  thermal: { label: '系统/主板', color: '#f59e0b' },
  disk: { label: '磁盘', color: '#60a5fa' },
  probe: { label: '温度探针', color: '#a78bfa' },
  gpu: { label: '显卡', color: '#34d399' },
}

function tempSourceColor(s: string): string {
  return TEMP_SOURCE_META[s]?.color ?? '#94a3b8'
}

function cleanSensorName(name: string, source: string): string {
  const s = (name || '').trim()
  if (source === 'thermal') {
    const m = s.match(/ThermalZone[\\/]([^\\/]+)/i) || s.match(/[\\/]([^\\/]+)$/)
    const last = m ? m[1] : s
    return `热区 ${last}`
  }
  return s
}

function fmtDate(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

function DetailCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl border border-white/5 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium text-foreground">{value || '—'}</span>
    </div>
  )
}

export default function Hardware() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [hosts, setHosts] = useState<HostsInfo | null>(null)
  const [liveSeries, setLiveSeries] = useState<{ t: string; cpu: number; mem: number; temp: number }[]>([])
  const [live, setLive] = useState<LiveMetric | null>(null)
  const [cachedAt, setCachedAt] = useState<number | null>(null)
  const [dataSource, setDataSource] = useState<'cache' | 'live' | null>(null)

  // force=true 时重新探测并写库；否则先读数据库快照秒开，无缓存再回退真实探测。
  const loadHw = async (force = false) => {
    if (force) {
      setLoading(true)
      try {
        const snap = (await api?.invoke('refresh-hardware-snapshot')) as
          | { info: HardwareInfo; hosts: HostsInfo; updatedAt: number; error?: string }
          | undefined
        if (snap && !('error' in (snap as object))) {
          setHw(snap.info)
          setHosts(snap.hosts)
          setCachedAt(snap.updatedAt)
          setDataSource('live')
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false)
      }
      return
    }

    // 1) 优先读数据库缓存（秒开，不发 PowerShell）
    try {
      const cached = (await api?.invoke('get-hardware-snapshot')) as
        | { info: HardwareInfo; hosts: HostsInfo; updatedAt: number; error?: string }
        | undefined
      if (cached && !('error' in (cached as object)) && cached.info) {
        setHw(cached.info)
        setHosts(cached.hosts)
        setCachedAt(cached.updatedAt)
        setDataSource('cache')
        return
      }
    } catch {
      /* 读缓存失败，回退真实探测 */
    }

    // 2) 无缓存：真实探测并写库（首次打开）
    setLoading(true)
    try {
      const snap = (await api?.invoke('refresh-hardware-snapshot')) as
        | { info: HardwareInfo; hosts: HostsInfo; updatedAt: number; error?: string }
        | undefined
      if (snap && !('error' in (snap as object))) {
        setHw(snap.info)
        setHosts(snap.hosts)
        setCachedAt(snap.updatedAt)
        setDataSource('live')
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  const loadLive = async () => {
    try {
      const r = await api?.invoke('get-live-metrics')
      if (r && !('error' in (r as object))) {
        const m = r as LiveMetric
        setLive(m)
        const avgTemp = m.temps.length ? m.temps.reduce((s, x) => s + x.celsius, 0) / m.temps.length : 0
        const label = new Date().toLocaleTimeString('zh-CN', { hour12: false })
        setLiveSeries((prev) => {
          const next = [...prev, { t: label, cpu: m.cpu, mem: m.memPct, temp: avgTemp }]
          return next.slice(-60)
        })
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadHw()
    void loadLive()
    // 2s 一次实时指标，每次都落到主进程的 PowerShell（CPU/内存/温度 WMI）。
    // 页面不可见时必须停掉，否则最小化到托盘后仍在稳定烧 CPU。
    const liveTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void loadLive()
    }, 2000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadLive()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(liveTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const memDist = useMemo(
    () =>
      (hw?.memory || []).map((m, i) => ({
        name: m.deviceLocator || m.bankLabel || `Slot ${i + 1}`,
        capacity: m.capacity,
      })),
    [hw],
  )

  const overviewStats = useMemo(() => {
    if (!hw) return []
    return [
      { label: t('hardware.section_cpu'), value: hw.cpu[0]?.name || '—', icon: Cpu },
      { label: t('hardware.section_gpu'), value: hw.gpu[0]?.name || '—', icon: Monitor },
      {
        label: t('hardware.mem_total'),
        value: hw.memoryTotal > 0 ? formatBytes(hw.memoryTotal) : '—',
        icon: MemoryStick,
      },
      { label: t('hardware.sys_os'), value: hw.system.os.caption || '—', icon: Server },
    ]
  }, [hw, t])

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('hardware.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('hardware.subtitle')}</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void loadHw(true)} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('hardware.refresh')}
          </Button>
          {dataSource && cachedAt && (
            <div className="flex flex-col items-end gap-0.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
                  dataSource === 'cache'
                    ? 'border-sky-400/30 bg-sky-400/10 text-sky-300'
                    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
                )}
              >
                <CheckCircle2 className="h-3 w-3" />
                {dataSource === 'cache' ? t('hardware.from_cache') : t('hardware.from_live')}
              </span>
              <span className="text-[10px] text-muted-foreground" title={t('hardware.refresh_hint')}>
                {t('hardware.cached_at', { time: new Date(cachedAt).toLocaleString('zh-CN', { hour12: false }) })}
              </span>
            </div>
          )}
        </div>
      </section>

      {!hw && loading && (
        <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">{t('hardware.refreshing')}</div>
      )}

      {hw && (
        <>
          {/* 概览 */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {overviewStats.map((s) => {
              const Icon = s.icon
              return (
                <div key={s.label} className="glass rounded-2xl border border-white/5 p-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] text-muted-foreground">{s.label}</span>
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold tracking-tight" title={String(s.value)}>
                    {s.value}
                  </div>
                </div>
              )
            })}
          </section>

          {/* 实时监测 */}
          <section className="glass rounded-2xl border border-white/5 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">{t('hardware.live_title')}</h3>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">{t('hardware.cpu_chart')}</div>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={liveSeries} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                      <defs>
                        <linearGradient id="hCpu" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#64748b' }} interval={Math.floor(liveSeries.length / 5)} />
                      <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                      <Area type="monotone" dataKey="cpu" stroke="#f59e0b" strokeWidth={2} fill="url(#hCpu)"  isAnimationActive={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">{t('hardware.mem_chart')}</div>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={liveSeries} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                      <defs>
                        <linearGradient id="hMem" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#64748b' }} interval={Math.floor(liveSeries.length / 5)} />
                      <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                      <Area type="monotone" dataKey="mem" stroke="#60a5fa" strokeWidth={2} fill="url(#hMem)"  isAnimationActive={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">{t('hardware.temp_chart')}</div>
                <div className="h-36">
                  {live?.tempsSupported ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={liveSeries} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#64748b' }} interval={Math.floor(liveSeries.length / 5)} />
                        <YAxis unit="°" tick={{ fontSize: 9, fill: '#64748b' }} width={28} />
                        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} />
                        <Line type="monotone" dataKey="temp" stroke="#f87171" strokeWidth={2} dot={false}  isAnimationActive={false}/>
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-muted-foreground/70">
                      {t('hardware.temp_not_supported')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* CPU */}
          <DetailCard title={t('hardware.section_cpu')} icon={Cpu}>
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
              {hw.cpu.map((c, i) => (
                <div key={i} className="md:col-span-2">
                  <div className="mb-1 flex items-center gap-2">
                    <BrandLogo brand={c.manufacturer} kind="cpu" />
                    <span className="text-sm font-medium text-foreground">{c.name}</span>
                  </div>
                  <Row label={t('hardware.cpu_cores')} value={`${c.cores} / ${c.threads}`} />
                  <Row label={t('hardware.cpu_base')} value={c.maxClockSpeed ? `${(c.maxClockSpeed / 1000).toFixed(2)} GHz` : '—'} />
                  <Row label={t('hardware.cpu_socket')} value={c.socket} />
                  <Row
                    label={t('hardware.cpu_cache')}
                    value={`${c.l2Cache || 0} KB / ${c.l3Cache || 0} KB`}
                  />
                  <Row label={t('hardware.cpu_id')} value={c.processorId} />
                  <Row label={t('hardware.sys_manufacturer')} value={c.manufacturer} />
                </div>
              ))}
            </div>
          </DetailCard>

          {/* GPU */}
          <DetailCard title={t('hardware.section_gpu')} icon={Monitor}>
            <div className="space-y-3">
              {hw.gpu.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
              {hw.gpu.map((g, i) => (
                <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <BrandLogo brand={g.name} kind="gpu" />
                    <span className="text-sm font-medium text-foreground">{g.name}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
                    <Row label={t('hardware.gpu_vram')} value={g.vramText} />
                    <Row label={t('hardware.gpu_driver')} value={g.driverVersion} />
                    <Row label={t('hardware.gpu_driver_date')} value={g.driverDate} />
                    <Row label={t('hardware.gpu_res')} value={g.resolution} />
                    <Row label={t('hardware.gpu_proc')} value={g.videoProcessor} />
                    <Row label={t('hardware.col_status')} value={g.status} />
                  </div>
                </div>
              ))}
            </div>
          </DetailCard>

          {/* 摄像头 */}
          <DetailCard title={t('hardware.section_camera')} icon={Camera}>
            {hw.camera.length === 0 ? (
              <div className="text-xs text-muted-foreground">{t('hardware.empty_none')}</div>
            ) : (
              <div className="space-y-3">
                {hw.camera.map((c, i) => (
                  <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Camera className="h-3.5 w-3.5 text-primary" />
                        {c.name}
                      </span>
                      <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px]', c.status === 'OK' ? 'text-emerald-400' : 'text-muted-foreground')}>
                        {c.status === 'OK' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {c.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
                      <Row label={t('hardware.sys_manufacturer')} value={c.manufacturer} />
                      <Row label={t('hardware.camera_id')} value={c.pnpId} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DetailCard>

          {/* 音频设备 */}
          <DetailCard title={t('hardware.section_audio')} icon={Mic}>
            {hw.audio.length === 0 ? (
              <div className="text-xs text-muted-foreground">{t('hardware.empty_none')}</div>
            ) : (
              <div className="space-y-3">
                {hw.audio.map((a, i) => (
                  <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Mic className="h-3.5 w-3.5 text-primary" />
                        {a.name}
                      </span>
                      <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px]', a.status === 'OK' ? 'text-emerald-400' : 'text-muted-foreground')}>
                        {a.status === 'OK' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {a.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
                      <Row label={t('hardware.sys_manufacturer')} value={a.manufacturer} />
                      <Row label={t('hardware.audio_id')} value={a.deviceId} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DetailCard>

          {/* 显示器 */}
          <DetailCard title={t('hardware.section_display')} icon={Tv}>
            {hw.display.length === 0 ? (
              <div className="text-xs text-muted-foreground">{t('hardware.empty_none')}</div>
            ) : (
              <div className="space-y-3">
                {hw.display.map((d, i) => (
                  <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
                      <Tv className="h-3.5 w-3.5 text-primary" />
                      {d.deviceName || d.monitorName || `${t('hardware.section_display')} ${i + 1}`}
                    </div>
                    <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-3">
                      <Row label={t('hardware.display_res')} value={d.width && d.height ? `${d.width} × ${d.height}` : '—'} />
                      <Row label={t('hardware.display_refresh')} value={d.refreshRate ? `${d.refreshRate} Hz` : '—'} />
                      <Row label={t('hardware.display_colordepth')} value={d.colorDepth ? `${d.colorDepth} bit` : '—'} />
                      <Row label={t('hardware.display_monitor')} value={d.monitorName} />
                      <Row label={t('hardware.sys_manufacturer')} value={d.monitorManufacturer} />
                      <Row label={t('hardware.display_type')} value={d.monitorType} />
                      <Row label={t('hardware.col_status')} value={d.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DetailCard>

          {/* 内存 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DetailCard title={t('hardware.section_memory')} icon={MemoryStick}>
              <Row label={t('hardware.mem_total')} value={hw.memoryTotal > 0 ? formatBytes(hw.memoryTotal) : '—'} />
              <Row label={t('hardware.mem_modules')} value={hw.memory.length} />
              <div className="mt-3 space-y-2">
                {hw.memory.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
                {hw.memory.map((m, i) => (
                  <div key={i} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-medium">
                      <BrandLogo brand={m.manufacturer} kind="memory" size="sm" />
                      {m.manufacturer}
                    </span>
                      <span className="text-[11px] text-muted-foreground">{m.deviceLocator || m.bankLabel || `Slot ${i + 1}`}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{t('hardware.mem_capacity')}: {m.capacity > 0 ? formatBytes(m.capacity) : '—'}</span>
                      <span>{t('hardware.mem_speed')}: {m.speed ? `${m.speed} MHz` : '—'}</span>
                      <span className="col-span-2 truncate" title={m.partNumber}>{t('hardware.mem_partno')}: {m.partNumber || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </DetailCard>

            <DetailCard title={t('hardware.mem_dist')} icon={MemoryStick}>
              <div className="h-[260px]">
                {memDist.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={memDist} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(v) => formatBytes(v, 0)} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} width={80} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} formatter={(v: number) => formatBytes(v)} />
                      <Bar dataKey="capacity" radius={[0, 4, 4, 0]} fill="#818cf8"  isAnimationActive={false}/>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">—</div>
                )}
              </div>
            </DetailCard>
          </div>

          {/* 网络 */}
          <DetailCard title={t('hardware.section_network')} icon={Network}>
            <div className="space-y-3">
              {hw.network.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
              {hw.network.map((n, i) => (
                <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <BrandLogo brand={`${n.name} ${n.description}`} kind="network" size="sm" />
                      {n.name}
                    </span>
                    <span className={cn('inline-flex items-center gap-1 text-[11px]', n.status === 'Up' ? 'text-emerald-400' : 'text-muted-foreground')}>
                      {n.status === 'Up' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      {n.status === 'Up' ? t('hardware.net_up') : t('hardware.net_down')}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
                    <Row label={t('hardware.net_type')} value={n.description} />
                    <Row label={t('hardware.net_speed')} value={n.linkSpeed} />
                    <Row label={t('hardware.net_mac')} value={n.macAddress || '—'} />
                    <Row label={t('hardware.net_dns')} value={n.dnsServers.length ? n.dnsServers.join(', ') : '—'} />
                  </div>
                </div>
              ))}
            </div>
          </DetailCard>

          {/* 系统与主板 */}
          <DetailCard title={t('hardware.section_system')} icon={Server}>
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
              <Row label={t('hardware.sys_manufacturer')} value={<span className="flex items-center gap-2"><BrandLogo brand={hw.system.manufacturer} kind="system" size="sm" />{hw.system.manufacturer}</span>} />
              <Row label={t('hardware.sys_model')} value={hw.system.model} />
              <Row label={t('hardware.sys_type')} value={hw.system.systemType} />
              <Row label={t('hardware.sys_host')} value={hw.system.hostName} />
              <Row label={t('hardware.sys_user')} value={hw.system.userName} />
              <Row label={t('hardware.sys_os')} value={`${hw.system.os.caption} (${hw.system.os.arch})`} />
              <Row label={t('hardware.sys_install')} value={fmtDate(hw.system.os.installDate)} />
              <Row label={t('hardware.sys_lastboot')} value={fmtDate(hw.system.os.lastBoot)} />
              <Row label={t('hardware.sys_board')} value={`${hw.system.board.manufacturer} ${hw.system.board.product}`} />
              <Row label={t('hardware.sys_bios')} value={`${hw.system.bios.manufacturer} ${hw.system.bios.version}`} />
            </div>
          </DetailCard>

          {/* 温度 */}
          {hw.tempsSupported && (
            <DetailCard title={t('hardware.temp_title')} icon={Thermometer}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {Object.entries(TEMP_SOURCE_META)
                  .filter(([k]) => hw.temps.some((t) => t.source === k))
                  .map(([k, m]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px]"
                      style={{ color: m.color }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
                      {m.label}
                    </span>
                  ))}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {hw.temps.map((s, i) => (
                  <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tempSourceColor(s.source) }} />
                      <span className="truncate text-[10px] text-muted-foreground" title={s.name}>
                        {cleanSensorName(s.name, s.source)}
                      </span>
                    </div>
                    <div className="mt-1 text-xl font-semibold" style={{ color: tempColor(s.celsius) }}>
                      {s.celsius.toFixed(1)}
                      <span className="text-xs">{t('hardware.temp_celsius')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </DetailCard>
          )}

          {/* HOSTS 与 DNS */}
          <DetailCard title={t('hardware.section_hosts')} icon={FileText}>
            <Row label={t('hardware.hosts_path')} value={hosts?.path} />
            <Row label={t('hardware.hosts_entries')} value={hosts?.entries.length || 0} />
            <div className="mb-2 mt-3 flex items-center gap-1.5 text-[11px] text-amber-300/80">
              <AlertTriangle className="h-3 w-3" />
              {t('hardware.hosts_readonly')}
            </div>
            <div className="max-h-48 overflow-auto rounded-xl border border-white/5 bg-black/20">
              {hosts && hosts.entries.length > 0 ? (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card/95 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">IP</th>
                      <th className="px-3 py-1.5 text-left font-medium">{t('uninstall.col_name')}</th>
                      <th className="px-3 py-1.5 text-left font-medium">{t('uninstall.col_publisher')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hosts.entries.map((e, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-3 py-1.5 font-mono text-emerald-400">{e.ip}</td>
                        <td className="px-3 py-1.5 text-foreground">{e.host}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{e.comment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-4 text-center text-xs text-muted-foreground">{t('hardware.hosts_no_entries')}</div>
              )}
            </div>
          </DetailCard>
        </>
      )}
    </div>
  )
}
