import { useEffect, useMemo, useState } from 'react'
import {
  Database,
  FolderOpen,
  CalendarClock,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Power,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

// 与主进程 startupManager.ts 对应的本地类型
interface StartupItem {
  id: string
  name: string
  command: string
  location: string
  type: 'registry' | 'startupFolder' | 'scheduledTask'
  enabled: boolean
  scope: 'user' | 'machine'
}

const TYPE_META: Record<string, { labelKey: string; icon: LucideIcon }> = {
  registry: { labelKey: 'startup.type_registry', icon: Database },
  startupFolder: { labelKey: 'startup.type_folder', icon: FolderOpen },
  scheduledTask: { labelKey: 'startup.type_task', icon: CalendarClock },
}

export default function StartupManager() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [items, setItems] = useState<StartupItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)

  async function loadList(force = false) {
    if (!api) return
    setLoading(true)
    try {
      const res = (await api.invoke('startup:list', force)) as { supported: boolean; items: StartupItem[] }
      setSupported(res.supported !== false)
      setItems(res.items || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const types = useMemo(() => ['all', ...Array.from(new Set(items.map((x) => x.type)))], [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((x) => {
      if (typeFilter !== 'all' && x.type !== typeFilter) return false
      if (q) {
        const hay = `${x.name} ${x.command} ${x.location}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, search, typeFilter])

  const stats = useMemo(() => {
    const enabled = items.filter((x) => x.enabled).length
    return {
      total: items.length,
      enabled,
      disabled: items.length - enabled,
      registry: items.filter((x) => x.type === 'registry').length,
      folder: items.filter((x) => x.type === 'startupFolder').length,
      task: items.filter((x) => x.type === 'scheduledTask').length,
    }
  }, [items])

  async function handleToggle(item: StartupItem, next: boolean) {
    if (!api || busyId) return
    setBusyId(item.id)
    const prev = item.enabled
    // 乐观更新
    setItems((prevItems) => prevItems.map((i) => (i.id === item.id ? { ...i, enabled: next } : i)))
    setMessage('')
    try {
      const res = (await api.invoke('startup:set-enabled', item.id, next)) as {
        ok: boolean
        enabled?: boolean
        error?: string
      }
      if (!res.ok) {
        // 失败回滚
        setItems((prevItems) => prevItems.map((i) => (i.id === item.id ? { ...i, enabled: prev } : i)))
        setMessage('⚠ ' + (t('startup.toggle_failed') + (res.error ? '：' + res.error : '')))
      } else {
        setItems((prevItems) =>
          prevItems.map((i) => (i.id === item.id ? { ...i, enabled: res.enabled ?? next } : i)),
        )
      }
    } catch {
      setItems((prevItems) => prevItems.map((i) => (i.id === item.id ? { ...i, enabled: prev } : i)))
      setMessage('⚠ ' + t('startup.toggle_failed'))
    } finally {
      setBusyId(null)
    }
  }

  if (!supported) {
    return (
      <div className="space-y-6">
        <section className="glass rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Power className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">{t('startup.title')}</h2>
              <p className="text-xs text-muted-foreground">{t('startup.subtitle')}</p>
            </div>
          </div>
        </section>
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <XCircle className="h-4 w-4" />
          {t('startup.unsupported')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Power className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('startup.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('startup.subtitle')}</p>
          </div>
        </div>
      </section>

      {/* ── 统计 ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('startup.total')} value={stats.total} />
        <StatCard label={t('startup.enabled')} value={stats.enabled} accent="emerald" />
        <StatCard label={t('startup.disabled')} value={stats.disabled} accent="destructive" />
        <StatCard label={t('startup.type_task')} value={stats.task} accent="info" />
      </section>

      {/* ── 工具栏 ── */}
      <section className="glass rounded-2xl p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              placeholder={t('startup.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {types.map((c) => {
                const Icon = c === 'all' ? Power : TYPE_META[c]?.icon || Database
                const label = c === 'all' ? t('startup.filter_all') : t(TYPE_META[c]?.labelKey || 'startup.type_registry')
                const active = typeFilter === c
                return (
                  <button
                    key={c}
                    onClick={() => setTypeFilter(c)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all',
                      active
                        ? 'bg-primary/15 text-primary'
                        : 'bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                )
              })}
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadList(true)} disabled={loading}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('startup.refresh')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── 列表 ── */}
      <section>
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t('startup.scanning')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t('startup.no_items')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((item) => {
              const Icon = TYPE_META[item.type]?.icon || Database
              const meta = TYPE_META[item.type]
              const busy = busyId === item.id
              return (
                <div
                  key={item.id}
                  className="glass flex flex-col gap-3 rounded-2xl p-4 transition-colors hover:border-primary/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                          item.enabled ? 'bg-primary/10 text-primary' : 'bg-white/5 text-muted-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {item.name || t('startup.unnamed')}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {meta ? t(meta.labelKey) : item.type} ·{' '}
                          {t(item.scope === 'machine' ? 'startup.scope_machine' : 'startup.scope_user')}
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={item.enabled}
                      disabled={busy}
                      onCheckedChange={(next) => void handleToggle(item, next)}
                    />
                  </div>

                  <p className="line-clamp-2 break-all font-mono text-[11px] text-muted-foreground">
                    {item.command || '—'}
                  </p>

                  <div className="space-y-1 text-[11px]">
                    <Row label={t('startup.location')} value={item.location} mono title={item.location} />
                  </div>

                  <div
                    className={cn(
                      'flex items-center gap-1.5 text-[10px] font-medium',
                      item.enabled ? 'text-emerald-400/90' : 'text-muted-foreground/70',
                    )}
                  >
                    {item.enabled ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {item.enabled ? t('startup.enabled') : t('startup.disabled')}
                    {busy && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
                  </div>

                  {!item.enabled && (
                    <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                      {t('startup.disabled_hint')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {message && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <XCircle className="h-3 w-3" />
          {message}
        </p>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: 'primary' | 'emerald' | 'destructive' | 'info'
}) {
  const color =
    accent === 'emerald'
      ? 'text-emerald-400'
      : accent === 'info'
        ? 'text-info'
        : accent === 'destructive'
          ? 'text-destructive'
          : accent === 'primary'
            ? 'text-primary'
            : 'text-foreground'
  return (
    <div className="glass rounded-2xl p-4">
      <div className={cn('text-2xl font-bold tracking-tight', color)}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function Row({ label, value, mono, title }: { label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-muted-foreground/70">{label}</span>
      <span
        className={cn('min-w-0 truncate text-right text-foreground/80', mono && 'font-mono')}
        title={title || value}
      >
        {value}
      </span>
    </div>
  )
}
