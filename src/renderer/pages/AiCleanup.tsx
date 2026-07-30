import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Wand2, Sparkles, FolderOpen, Trash2, AlertTriangle, ShieldCheck, Search, Check, X, RefreshCw, Loader2, FileWarning, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

type CleanupCategory = 'recycle_bin' | 'temp' | 'browser_cache' | 'large_files' | 'old_files'
type CleanupRisk = 'safe' | 'caution' | 'risky'
type CleanupAction = 'system' | 'recycle'

interface CleanupItem {
  id: string
  category: CleanupCategory
  title: string
  path: string
  size: number
  risk: CleanupRisk
  reason: string
  recommended: boolean
  action: CleanupAction
}

export interface ScanResult {
  items: CleanupItem[]
  summary: string
  source: 'ollama' | 'openai' | 'heuristic'
  error?: string
}

export interface RunDetail {
  id: string
  ok: boolean
  message: string
  freedBytes: number
}

interface RunResult {
  success: boolean
  freedBytes: number
  message: string
  details: RunDetail[]
}

const groupIcons: Record<'system' | 'large_files' | 'old_files', React.ElementType> = {
  system: Trash2,
  large_files: FileWarning,
  old_files: AlertTriangle,
}

const groupClasses: Record<'system' | 'large_files' | 'old_files', string> = {
  system: 'bg-primary/10 text-primary',
  large_files: 'bg-amber-500/10 text-amber-400',
  old_files: 'bg-destructive/10 text-destructive',
}

const riskClasses: Record<CleanupRisk, string> = {
  safe: 'bg-emerald-500/10 text-emerald-400',
  caution: 'bg-amber-500/10 text-amber-400',
  risky: 'bg-destructive/10 text-destructive',
}

function categoryToGroup(category: CleanupCategory): 'system' | 'large_files' | 'old_files' {
  if (category === 'large_files') return 'large_files'
  if (category === 'old_files') return 'old_files'
  return 'system'
}

function CleanupRow({
  item,
  checked,
  onToggle,
}: {
  item: CleanupItem
  checked: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3 transition',
        checked ? 'border-primary/40 bg-primary/[0.04]' : 'border-white/10 bg-white/[0.02]',
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
          checked ? 'border-primary bg-primary text-white' : 'border-white/20 bg-transparent hover:border-primary/50',
        )}
        aria-label={t('aicleanup.selected_count')}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px]', riskClasses[item.risk])}>
            {t('aicleanup.risk.' + item.risk)}
          </span>
          {item.recommended && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              {t('aicleanup.recommended')}
            </span>
          )}
        </div>
        {item.path && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={item.path}>
            {item.path}
          </div>
        )}
        {item.reason && <div className="mt-1 text-xs text-muted-foreground">{item.reason}</div>}
        {item.action === 'recycle' && (
          <div className="mt-1 text-[10px] text-muted-foreground">↩ {t('aicleanup.to_recycle')}</div>
        )}
      </div>

      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums">{formatBytes(item.size)}</div>
      </div>
    </div>
  )
}

export interface AiCleanupProps {
  target: string
  largeThreshold: number
  oldDays: number
  maxItems: number
  scanning: boolean
  running: boolean
  result: ScanResult | null
  selected: Set<string>
  message: string
  failedDetails: RunDetail[]
  onTargetChange: (v: string) => void
  onLargeThresholdChange: (v: number) => void
  onOldDaysChange: (v: number) => void
  onScanningChange: (v: boolean) => void
  onRunningChange: (v: boolean) => void
  onResultChange: Dispatch<SetStateAction<ScanResult | null>>
  onSelectedChange: Dispatch<SetStateAction<Set<string>>>
  onMessageChange: (v: string) => void
  onFailedChange: (v: RunDetail[]) => void
}

