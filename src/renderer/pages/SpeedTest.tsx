import { useEffect, useRef, useState } from 'react'
import {
  Gauge,
  Play,
  RefreshCw,
  Wifi,
  ArrowDownToLine,
  ArrowUpFromLine,
  Timer,
  AlertTriangle,
  CheckCircle2,
  Server,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { SpeedServer, SpeedProgress, SpeedResult } from '@/lib/systemTypes'

type Phase = 'idle' | 'ping' | 'download' | 'upload' | 'done'

const DOWNLOAD_MS = 8000
const UPLOAD_MS = 6000

export default function SpeedTest() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [servers, setServers] = useState<SpeedServer[]>([])
  const [serverId, setServerId] = useState('cloudflare')
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [liveMbps, setLiveMbps] = useState(0)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [downloadMbps, setDownloadMbps] = useState<number | null>(null)
  const [uploadMbps, setUploadMbps] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<{ time: string; down: number; up: number; ping: number }[]>([])

  const runningRef = useRef(false)
  const currentRef = useRef({ ping: 0, down: 0, up: 0 })

  useEffect(() => {
    api?.invoke('speedtest:servers').then((r) => {
      if (Array.isArray(r)) {
        setServers(r as SpeedServer[])
        const list = r as SpeedServer[]
        if (list[0]) setServerId(list[0].id)
      }
    })
    const onProgress = (p: unknown) => {
      const d = p as SpeedProgress
      if (d.phase === 'download' || d.phase === 'upload') {
        setLiveMbps(d.mbps ?? 0)
        setProgress(d.progress ?? 0)
      }
    }
    api?.on('speedtest:progress', onProgress)
    return () => {
      api?.removeAllListeners('speedtest:progress')
    }
  }, [])

  const server = servers.find((s) => s.id === serverId) || servers[0]

  const runTest = async () => {
    if (running || !server) return
    runningRef.current = true
    setRunning(true)
    setError('')
    setProgress(0)
    setLiveMbps(0)

    currentRef.current = { ping: 0, down: 0, up: 0 }

    // 1) 延迟
    setPhase('ping')
    try {
      const pr = (await api?.invoke('speedtest:ping', server.ping)) as SpeedResult
      if (pr?.ok && typeof pr.ms === 'number') {
        setPingMs(pr.ms)
        currentRef.current.ping = pr.ms
      } else {
        setPingMs(null)
      }
    } catch {
      setPingMs(null)
    }

    // 2) 下载
    setPhase('download')
    setProgress(0)
    setLiveMbps(0)
    try {
      const dr = (await api?.invoke('speedtest:download', server.down, DOWNLOAD_MS)) as SpeedResult
      if (dr?.ok && typeof dr.mbps === 'number') {
        setDownloadMbps(dr.mbps)
        currentRef.current.down = dr.mbps
      } else {
        setError(dr?.error ? `${t('speed.error_download')}：${dr.error}` : t('speed.error_download'))
        setDownloadMbps(null)
      }
    } catch (e) {
      setError(`${t('speed.error_download')}：${String(e)}`)
      setDownloadMbps(null)
    }

    // 3) 上传
    if (server.up) {
      setPhase('upload')
      setProgress(0)
      setLiveMbps(0)
      try {
        const ur = (await api?.invoke('speedtest:upload', server.up, UPLOAD_MS)) as SpeedResult
        if (ur?.ok && typeof ur.mbps === 'number') {
          setUploadMbps(ur.mbps)
          currentRef.current.up = ur.mbps
        } else {
          setUploadMbps(null)
        }
      } catch (e) {
        setError(`${t('speed.error_upload')}：${String(e)}`)
        setUploadMbps(null)
      }
    }

    setPhase('done')
    setRunning(false)
    runningRef.current = false
    const { ping, down, up } = currentRef.current
    setHistory((h) => [
      {
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        down,
        up,
        ping,
      },
      ...h,
    ].slice(0, 8))
  }

  const phaseLabel: Record<Phase, string> = {
    idle: '',
    ping: t('speed.phase_ping'),
    download: t('speed.phase_download'),
    upload: t('speed.phase_upload'),
    done: t('speed.phase_done'),
  }

  const Metric = ({
    icon: Icon,
    label,
    value,
    unit,
    color,
    active,
  }: {
    icon: typeof Gauge
    label: string
    value: number | null
    unit: string
    color: string
    active: boolean
  }) => (
    <div className={cn('glass rounded-2xl border p-4 transition', active ? 'border-primary/30' : 'border-white/5')}>
      <div className="flex items-center gap-2.5">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', color)}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight">
          {value === null ? '—' : value.toFixed(value >= 100 ? 0 : 1)}
        </span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('speed.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('speed.subtitle')}</p>
          </div>
          <Button size="sm" className="ml-auto" onClick={() => void runTest()} disabled={running}>
            <Play className={cn('h-3.5 w-3.5', running && 'animate-pulse')} />
            {running ? t('speed.testing') : t('speed.start')}
          </Button>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Server className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            disabled={running}
            className="w-full rounded-lg border border-white/10 bg-card px-9 py-2 text-xs text-foreground"
          >
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={running}>
          <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} />
          {t('speed.restart')}
        </Button>
      </section>

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </span>
        </div>
      )}

      {/* 主测速区 */}
      <section className="glass rounded-2xl border border-white/5 p-5">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground">{phaseLabel[phase] || t('speed.ready')}</div>
            <div className="text-4xl font-bold tracking-tight">
              {phase === 'download' || phase === 'upload'
                ? liveMbps.toFixed(liveMbps >= 100 ? 0 : 1)
                : downloadMbps !== null
                  ? downloadMbps.toFixed(downloadMbps >= 100 ? 0 : 1)
                  : phase === 'done'
                    ? '—'
                    : '0.0'}
            </div>
            <div className="text-xs text-muted-foreground">Mbps · {phase === 'download' ? t('speed.phase_download') : phase === 'upload' ? t('speed.phase_upload') : t('speed.unit_tip')}</div>
          </div>
          {running && (
            <div className="text-right text-xs text-muted-foreground">
              <div>{t('speed.progress')} {Math.round(progress * 100)}%</div>
            </div>
          )}
        </div>
        {(phase === 'download' || phase === 'upload') && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className={cn('h-full rounded-full bg-gradient-to-r from-primary to-info transition-all', phase === 'upload' && 'from-info to-primary')}
              style={{ width: `${Math.max(4, progress * 100)}%` }}
            />
          </div>
        )}
      </section>

      {/* 指标卡 */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric icon={Timer} label={t('speed.col_ping')} value={pingMs} unit="ms" color="bg-amber-500/10 text-amber-400" active={phase === 'ping'} />
        <Metric icon={ArrowDownToLine} label={t('speed.col_down')} value={downloadMbps} unit="Mbps" color="bg-emerald-500/10 text-emerald-400" active={phase === 'download'} />
        <Metric icon={ArrowUpFromLine} label={t('speed.col_up')} value={uploadMbps} unit="Mbps" color="bg-primary/10 text-primary" active={phase === 'upload'} />
      </section>

      {phase === 'done' && !error && (
        <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('speed.done')}
          </span>
        </div>
      )}

      {history.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Wifi className="h-3.5 w-3.5" />
            {t('speed.history')}
          </h3>
          <div className="glass rounded-2xl border border-white/5 p-0 overflow-hidden">
            <div className="max-h-[240px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">{t('speed.col_time')}</th>
                    <th className="px-3 py-2 font-medium">{t('speed.col_ping')}</th>
                    <th className="px-3 py-2 font-medium">{t('speed.col_down')}</th>
                    <th className="px-3 py-2 font-medium">{t('speed.col_up')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-4 py-2 text-muted-foreground">{h.time}</td>
                      <td className="px-3 py-2 text-amber-400">{h.ping > 0 ? `${h.ping.toFixed(0)} ms` : '—'}</td>
                      <td className="px-3 py-2 text-emerald-400">{h.down > 0 ? `${h.down.toFixed(1)} Mbps` : '—'}</td>
                      <td className="px-3 py-2 text-primary">{h.up > 0 ? `${h.up.toFixed(1)} Mbps` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
