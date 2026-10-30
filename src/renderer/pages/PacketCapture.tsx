import { useEffect, useMemo, useRef, useState } from 'react'
import { FixedSizeList as List, ListChildComponentProps } from 'react-window'
import {
  Network,
  Play,
  Square,
  ShieldCheck,
  Smartphone,
  Lock,
  Download,
  Search,
  Trash2,
  FileDown,
  X,
  Radio,
  Wifi,
  AlertTriangle,
  CheckCircle2,
  Filter,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

type Category =
  | 'image' | 'video' | 'audio' | 'script' | 'style' | 'font'
  | 'document' | 'api' | 'archive' | 'other'

interface CapSession {
  id: number
  ts: number
  method: string
  scheme: 'http' | 'https' | 'tunnel'
  host: string
  path: string
  url: string
  status: number
  reqSize: number
  resSize: number
  durationMs: number
  category: Category
  contentType: string
  isDownload: boolean
  downloadName: string
  processName: string
  lockTarget: string
  error: string
  reqBody: string | null
  resBody: string | null
}

interface CapStatus {
  running: boolean
  port: number
  mode: 'http' | 'adb'
  lockEnabled: boolean
  lockName: string
  lockPid: number
  systemProxy: boolean
  adbDevice: string
  adbPackage: string
  adbRooted: boolean
  savedProxy: { enable: number; server: string; override: string } | null
  total: number
  downloads: number
}

interface AdbDevice {
  serial: string
  status: string
  model: string
}

interface ProcessInfo {
  id: number
  name: string
}

const CATEGORIES: Category[] = [
  'image', 'video', 'audio', 'script', 'style', 'font', 'document', 'api', 'archive', 'other',
]

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'CONNECT']

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const CAT_COLOR: Record<Category, string> = {
  image: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  video: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20',
  audio: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  script: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  style: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  font: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  document: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  api: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  archive: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  other: 'text-muted-foreground bg-white/[0.04] border-white/10',
}

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-blue-400',
  PUT: 'text-amber-400',
  DELETE: 'text-red-400',
  HEAD: 'text-slate-400',
  OPTIONS: 'text-purple-400',
  PATCH: 'text-cyan-400',
  CONNECT: 'text-pink-400',
}

const STATUS_COLOR = (s: number) =>
  s === 0 ? 'text-red-400' : s >= 200 && s < 300 ? 'text-emerald-400' : s >= 300 && s < 400 ? 'text-sky-400' : s < 500 ? 'text-amber-400' : 'text-red-400'

