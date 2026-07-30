import { useEffect, useMemo, useState } from 'react'
import {
  Container,
  RefreshCw,
  Folder,
  FolderOpen,
  File as FileIcon,
  ArrowUp,
  Copy,
  ExternalLink,
  Play,
  Square,
  Star,
  Download,
  Upload,
  Loader2,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

// 与主进程 wslManager.ts 对应的本地类型
interface WslDistro {
  name: string
  state: string
  version: string
  isDefault: boolean
}

interface WslEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number
  mtime: number
  perms: string
}

function formatBytes(n: number): string {
  if (!n || n < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function formatTime(ms: number): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

// 构造 Windows 可访问的 UNC 路径（用于复制 / 打开）
function toUnc(distName: string, linuxPath: string): string {
  const safe = (linuxPath || '/').replace(/\\/g, '/')
  const rel = safe === '/' ? '' : safe
  return `\\\\wsl$\\${distName}${rel}`
}

export default function WslManager() {
  const api = window.electronAPI
  const { t } = useI18n()

  const [distros, setDistros] = useState<WslDistro[]>([])
  const [loadingDistros, setLoadingDistros] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState<string>('/')
  const [entries, setEntries] = useState<WslEntry[]>([])
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [busyName, setBusyName] = useState<string | null>(null) // 正在导出 / 启动 / 终止的发行版
  const [importing, setImporting] = useState(false)

  async function loadDistros() {
    if (!api) return
    setLoadingDistros(true)
    try {
      const list = (await api.invoke('wsl:list')) as WslDistro[]
      setDistros(list || [])
      // 若当前选中的发行版已不存在，则清空选择
      if (selected && !(list || []).some((d) => d.name === selected)) {
        setSelected(null)
        setEntries([])
        setCurrentPath('/')
      } else if (!selected && (list || []).length > 0) {
        // 自动选中第一个运行中的，否则第一个
        const running = (list || []).find((d) => /running/i.test(d.state))
        const pick = running || (list || [])[0]
        if (pick) setSelected(pick.name)
      }
    } catch {
      setMessage({ type: 'error', text: t('wsl.read_failed', { error: 'ipc' }) })
    } finally {
      setLoadingDistros(false)
    }
  }

  async function loadEntries() {
    if (!api || !selected) return
    setLoadingEntries(true)
    setMessage(null)
    try {
      const res = (await api.invoke('wsl:readdir', selected, currentPath)) as {
        ok: boolean
        entries?: WslEntry[]
        error?: string
      }
      if (res.ok) setEntries(res.entries || [])
      else setMessage({ type: 'error', text: t('wsl.read_failed', { error: res.error || '' }) })
    } catch (e) {
      setMessage({ type: 'error', text: t('wsl.read_failed', { error: String(e) }) })
    } finally {
      setLoadingEntries(false)
    }
  }

  // 选中发行版或路径变化时加载目录
  useEffect(() => {
    if (selected) void loadEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, currentPath])

  useEffect(() => {
    void loadDistros()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedDistro = useMemo(
    () => distros.find((d) => d.name === selected) || null,
    [distros, selected],
  )

  const segments = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean)
    const acc: { name: string; path: string }[] = [{ name: t('wsl.root'), path: '/' }]
    let p = ''
    for (const part of parts) {
      p += '/' + part
      acc.push({ name: part, path: p })
    }
    return acc
  }, [currentPath, t])

  async function navigateTo(path: string) {
    setCurrentPath(path)
  }

  async function handleOpenEntry(entry: WslEntry) {
    if (entry.isDir && !entry.isSymlink) {
      navigateTo(entry.path)
    } else {
      // 文件或符号链接：在资源管理器中打开其父目录
      await handleOpenInExplorer(entry.isDir ? entry.path : entry.path.replace(/\/[^/]*$/, '') || '/')
    }
  }

  async function handleOpenInExplorer(linuxPath: string) {
    if (!api || !selected) return
    const res = (await api.invoke('wsl:open', selected, linuxPath)) as { ok: boolean; error?: string }
    if (!res.ok) setMessage({ type: 'error', text: t('wsl.open_failed') })
  }

  async function handleCopyPath(entry: WslEntry) {
    const unc = toUnc(selected!, entry.path)
    try {
      await navigator.clipboard.writeText(unc)
      setMessage({ type: 'success', text: t('wsl.copy_success') })
    } catch {
      setMessage({ type: 'error', text: t('wsl.copy_failed') })
    }
  }

  async function handleStart(d: WslDistro) {
    if (!api) return
    setBusyName(d.name)
    setMessage(null)
    try {
      const res = (await api.invoke('wsl:start', d.name)) as { ok: boolean; error?: string }
      if (res.ok) {
        await loadDistros()
        setMessage({ type: 'success', text: t('wsl.start_success', { name: d.name }) })
      } else {
        setMessage({ type: 'error', text: t('wsl.action_failed', { action: t('wsl.start'), error: res.error || '' }) })
      }
    } finally {
      setBusyName(null)
    }
  }

  async function handleTerminate(d: WslDistro) {
    if (!api) return
    setBusyName(d.name)
    setMessage(null)
    try {
      const res = (await api.invoke('wsl:terminate', d.name)) as { ok: boolean; error?: string }
      if (res.ok) {
        await loadDistros()
        setMessage({ type: 'success', text: t('wsl.terminate_success', { name: d.name }) })
      } else {
        setMessage({ type: 'error', text: t('wsl.action_failed', { action: t('wsl.terminate'), error: res.error || '' }) })
      }
    } finally {
      setBusyName(null)
    }
  }

  async function handleSetDefault(d: WslDistro) {
    if (!api) return
    setMessage(null)
    try {
      const res = (await api.invoke('wsl:set-default', d.name)) as { ok: boolean; error?: string }
      if (res.ok) {
        await loadDistros()
        setMessage({ type: 'success', text: t('wsl.set_default_success', { name: d.name }) })
      } else {
        setMessage({ type: 'error', text: t('wsl.action_failed', { action: t('wsl.set_default'), error: res.error || '' }) })
      }
    } catch {
      /* noop */
    }
  }

  async function handleExport(d: WslDistro) {
    if (!api) return
    setBusyName(d.name)
    setMessage(null)
    try {
      const res = (await api.invoke('wsl:export', d.name)) as { ok: boolean; canceled?: boolean; filePath?: string; error?: string }
      if (res.canceled) return
      if (res.ok) setMessage({ type: 'success', text: t('wsl.export_success', { path: res.filePath || '' }) })
      else setMessage({ type: 'error', text: t('wsl.export_failed', { error: res.error || '' }) })
    } finally {
      setBusyName(null)
    }
  }

  async function handleImport() {
    if (!api) return
    setImporting(true)
    setMessage(null)
    try {
      const res = (await api.invoke('wsl:import')) as { ok: boolean; canceled?: boolean; name?: string; error?: string }
      if (res.canceled) return
      if (res.ok) {
        await loadDistros()
        setMessage({ type: 'success', text: t('wsl.import_success', { name: res.name || '' }) })
      } else {
        setMessage({ type: 'error', text: t('wsl.import_failed', { error: res.error || '' }) })
      }
    } finally {
      setImporting(false)
    }
  }

  const hasWsl = distros.length > 0

  return (
    <div className="space-y-6">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Container className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('wsl.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('wsl.subtitle')}</p>
          </div>
        </div>
      </section>

      {/* ── 工具栏 ── */}
      <section className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void loadDistros()} disabled={loadingDistros}>
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loadingDistros && 'animate-spin')} />
          {t('wsl.refresh')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handleImport()} disabled={importing}>
          {importing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
          {t('wsl.import')}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {hasWsl ? t('wsl.distros_count', { count: distros.length }) : ''}
        </span>
      </section>

      {message && (
        <p
          className={cn(
            'flex items-center gap-1 text-xs',
            message.type === 'error' ? 'text-destructive' : 'text-emerald-400',
          )}
        >
          {message.type === 'error' ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
          {message.text}
        </p>
      )}

      {/* ── 未安装 / 无发行版提示 ── */}
      {!loadingDistros && !hasWsl && (
        <section className="glass flex flex-col items-center gap-3 rounded-2xl border border-white/5 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
            <AlertTriangle className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">{t('wsl.not_installed_title')}</p>
          <p className="max-w-md text-xs text-muted-foreground">{t('wsl.not_installed')}</p>
        </section>
      )}

      {/* ── 发行版卡片 ── */}
      {hasWsl && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {distros.map((d) => {
            const running = /running/i.test(d.state)
            const active = selected === d.name
            return (
              <div
                key={d.name}
                onClick={() => setSelected(d.name)}
                className={cn(
                  'flex cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition-colors',
                  active ? 'border-primary/40 bg-primary/[0.06]' : 'border-white/5 bg-white/[0.02] hover:border-white/10',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        running ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-muted-foreground',
                      )}
                    >
                      <HardDrive className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        {d.name}
                        {d.isDefault && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {t('wsl.version')} {d.version}
                      </div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      running ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/10 text-muted-foreground',
                    )}
                  >
                    {running ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {running ? t('wsl.running') : t('wsl.stopped')}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {running ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyName === d.name}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleTerminate(d)
                      }}
                    >
                      {busyName === d.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                      {t('wsl.terminate')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busyName === d.name}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleStart(d)
                      }}
                    >
                      {busyName === d.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      {t('wsl.start')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={d.isDefault}
                    title={t('wsl.set_default')}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleSetDefault(d)
                    }}
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    title={t('wsl.open_explorer')}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleOpenInExplorer('/')
                    }}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyName === d.name}
                    title={t('wsl.export')}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleExport(d)
                    }}
                  >
                    {busyName === d.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* ── 文件浏览器 ── */}
      {selectedDistro && (
        <section className="glass rounded-2xl border border-white/5 p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FolderOpen className="h-4 w-4 text-primary" />
              {t('wsl.browse')}
              <span className="font-mono text-xs text-muted-foreground">{selectedDistro.name}</span>
            </div>
            <span className="text-xs text-muted-foreground">{t('wsl.files_count', { count: entries.length })}</span>
          </div>

          {/* 面包屑 */}
          <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              disabled={currentPath === '/'}
              onClick={() => navigateTo('/')}
            >
              <ArrowUp className="h-3.5 w-3.5" />
              {t('wsl.up')}
            </Button>
            {segments.map((seg, i) => (
              <span key={seg.path} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground/50">/</span>}
                <button
                  onClick={() => navigateTo(seg.path)}
                  className={cn(
                    'rounded px-1.5 py-0.5 transition-colors',
                    i === segments.length - 1
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                  )}
                >
                  {seg.name}
                </button>
              </span>
            ))}
          </div>

          {/* 文件列表 */}
          <div className="overflow-hidden rounded-xl border border-white/5">
            {loadingEntries ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('wsl.scanning')}
              </div>
            ) : entries.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{t('wsl.empty_dir')}</div>
            ) : (
              <div className="max-h-[420px] divide-y divide-white/5 overflow-y-auto">
                {entries.map((entry) => {
                  const Icon = entry.isDir ? Folder : FileIcon
                  return (
                    <div
                      key={entry.path}
                      className="group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-white/[0.03]"
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          entry.isDir ? 'text-primary' : 'text-muted-foreground/70',
                        )}
                      />
                      <button
                        onClick={() => void handleOpenEntry(entry)}
                        className="min-w-0 flex-1 truncate text-left text-sm hover:text-primary"
                        title={entry.name}
                      >
                        {entry.name}
                        {entry.isSymlink && <span className="ml-1 text-[10px] text-info">↳</span>}
                      </button>
                      <span className="hidden w-24 shrink-0 truncate text-right text-[11px] text-muted-foreground sm:block">
                        {entry.isDir ? '—' : formatBytes(entry.size)}
                      </span>
                      <span className="hidden w-40 shrink-0 truncate text-right text-[11px] text-muted-foreground md:block">
                        {formatTime(entry.mtime)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title={t('wsl.open')}
                          onClick={() => void handleOpenEntry(entry)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title={t('wsl.copy_path')}
                          onClick={() => void handleCopyPath(entry)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
