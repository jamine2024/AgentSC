import { useEffect, useMemo, useState } from 'react'
import { Watch, HardDrive, FolderOpen, ShieldCheck, Activity, X, Cpu, Search, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { WatcherStatus } from '@/App'

interface DiskInfo {
  letter: string
  label: string
  total: number
  used: number
}

interface WatcherConfig {
  paths: string[]
  enabled: boolean
}

interface ExclusionRule {
  id: number
  pattern: string
  reason: string
  enabled: number
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

export default function Tracking({ watcherStatus, onWatcherStatusChange }: {
  watcherStatus: WatcherStatus
  onWatcherStatusChange: (s: WatcherStatus) => void
}) {
  const { t } = useI18n()
  const api = window.electronAPI

  const [disks, setDisks] = useState<DiskInfo[]>([])
  const [config, setConfig] = useState<WatcherConfig>({ paths: [], enabled: false })
  const [rules, setRules] = useState<ExclusionRule[]>([])
  const [events, setEvents] = useState<FileEvent[]>([])
  const [customPath, setCustomPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [exporting, setExporting] = useState(false)

  // 事件筛选 / 搜索 / 排序状态
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | FileEvent['type']>('all')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  // 分页状态（同屏仅渲染一页，解决 500 条一次性渲染卡顿）
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => {
    loadDisks()
    loadConfig()
    loadRules()
    loadEvents()
  }, [])

  // 搜索 / 筛选变化时回到第一页
  useEffect(() => {
    setPage(1)
  }, [search, typeFilter])

  async function loadDisks() {
    const d = await api?.invoke('get-disk-info')
    if (Array.isArray(d)) setDisks(d as DiskInfo[])
  }

  async function loadConfig() {
    const c = await api?.invoke('get-watcher-config')
    if (c && typeof c === 'object') {
      setConfig(c as WatcherConfig)
    }
  }

  async function loadRules() {
    const r = await api?.invoke('get-exclusion-rules')
    if (Array.isArray(r)) setRules(r as ExclusionRule[])
  }

  async function loadEvents() {
    const e = await api?.invoke('get-recent-events', 500)
    if (Array.isArray(e)) setEvents(e as FileEvent[])
  }

  // 根据搜索关键词、类型、时间排序派生出展示列表
  const filteredEvents = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const list = events.filter((ev) => {
      if (typeFilter !== 'all' && ev.type !== typeFilter) return false
      if (keyword) {
        const haystack = `${ev.path} ${ev.process_name ?? ''}`.toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
    list.sort((a, b) =>
      sortOrder === 'desc' ? b.recorded_at - a.recorded_at : a.recorded_at - b.recorded_at,
    )
    return list
  }, [events, search, typeFilter, sortOrder])

  // 分页派生：仅渲染当前页切片，避免一次性渲染数百行导致卡顿
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedEvents = useMemo(
    () => filteredEvents.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredEvents, safePage],
  )

  // 筛选 / 刷新后若当前页超出范围，自动收敛到末页
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const customPaths = useMemo(
    () => config.paths.filter((p) => !disks.some((d) => d.letter === p)),
    [config.paths, disks],
  )

  function toggleDisk(letter: string) {
    setConfig((prev) => {
      const exists = prev.paths.includes(letter)
      const paths = exists ? prev.paths.filter((p) => p !== letter) : [...prev.paths, letter]
      return { ...prev, paths }
    })
  }

  async function handleSelectDirectory() {
    const p = await api?.invoke('select-directory')
    if (typeof p === 'string' && p) {
      addCustomPath(p)
    }
  }

  function addCustomPath(p: string) {
    setConfig((prev) => {
      if (prev.paths.includes(p)) return prev
      return { ...prev, paths: [...prev.paths, p] }
    })
    setCustomPath('')
  }

  function removePath(p: string) {
    setConfig((prev) => ({ ...prev, paths: prev.paths.filter((x) => x !== p) }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    try {
      const next = { ...config, paths: config.paths.filter(Boolean) }
      const s = await api?.invoke('set-watching', next)
      if (s && typeof s === 'object') onWatcherStatusChange(s as WatcherStatus)
      setMessage(t('tracking.config_saved'))
    } catch (err) {
      setMessage(t('tracking.save_failed') + ': ' + String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleExport() {
    if (filteredEvents.length === 0) return
    setExporting(true)
    try {
      const date = new Date().toISOString().slice(0, 10)
      const res = (await api?.invoke('export-events', filteredEvents, `agentsc-events-${date}.json`)) as
        | { canceled: boolean; filePath: string | null }
        | undefined
      if (res && !res.canceled && res.filePath) {
        setMessage(`${t('tracking.exported_to')} ${res.filePath}`)
      }
    } catch (err) {
      setMessage('Export failed: ' + String(err))
    } finally {
      setExporting(false)
    }
  }

  const typeConfig = useMemo(() => ({
    created: { label: t('event.created'), class: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    modified: { label: t('event.modified'), class: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    deleted: { label: t('event.deleted'), class: 'bg-red-500/10 text-red-400 border-red-500/20' },
    renamed: { label: t('event.renamed'), class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  }), [t])

  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Watch className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('tracking.config_title')}</h2>
            <p className="text-xs text-muted-foreground">{t('tracking.config_subtitle')}</p>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl', watcherStatus.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-muted-foreground')}>
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium">{watcherStatus.active ? t('tracking.monitoring_active') : t('tracking.monitoring_stopped')}</div>
              <div className="text-xs text-muted-foreground">
                {config.enabled ? t('tracking.enabled_targets').replace('{count}', String(config.paths.length)) : t('tracking.not_enabled')}
              </div>
            </div>
          </div>

          {watcherStatus.processTracker?.active && (
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex h-9 w-9 items-center justify-center rounded-xl',
                watcherStatus.processTracker.mode === 'etw' ? 'bg-primary/10 text-primary' : 'bg-blue-500/10 text-blue-400'
              )}>
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {watcherStatus.processTracker.mode === 'etw' ? t('tracking.etw_process') : t('tracking.snapshot_process')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('tracking.collected_events').replace('{count}', watcherStatus.processTracker.eventCount.toLocaleString())}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{t('tracking.enable_monitoring')}</span>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, enabled: checked }))}
            />
          </div>
        </div>

        <div className="mb-4">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">{t('tracking.select_disks')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {disks.map((disk) => {
              const percent = disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0
              const selected = config.paths.includes(disk.letter)
              return (
                <button
                  key={disk.letter}
                  onClick={() => toggleDisk(disk.letter)}
                  className={cn(
                    'relative flex flex-col gap-1.5 rounded-xl border p-3 text-left transition',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <HardDrive className="h-3.5 w-3.5" />
                      {disk.letter}
                    </span>
                    {selected && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {disk.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatBytes(disk.used)} / {formatBytes(disk.total)}
                  </span>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn('h-full rounded-full', percent > 85 ? 'bg-destructive' : 'bg-primary')}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mb-6 space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground">{t('tracking.custom_dirs')}</h3>
          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              placeholder={t('tracking.dir_placeholder')}
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customPath.trim()) {
                  addCustomPath(customPath.trim())
                }
              }}
              className="flex-1"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSelectDirectory}>
                {t('tracking.select_dir')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => customPath.trim() && addCustomPath(customPath.trim())}
                disabled={!customPath.trim()}
              >
                {t('tracking.add')}
              </Button>
            </div>
          </div>

          {customPaths.length > 0 && (
            <div className="space-y-2">
              {customPaths.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs text-muted-foreground" title={p}>
                      {p}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removePath(p)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mb-6">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('tracking.active_rules')}</h3>
          {rules.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('exclusions.no_rules')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {rules.filter((r) => r.enabled).map((rule) => (
                <span
                  key={rule.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-muted-foreground"
                  title={rule.reason}
                >
                  <ShieldCheck className="h-3 w-3 text-primary" />
                  {rule.pattern}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            {message && (
              <p className={cn('text-xs', /失败|failed/i.test(message) ? 'text-destructive' : 'text-emerald-400')}>
                {message}
              </p>
            )}
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('tracking.saving') : t('tracking.save_config')}
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">{t('tracking.recent_events')}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadEvents}>
              {t('tracking.refresh')}
            </Button>
            <Button size="sm" disabled={filteredEvents.length === 0 || exporting} onClick={handleExport}>
              {exporting ? t('tracking.exporting') : t('tracking.export')}
            </Button>
          </div>
        </div>

        {/* 搜索 / 类型筛选 / 时间排序工具栏 */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1 md:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t('tracking.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 'created', 'modified', 'deleted', 'renamed'] as const).map((f) => {
                const active = typeFilter === f
                const label = f === 'all' ? t('tracking.filter_all') : typeConfig[f].label
                return (
                  <button
                    key={f}
                    onClick={() => setTypeFilter(f)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-white/10 bg-white/5 text-muted-foreground hover:border-white/20',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            >
              {sortOrder === 'desc' ? t('tracking.sort_newest') : t('tracking.sort_oldest')}
              <ArrowUpDown className="ml-1.5 h-3 w-3" />
            </Button>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('tracking.filtered_count').replace('{count}', String(filteredEvents.length))}</span>
            {(search || typeFilter !== 'all') && (
              <button
                className="text-primary hover:underline"
                onClick={() => {
                  setSearch('')
                  setTypeFilter('all')
                }}
              >
                {t('tracking.clear_filter')}
              </button>
            )}
          </div>
        </div>

        <div className="glass rounded-2xl border border-white/5 px-5">
          {events.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('tracking.no_events')}
            </div>
          ) : pagedEvents.length > 0 ? (
            pagedEvents.map((event, idx) => {
              const cfg = typeConfig[event.type]
              return (
                <div
                  key={`${event.path}-${event.recorded_at}-${idx}`}
                  className="flex items-center justify-between border-b border-white/5 py-3 last:border-0 animate-fade-in"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', cfg.class)}>
                      {cfg.label}
                    </span>
                    <span className="truncate text-sm text-muted-foreground" title={event.path}>
                      {event.path}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        'max-w-[140px] truncate rounded-full border px-2 py-0.5',
                        event.process_name
                          ? 'border-primary/20 bg-primary/10 text-primary'
                          : 'border-white/5 bg-white/5 text-muted-foreground',
                      )}
                      title={event.process_name ? `PID ${event.process_id ?? '-'}` : t('event.unidentified')}
                    >
                      {event.process_name || t('event.unknown_process')}
                    </span>
                    <span className="w-16 text-right">{event.size ? formatBytes(event.size) : '-'}</span>
                    <span className="w-20 text-right">{new Date(event.recorded_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('tracking.no_match')}
            </div>
          )}
        </div>

        {/* 分页控件 */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {t('tracking.page_info')
                .replace('{page}', String(safePage))
                .replace('{total}', String(totalPages))}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={safePage <= 1}
                onClick={() => setPage(1)}
                title={t('tracking.first_page')}
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                title={t('tracking.prev_page')}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              {/* 页码窗口：始终显示首尾页 + 当前页附近的页码 */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .reduce<number[]>((acc, p) => {
                  if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1) // 占位省略号
                  acc.push(p)
                  return acc
                }, [])
                .map((p, i) =>
                  p === -1 ? (
                    <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={cn(
                        'h-8 min-w-8 rounded-md border px-2 text-xs transition',
                        p === safePage
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-white/10 bg-white/5 text-muted-foreground hover:border-white/20',
                      )}
                    >
                      {p}
                    </button>
                  ),
                )}

              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                title={t('tracking.next_page')}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                disabled={safePage >= totalPages}
                onClick={() => setPage(totalPages)}
                title={t('tracking.last_page')}
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