export default function PacketCapture() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [status, setStatus] = useState<CapStatus | null>(null)
  const [sessions, setSessions] = useState<CapSession[]>([])
  const sessionsRef = useRef<Map<number, CapSession>>(new Map())
  const rafRef = useRef<number | null>(null)
  // 高频抓包事件合并为每帧一次 setState，避免每包全量重建 3000 行导致主线程卡死
  const scheduleRender = () => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const map = sessionsRef.current
      if (map.size > 5000) {
        const it = map.keys()
        const drop = map.size - 5000
        for (let i = 0; i < drop; i++) map.delete(it.next().value as number)
      }
      setSessions(Array.from(map.values()).reverse().slice(0, 3000))
    })
  }
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<Category | 'all'>('all')
  const [methodFilter, setMethodFilter] = useState<string>('all')
  const [tab, setTab] = useState<'sessions' | 'downloads'>('sessions')
  const [selected, setSelected] = useState<CapSession | null>(null)
  const [devices, setDevices] = useState<AdbDevice[]>([])
  const [device, setDevice] = useState('')
  const [pkg, setPkg] = useState('')
  const [packages, setPackages] = useState<string[]>([])
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [lockPid, setLockPid] = useState<number>(0)
  const [lockName, setLockName] = useState('')
  const [port, setPort] = useState(8888)
  const [message, setMessage] = useState<{ type: 'info' | 'error' | 'ok'; text: string } | null>(null)
  const [caPath, setCaPath] = useState('')

  const flash = (type: 'info' | 'error' | 'ok', text: string) => {
    setMessage({ type, text })
    window.setTimeout(() => setMessage(null), 4000)
  }

  // 列表 IPC 不携带正文（避免全量克隆大 payload），选中行再按需补取一次
  const selectSession = (s: CapSession) => {
    setSelected(s)
    if (s.reqBody == null && s.resBody == null && (s.reqSize > 0 || s.resSize > 0)) {
      void api?.invoke('packet-capture:body', s.id).then((b) => {
        const body = b as { id: number; reqBody: string | null; resBody: string | null } | null
        if (!body || body.id !== s.id) return
        sessionsRef.current.set(s.id, { ...s, reqBody: body.reqBody, resBody: body.resBody })
        setSessions((prev) =>
          prev.map((x) => (x.id === s.id ? { ...x, reqBody: body.reqBody, resBody: body.resBody } : x)),
        )
        setSelected((cur) =>
          cur && cur.id === s.id ? { ...cur, reqBody: body.reqBody, resBody: body.resBody } : cur,
        )
      })
    }
  }

  const GRID = 'grid grid-cols-[88px_52px_48px_44px_minmax(0,1fr)_minmax(0,1.5fr)_60px_76px_minmax(0,0.9fr)_72px] items-center'
  const Row = ({ index, style, data }: ListChildComponentProps<CapSession[]>) => {
    const s = data[index]
    if (!s) return null
    const isSel = selected?.id === s.id
    return (
      <div style={style} onClick={() => selectSession(s)}
        className={cn(GRID, 'cursor-pointer border-t border-white/5 hover:bg-white/[0.03]', isSel && 'bg-primary/10')}>
        <div className="px-3 text-muted-foreground">{formatTime(s.ts)}</div>
        <div className={cn('px-2 font-semibold', METHOD_COLOR[s.method] || 'text-foreground')}>{s.method}</div>
        <div className="px-2 uppercase text-muted-foreground">{s.scheme}</div>
        <div className={cn('px-2 font-semibold', STATUS_COLOR(s.status))}>{s.status === 0 ? 'ERR' : s.status}</div>
        <div className="max-w-[180px] truncate px-3 text-foreground" title={s.host}>{s.host}</div>
        <div className="max-w-[260px] truncate px-3 text-muted-foreground" title={s.path}>{s.path}</div>
        <div className="px-2 text-muted-foreground">{formatBytes(s.resSize)}</div>
        <div className="px-2"><span className={cn('rounded border px-1.5 py-0.5 text-[10px]', CAT_COLOR[s.category])}>{t(`pcap.cat_${s.category}`)}</span></div>
        <div className="max-w-[120px] truncate px-2 text-muted-foreground" title={s.processName}>{s.processName || '—'}</div>
        {tab === 'downloads' && (
          <div className="px-2"><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void saveDownload(s) }}><FileDown className="h-3.5 w-3.5" />{t('pcap.download_save')}</Button></div>
        )}
      </div>
    )
  }

  useEffect(() => {
    api?.invoke('packet-capture:status').then((s) => {
      if (s && typeof s === 'object') {
        const st = s as CapStatus
        setStatus(st)
        setPort(st.port)
        if (st.adbDevice) setDevice(st.adbDevice)
        if (st.adbPackage) setPkg(st.adbPackage)
      }
    })
    api?.invoke('packet-capture:list').then((l) => {
      const arr = (l as CapSession[]) || []
      arr.forEach((s) => sessionsRef.current.set(s.id, s))
      setSessions(Array.from(sessionsRef.current.values()).reverse())
    })
    api?.invoke('packet-capture:ca-path').then((p) => setCaPath(String(p || '')))
    api?.invoke('list-processes').then((p) => {
      const arr = (p as ProcessInfo[]) || []
      setProcesses(arr.filter((x) => x.name && x.name !== 'unknown').slice(0, 400))
    })

    const onEventStart = (s: unknown) => {
      const ev = s as CapSession
      sessionsRef.current.set(ev.id, ev)
      scheduleRender()
    }
    const onEvent = (s: unknown) => {
      const ev = s as CapSession
      sessionsRef.current.set(ev.id, ev)
      scheduleRender()
    }
    const onStatus = (st: unknown) => {
      if (st && typeof st === 'object') setStatus(st as CapStatus)
    }
    const onError = (e: unknown) => flash('error', `${t('pcap.toast_err')}：${String(e)}`)

    api?.on('packet-capture:event-start', onEventStart)
    api?.on('packet-capture:event', onEvent)
    api?.on('packet-capture:status', onStatus)
    api?.on('packet-capture:error', onError)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      api?.removeAllListeners('packet-capture:event-start')
      api?.removeAllListeners('packet-capture:event')
      api?.removeAllListeners('packet-capture:status')
      api?.removeAllListeners('packet-capture:error')
    }
  }, [])

  const start = async () => {
    const r = (await api?.invoke('packet-capture:start', port)) as { ok: boolean; error?: string }
    if (r?.ok) flash('ok', t('pcap.toast_started'))
    else flash('error', `${t('pcap.toast_err')}：${r?.error || ''}`)
  }
  const stop = async () => {
    await api?.invoke('packet-capture:stop')
    flash('ok', t('pcap.toast_stopped'))
  }
  const installCA = async () => {
    const r = (await api?.invoke('packet-capture:install-ca')) as { ok: boolean; message: string }
    flash(r?.ok ? 'ok' : 'error', r?.message || '')
  }
  const toggleProxy = async (enable: boolean) => {
    const r = (await api?.invoke('packet-capture:system-proxy', enable)) as { ok: boolean; message: string }
    flash(r?.ok ? (enable ? 'ok' : 'ok') : 'error', r?.message || '')
  }
  const setMode = (mode: 'http' | 'adb') => api?.invoke('packet-capture:set-mode', mode)
  const toggleLock = (enabled: boolean) => {
    api?.invoke('packet-capture:set-lock', enabled, lockPid, lockName)
    if (!enabled) flash('info', t('pcap.lock_off'))
  }
  const detect = async () => {
    const r = (await api?.invoke('packet-capture:adb-devices')) as AdbDevice[]
    setDevices(r || [])
    if (r && r.length) {
      setDevice((d) => d || r[0].serial)
      flash('ok', `${t('pcap.adb_devices')}：${r.length}`)
    } else flash('info', t('pcap.adb_none'))
  }
  const adbSetup = async () => {
    api?.invoke('packet-capture:set-adb-target', device, pkg)
    const r = (await api?.invoke('packet-capture:adb-setup')) as { ok: boolean; message: string }
    flash(r?.ok ? 'ok' : 'error', r?.message || '')
  }
  const adbTeardown = async () => {
    const r = (await api?.invoke('packet-capture:adb-teardown')) as { ok: boolean; message: string }
    flash(r?.ok ? 'ok' : 'error', r?.message || '')
  }
  const loadPackages = async () => {
    const r = (await api?.invoke('packet-capture:adb-packages')) as string[]
    setPackages(r || [])
    flash('info', `${r?.length || 0} ${t('pcap.adb_packages_load')}`)
  }
  const clearAll = async () => {
    await api?.invoke('packet-capture:clear')
    sessionsRef.current.clear()
    setSessions([])
  }
  const exportAs = async (fmt: 'json' | 'csv' | 'txt') => {
    const r = (await api?.invoke('packet-capture:export', fmt)) as { ok: boolean; filePath?: string; canceled?: boolean }
    if (r?.canceled) return
    flash(r?.ok ? 'ok' : 'error', r?.ok ? String(r.filePath) : t('pcap.toast_err'))
  }
  const saveDownload = async (s: CapSession) => {
    const r = (await api?.invoke('packet-capture:save-download', s.url, s.downloadName || 'download')) as {
      ok: boolean
      message: string
      canceled?: boolean
    }
    if (r?.canceled) return
    flash(r?.ok ? 'ok' : 'error', r?.message || '')
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sessions.filter((s) => {
      if (catFilter !== 'all' && s.category !== catFilter) return false
      if (methodFilter !== 'all' && s.method !== methodFilter) return false
      if (tab === 'downloads' && !s.isDownload) return false
      if (q) {
        const hay = `${s.url} ${s.host} ${s.path} ${s.processName} ${s.downloadName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [sessions, catFilter, methodFilter, search, tab])

  const downloads = useMemo(() => sessions.filter((s) => s.isDownload), [sessions])
  const totalBytes = useMemo(() => sessions.reduce((a, s) => a + s.reqSize + s.resSize, 0), [sessions])
  const running = status?.running ?? false
  const mode = status?.mode ?? 'http'

  const headerBtn = (active: boolean) => cn('glass rounded-xl px-4 py-2 text-sm font-medium transition border', active ? 'border-primary/30 text-foreground bg-primary/10' : 'border-white/5 text-muted-foreground hover:bg-white/[0.04]')

  return (
    <div className="space-y-6">
      {/* 标题 + 开始/停止 */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Network className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{t('pcap.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('pcap.subtitle')}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Input
              type="number"
              value={port}
              disabled={running}
              onChange={(e) => setPort(Number(e.target.value) || 8888)}
              className="w-28 pr-12"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">PORT</span>
          </div>
          {running ? (
            <Button variant="destructive" size="sm" onClick={() => void stop()}>
              <Square className="h-3.5 w-3.5" />
              {t('pcap.stop')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void start()}>
              <Play className="h-3.5 w-3.5" />
              {t('pcap.start')}
            </Button>
          )}
        </div>
      </section>

      {/* 状态条 */}
      <section className="flex flex-wrap items-center gap-3">
        <span className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', running ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-muted-foreground')}>
          <span className={cn('h-2 w-2 rounded-full', running ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-muted-foreground/50')} />
          {running ? t('pcap.running') : t('pcap.stopped')}
        </span>
        <div className="flex overflow-hidden rounded-xl border border-white/5">
          <button className={headerBtn(mode === 'http')} onClick={() => setMode('http')}>
            <Wifi className="mr-1.5 inline h-3.5 w-3.5" />
            {t('pcap.mode_http')}
          </button>
          <button className={headerBtn(mode === 'adb')} onClick={() => setMode('adb')}>
            <Smartphone className="mr-1.5 inline h-3.5 w-3.5" />
            {t('pcap.mode_adb')}
          </button>
        </div>
        {/* 统计 */}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-lg bg-white/5 px-2.5 py-1">{t('pcap.stat_total')} <b className="text-foreground">{sessions.length}</b></span>
          <span className="rounded-lg bg-white/5 px-2.5 py-1">{t('pcap.stat_downloads')} <b className="text-orange-400">{downloads.length}</b></span>
          <span className="rounded-lg bg-white/5 px-2.5 py-1">{t('pcap.stat_bytes')} <b className="text-foreground">{formatBytes(totalBytes)}</b></span>
        </div>
      </section>

      {/* 消息 */}
      {message && (
        <div className={cn('rounded-lg px-3 py-2 text-xs', message.type === 'error' ? 'bg-red-500/10 text-red-400' : message.type === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-sky-500/10 text-sky-400')}>
          <span className="flex items-center gap-1.5">
            {message.type === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {message.text}
          </span>
        </div>
      )}

      {/* 控制卡片 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 引擎 / CA / 系统代理 */}
        <div className="glass rounded-2xl border border-white/5 p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Radio className="h-3.5 w-3.5" /> {t('pcap.title')}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t('pcap.system_proxy')}</span>
              <Switch checked={status?.systemProxy ?? false} disabled={!running} onCheckedChange={(v) => void toggleProxy(v)} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => void installCA()}>
                <ShieldCheck className="h-3.5 w-3.5" />
                {t('pcap.install_ca')}
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground/80">{t('pcap.ca_hint')}</p>
            {caPath && (
              <p className="break-all rounded-lg bg-white/[0.03] px-2 py-1.5 text-[10px] text-muted-foreground/70">
                CA: {caPath}
              </p>
            )}
            {running && (
              <p className="rounded-lg bg-primary/5 px-2 py-1.5 text-[11px] text-primary/80">
                代理地址 127.0.0.1:{port} · 浏览器或系统代理指向它即可抓包
              </p>
            )}
          </div>
        </div>

        {/* 锁定应用 */}
        <div className="glass rounded-2xl border border-white/5 p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> {t('pcap.lock')}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t('pcap.lock')}</span>
              <Switch checked={status?.lockEnabled ?? false} disabled={!running} onCheckedChange={(v) => toggleLock(v)} />
            </div>
            <select
              value={lockPid ? String(lockPid) : ''}
              disabled={!running}
              onChange={(e) => {
                const id = Number(e.target.value)
                const p = processes.find((x) => x.id === id)
                setLockPid(id)
                setLockName(p?.name || '')
              }}
              className="w-full rounded-lg border border-white/10 bg-card px-2 py-1.5 text-xs text-foreground"
            >
              <option value="">{t('pcap.lock_placeholder')}</option>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (PID {p.id})</option>
              ))}
            </select>
            <p className="text-[11px] leading-relaxed text-muted-foreground/80">{t('pcap.lock_hint')}</p>
            {status?.lockEnabled && status.lockName && (
              <p className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-400">
                已锁定：{status.lockName}
              </p>
            )}
          </div>
        </div>

        {/* ADB */}
        <div className="glass rounded-2xl border border-white/5 p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Smartphone className="h-3.5 w-3.5" /> {t('pcap.mode_adb')}
          </h3>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => void detect()}>
                <Smartphone className="h-3.5 w-3.5" />
                {t('pcap.adb_detect')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void loadPackages()} disabled={!device}>
                {t('pcap.adb_packages_load')}
              </Button>
            </div>
            <select
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-card px-2 py-1.5 text-xs text-foreground"
            >
              <option value="">{devices.length ? t('pcap.adb_devices') : t('pcap.adb_none')}</option>
              {devices.map((d) => (
                <option key={d.serial} value={d.serial}>{d.model || d.serial} ({d.status})</option>
              ))}
            </select>
            <div className="flex gap-2">
              <Input
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
                placeholder={t('pcap.adb_package_ph')}
                className="flex-1"
              />
              {packages.length > 0 && (
                <select
                  value={pkg}
                  onChange={(e) => setPkg(e.target.value)}
                  className="rounded-lg border border-white/10 bg-card px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="">—</option>
                  {packages.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={!device || !running} onClick={() => void adbSetup()}>
                {t('pcap.adb_setup')}
              </Button>
              <Button size="sm" variant="outline" disabled={!device} onClick={() => void adbTeardown()}>
                {t('pcap.adb_stop')}
              </Button>
            </div>
            {status?.adbDevice && (
              <p className={cn('rounded-lg px-2 py-1.5 text-[11px]', status.adbRooted ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400')}>
                {status.adbRooted ? t('pcap.adb_rooted') : t('pcap.adb_not_rooted')}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 过滤 + Tabs */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pcap.filter_search')}
              className="pl-9"
            />
          </div>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-card px-2 py-2 text-xs text-foreground"
          >
            <option value="all">{t('pcap.filter_method')}: {t('pcap.filter_all')}</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => void clearAll()} disabled={!sessions.length}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('pcap.clear')}
          </Button>
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            <Button size="sm" variant="ghost" onClick={() => void exportAs('json')}>{t('pcap.export_json')}</Button>
            <Button size="sm" variant="ghost" onClick={() => void exportAs('csv')}>{t('pcap.export_csv')}</Button>
            <Button size="sm" variant="ghost" onClick={() => void exportAs('txt')}>{t('pcap.export_txt')}</Button>
          </div>
        </div>

        {/* 分类 chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground/50" />
          <button
            onClick={() => setCatFilter('all')}
            className={cn('rounded-full border px-2.5 py-1 text-[11px] transition', catFilter === 'all' ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-white/10 text-muted-foreground hover:bg-white/[0.04]')}
          >
            {t('pcap.filter_all')}
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={cn('rounded-full border px-2.5 py-1 text-[11px] transition', catFilter === c ? CAT_COLOR[c] : 'border-white/10 text-muted-foreground hover:bg-white/[0.04]')}
            >
              {t(`pcap.cat_${c}`)}
            </button>
          ))}
        </div>

        <div className="flex gap-1 border-b border-white/5">
          <button
            onClick={() => setTab('sessions')}
            className={cn('px-3 py-2 text-xs font-medium transition', tab === 'sessions' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            {t('pcap.title')} ({filtered.length})
          </button>
          <button
            onClick={() => setTab('downloads')}
            className={cn('px-3 py-2 text-xs font-medium transition', tab === 'downloads' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            <Download className="mr-1 inline h-3.5 w-3.5" />
            {t('pcap.downloads')} ({downloads.length})
          </button>
        </div>
      </section>

      {/* 列表 */}
      <section className="glass rounded-2xl border border-white/5 p-0 overflow-hidden">
        {(tab === 'downloads' ? downloads : filtered).length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">
            {tab === 'downloads' ? t('pcap.download_none') : running ? '—' : t('pcap.need_start')}
          </div>
        ) : (
          <>
            <div className={cn(GRID, 'border-b border-white/10 bg-card/95 py-2 text-left text-xs font-medium text-muted-foreground')}>
              <div className="px-3">{t('pcap.col_time')}</div>
              <div className="px-2">{t('pcap.col_method')}</div>
              <div className="px-2">{t('pcap.col_scheme')}</div>
              <div className="px-2">{t('pcap.col_status')}</div>
              <div className="px-3">{t('pcap.col_host')}</div>
              <div className="px-3">{t('pcap.col_path')}</div>
              <div className="px-2">{t('pcap.col_size')}</div>
              <div className="px-2">{t('pcap.col_cat')}</div>
              <div className="px-2">{t('pcap.col_proc')}</div>
              {tab === 'downloads' && <div className="px-2" />}
            </div>
            <List
              height={Math.min((tab === 'downloads' ? downloads : filtered).length * 34, 460)}
              itemCount={(tab === 'downloads' ? downloads : filtered).length}
              itemSize={34}
              width="100%"
              itemData={tab === 'downloads' ? downloads : filtered}
            >
              {Row}
            </List>
          </>
        )}
      </section>

      {/* 详情抽屉 */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setSelected(null)}>
          <div className="flex h-full w-full max-w-2xl flex-col bg-[hsl(var(--background))] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn('font-semibold', METHOD_COLOR[selected.method] || 'text-foreground')}>{selected.method}</span>
                  <span className="text-xs text-muted-foreground">{selected.scheme.toUpperCase()} {selected.status}</span>
                  <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', CAT_COLOR[selected.category])}>{t(`pcap.cat_${selected.category}`)}</span>
                </div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{selected.url}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                <X className="h-4 w-4" />
                {t('pcap.detail_close')}
              </Button>
            </div>
            <div className="flex-1 space-y-3 overflow-auto">
              <div>
                <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t('pcap.detail_request')}</div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-white/[0.03] p-2 text-[11px] text-foreground/90">{selected.reqBody ?? t('pcap.no_body')}</pre>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{t('pcap.detail_response')}</div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-white/[0.03] p-2 text-[11px] text-foreground/90">{selected.resBody ?? t('pcap.no_body')}</pre>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                <div>{t('pcap.col_size')}: {formatBytes(selected.resSize)}</div>
                <div>CT: {selected.contentType || '—'}</div>
                <div>{t('pcap.col_proc')}: {selected.processName || '—'}</div>
                <div>RT: {selected.durationMs} ms</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