export default function AiCleanup(props: AiCleanupProps) {
  const api = window.electronAPI
  const { t } = useI18n()
  const {
    target,
    largeThreshold,
    oldDays,
    maxItems,
    scanning,
    running,
    result,
    selected,
    message,
    failedDetails,
    onTargetChange,
    onLargeThresholdChange,
    onOldDaysChange,
    onScanningChange,
    onRunningChange,
    onResultChange,
    onSelectedChange,
    onMessageChange,
    onFailedChange,
  } = props

  const [confirmOpen, setConfirmOpen] = useState(false)

  // True while a scan or cleanup is running: lock parameter controls so the
  // user cannot mutate inputs the in-flight operation already captured.
  // `scanning`/`running` now live in App-level state, so this lock survives
  // tab switches (unlike the previous component-local state that reset on unmount).
  const busy = scanning || running

  async function handleSelectDir() {
    const dir = (await api?.invoke('select-directory')) as string | null
    if (dir) onTargetChange(dir)
  }

  async function handleScan() {
    onScanningChange(true)
    onMessageChange('')
    onFailedChange([])
    onResultChange(null)
    onSelectedChange(new Set())
    try {
      const res = (await api?.invoke(
        'scan-ai-cleanup',
        target.trim() || undefined,
        {
          largeThresholdMb: Number(largeThreshold) || 500,
          oldDays: Number(oldDays) || 180,
          maxItems: Number(maxItems) || 30,
        },
      )) as ScanResult
      onResultChange(res)
      const recommended = new Set(res.items.filter((i) => i.recommended).map((i) => i.id))
      onSelectedChange(recommended)
    } catch (err) {
      onMessageChange(t('aicleanup.scan_failed') + ': ' + String(err))
    } finally {
      onScanningChange(false)
    }
  }

  const groups = useMemo(() => {
    if (!result) return []
    const map = new Map<'system' | 'large_files' | 'old_files', CleanupItem[]>()
    for (const item of result.items) {
      const g = categoryToGroup(item.category)
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(item)
    }
    return Array.from(map.entries())
  }, [result])

  const selectedItems = useMemo(
    () => (result ? result.items.filter((i) => selected.has(i.id)) : []),
    [result, selected],
  )

  const reclaimable = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.size, 0),
    [selectedItems],
  )

  function toggle(id: string) {
    onSelectedChange((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllRecommended() {
    if (!result) return
    onSelectedChange(new Set(result.items.filter((i) => i.recommended).map((i) => i.id)))
  }

  function toggleGroup(groupItems: CleanupItem[]) {
    const allSelected = groupItems.every((i) => selected.has(i.id))
    onSelectedChange((prev: Set<string>) => {
      const next = new Set(prev)
      if (allSelected) {
        groupItems.forEach((i) => next.delete(i.id))
      } else {
        groupItems.forEach((i) => next.add(i.id))
      }
      return next
    })
  }

  async function confirmClean() {
    if (selectedItems.length === 0) return
    setConfirmOpen(false)
    onRunningChange(true)
    onMessageChange('')
    onFailedChange([])
    try {
      const res = (await api?.invoke('run-ai-cleanup', { items: selectedItems })) as RunResult
      const okIds = new Set(res.details.filter((d) => d.ok).map((d) => d.id))
      const failed = res.details.filter((d) => !d.ok)

      onResultChange((prev: ScanResult | null) => {
        if (!prev) return prev
        return { ...prev, items: prev.items.filter((i) => !okIds.has(i.id)) }
      })
      onSelectedChange((prev: Set<string>) => {
        const next = new Set(prev)
        for (const d of res.details) {
          if (d.ok) next.delete(d.id)
        }
        return next
      })

      if (failed.length === 0) {
        onMessageChange(t('aicleanup.clean_success').replace('{size}', formatBytes(res.freedBytes)))
      } else {
        onMessageChange(t('aicleanup.clean_partial').replace('{size}', formatBytes(res.freedBytes)).replace('{count}', String(failed.length)))
        onFailedChange(failed)
      }
    } catch (err) {
      onMessageChange(t('aicleanup.scan_failed') + ': ' + String(err))
      onFailedChange([])
    } finally {
      onRunningChange(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Wand2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('aicleanup.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('aicleanup.subtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <Input
            placeholder={t('aicleanup.target_placeholder')}
            value={target}
            onChange={(e) => onTargetChange(e.target.value)}
            className="md:col-span-5"
            disabled={busy}
            title={busy ? t('aicleanup.locked_hint') : t('aicleanup.target_placeholder')}
          />
          <Button variant="outline" className="md:col-span-2" onClick={handleSelectDir} disabled={busy}>
            <FolderOpen className="mr-1.5 h-4 w-4" />
            {t('aicleanup.select_dir')}
          </Button>
          <Input
            type="number"
            min={50}
            value={largeThreshold}
            onChange={(e) => onLargeThresholdChange(Number(e.target.value))}
            className="md:col-span-2"
            title={busy ? t('aicleanup.locked_hint') : t('aicleanup.large_threshold')}
            disabled={busy}
          />
          <Input
            type="number"
            min={1}
            value={oldDays}
            onChange={(e) => onOldDaysChange(Number(e.target.value))}
            className="md:col-span-1"
            title={busy ? t('aicleanup.locked_hint') : t('aicleanup.old_days')}
            disabled={busy}
          />
          <Button className="md:col-span-2" onClick={handleScan} disabled={busy}>
            {scanning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            {scanning ? t('aicleanup.scanning') : t('aicleanup.start_scan')}
          </Button>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>{t('aicleanup.large_threshold')}: {largeThreshold} MB</span>
          <span>{t('aicleanup.old_days')}: {oldDays}</span>
          <span>{t('aicleanup.max_items')}: {maxItems}</span>
        </div>
      </section>

      {/* AI summary + stats */}
      {result && (
        <>
          <section className="glass rounded-2xl border border-white/5 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Sparkles className="h-4 w-4 text-primary" />
              {t('aicleanup.ai_summary')}
              <span className="ml-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                {t('aicleanup.source')}: {t('ai.source.' + result.source)}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{result.summary}</p>

            {result.error && (
              <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                {t('aicleanup.ai_degraded', { reason: result.error })}
              </p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="text-xs text-muted-foreground">{t('aicleanup.reclaimable')}</div>
                <div className="mt-1 text-xl font-bold tabular-nums">{formatBytes(reclaimable)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="text-xs text-muted-foreground">{t('aicleanup.selected_count')}</div>
                <div className="mt-1 text-xl font-bold tabular-nums">
                  {selectedItems.length} / {result.items.length}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={selectAllRecommended}>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  {t('aicleanup.select_all_recommended')}
                </Button>
              </div>
            </div>

            {message && (
              <div
                className={cn(
                  'mt-4 rounded-lg px-3 py-2 text-xs',
                  failedDetails.length > 0
                    ? 'bg-amber-500/10 text-amber-400'
                    : message.startsWith(t('aicleanup.scan_failed'))
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-emerald-500/10 text-emerald-400',
                )}
              >
                <p>{message}</p>
                {failedDetails.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-amber-500/20 pt-2">
                    {failedDetails.map((d) => {
                      const item = result?.items.find((i) => i.id === d.id)
                      return (
                        <li key={d.id} className="flex items-start gap-2">
                          <X className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="break-all">
                            {item ? item.title : d.id}: {d.message}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* Cleanup suggestion groups */}
          <section className="space-y-4">
            {groups.map(([group, items]) => {
              const Icon = groupIcons[group]
              return (
                <div key={group} className="glass rounded-2xl border border-white/5 p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', groupClasses[group])}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-semibold tracking-tight">{t('aicleanup.category.' + group)}</h3>
                    <span className="text-xs text-muted-foreground">({items.length})</span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(items)}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                      {items.every((i) => selected.has(i.id)) ? t('aicleanup.deselect_all') : t('aicleanup.select_all')}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <CleanupRow
                        key={item.id}
                        item={item}
                        checked={selected.has(item.id)}
                        onToggle={() => toggle(item.id)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </section>

          {/* Clean action bar */}
          <div className="cleanup-actionbar sticky bottom-0 z-10 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[hsl(var(--background))]/80 p-4 backdrop-blur">
            <div className="text-sm text-muted-foreground">
              {t('aicleanup.selected_count')}: <span className="font-semibold text-foreground">{selectedItems.length}</span>
              {' · '}
              {t('aicleanup.reclaimable')}: <span className="font-semibold text-foreground">{formatBytes(reclaimable)}</span>
            </div>
            <Button className="cleanup-confirm" onClick={() => setConfirmOpen(true)} disabled={selectedItems.length === 0 || running}>
              {running ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
              {running ? t('aicleanup.cleaning') : t('aicleanup.clean_selected')}
            </Button>
          </div>
        </>
      )}

      {!result && !scanning && (
        <section className="glass rounded-2xl border border-white/5 p-10 text-center text-sm text-muted-foreground">
          {t('aicleanup.no_items')}
        </section>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="glass w-full max-w-md rounded-2xl border border-white/10 p-6">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-semibold tracking-tight">{t('aicleanup.confirm_title')}</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('aicleanup.confirm_desc')
                .replace('{count}', String(selectedItems.length))
                .replace('{size}', formatBytes(reclaimable))}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                <X className="mr-1.5 h-4 w-4" />
                {t('aicleanup.cancel')}
              </Button>
              <Button variant="destructive" onClick={confirmClean}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                {t('aicleanup.confirm_ok')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
