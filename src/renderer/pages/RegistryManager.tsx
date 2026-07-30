import { useEffect, useMemo, useState } from 'react'
import {
  Database,
  Plus,
  RefreshCw,
  Play,
  Undo2,
  Pencil,
  Trash2,
  FolderOpen,
  Search,
  ShieldAlert,
  History as HistoryIcon,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  FilePlus2,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

type RegistryHive = 'HKLM' | 'HKCU' | 'HKCR' | 'HKU' | 'HKCC'
type RegistryValueType = 'REG_SZ' | 'REG_DWORD' | 'REG_EXPAND_SZ' | 'REG_MULTI_SZ' | 'REG_BINARY'

interface RegistryStep {
  hive: RegistryHive
  key: string
  valueName: string
  action: 'set' | 'delete' | 'deleteKey'
  type?: RegistryValueType
  data?: string
}

interface RegistryOp {
  id: number
  name: string
  description: string
  enabled: number
  steps: RegistryStep[]
  createdAt: number
  lastApplied: number | null
  lastStatus: string | null
}

interface RegistryHistoryEntry {
  id: number
  opId: number
  opName: string
  action: 'apply' | 'rollback'
  status: 'success' | 'failed' | 'partial'
  message: string | null
  backupDir: string | null
  backupFiles: string | null
  createdAt: number
}

const HIVES: RegistryHive[] = ['HKLM', 'HKCU', 'HKCR', 'HKU', 'HKCC']
const ACTIONS: RegistryStep['action'][] = ['set', 'delete', 'deleteKey']
const TYPES: RegistryValueType[] = ['REG_SZ', 'REG_DWORD', 'REG_EXPAND_SZ', 'REG_MULTI_SZ', 'REG_BINARY']

function relTime(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function StatusBadge({ status }: { status: string | null }) {
  const { t } = useI18n()
  const map: Record<string, { color: string; icon: typeof CheckCircle2; key: string }> = {
    success: { color: 'bg-emerald-500/10 text-emerald-400', icon: CheckCircle2, key: 'registry.status_success' },
    failed: { color: 'bg-destructive/10 text-destructive', icon: XCircle, key: 'registry.status_failed' },
    partial: { color: 'bg-amber-500/10 text-amber-400', icon: AlertTriangle, key: 'registry.status_partial' },
  }
  const item = map[status || '']
  if (!item) return <span className="text-[10px] text-muted-foreground">{'-'}</span>
  const Icon = item.icon
  return (
    <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', item.color)}>
      <Icon className="h-3 w-3" />
      {t(item.key)}
    </span>
  )
}

function ConfirmDialog({
  open,
  title,
  desc,
  okText,
  danger,
  onOk,
  onCancel,
}: {
  open: boolean
  title: string
  desc: string
  okText: string
  danger?: boolean
  onOk: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="glass w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', danger ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
            {danger ? <AlertTriangle className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
          </div>
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{desc}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('registry.cancel')}
          </Button>
          <Button variant={danger ? 'destructive' : 'default'} size="sm" onClick={onOk}>
            {okText}
          </Button>
        </div>
      </div>
    </div>
  )
}

function StepRow({
  step,
  index,
  query,
  onQuery,
  onChange,
  onRemove,
}: {
  step: RegistryStep
  index: number
  query?: { exists: boolean; raw: string; loading?: boolean }
  onQuery: () => void
  onChange: (patch: Partial<RegistryStep>) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const isDelKey = step.action === 'deleteKey'
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-bold text-primary">
          {index + 1}
        </span>
        <select
          value={step.hive}
          onChange={(e) => onChange({ hive: e.target.value as RegistryHive })}
          className="h-8 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {HIVES.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <Input
          value={step.key}
          placeholder={t('registry.key_placeholder')}
          onChange={(e) => onChange({ key: e.target.value })}
          className="h-8 min-w-[180px] flex-1 text-xs"
        />
        <select
          value={step.action}
          onChange={(e) => onChange({ action: e.target.value as RegistryStep['action'] })}
          className="h-8 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`registry.action_${a}`)}
            </option>
          ))}
        </select>
        {!isDelKey && (
          <Input
            value={step.valueName}
            placeholder={t('registry.value_placeholder')}
            onChange={(e) => onChange({ valueName: e.target.value })}
            className="h-8 w-32 text-xs"
          />
        )}
        <button
          onClick={onRemove}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title={t('registry.remove_step')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          onClick={onQuery}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          title={t('registry.query_value')}
        >
          {query?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </div>

      {step.action === 'set' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={step.type || 'REG_SZ'}
            onChange={(e) => onChange({ type: e.target.value as RegistryValueType })}
            className="h-8 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {ty}
              </option>
            ))}
          </select>
          <Input
            value={step.data ?? ''}
            placeholder={t('registry.data_placeholder')}
            onChange={(e) => onChange({ data: e.target.value })}
            className="h-8 min-w-[200px] flex-1 font-mono text-xs"
          />
        </div>
      )}

      {query && (
        <div
          className={cn(
            'mt-2 rounded-lg px-3 py-2 text-[11px]',
            query.exists ? 'bg-emerald-500/5 text-emerald-300/90' : 'bg-amber-500/5 text-amber-300/90',
          )}
        >
          <div className="mb-1 font-semibold">
            {query.exists ? t('registry.current_exists') : t('registry.current_missing')}
          </div>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed">{query.raw || '—'}</pre>
        </div>
      )}
    </div>
  )
}

export default function RegistryManager() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [ops, setOps] = useState<RegistryOp[]>([])
  const [history, setHistory] = useState<RegistryHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [supported, setSupported] = useState(true)
  const [message, setMessage] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ name: string; description: string; enabled: boolean; steps: RegistryStep[] }>({
    name: '',
    description: '',
    enabled: true,
    steps: [],
  })
  const [queryState, setQueryState] = useState<Record<number, { exists: boolean; raw: string; loading?: boolean }>>({})

  const [confirm, setConfirm] = useState<null | {
    title: string
    desc: string
    okText: string
    danger?: boolean
    onOk: () => void
  }>(null)

  async function loadAll() {
    if (!api) return
    setLoading(true)
    try {
      const [opsRes, histRes, supRes] = await Promise.all([
        api.invoke('registry:list') as Promise<RegistryOp[]>,
        api.invoke('registry:history') as Promise<RegistryHistoryEntry[]>,
        api.invoke('registry:supported') as Promise<{ ok: boolean; supported: boolean }>,
      ])
      setOps(Array.isArray(opsRes) ? opsRes : [])
      setHistory(Array.isArray(histRes) ? histRes : [])
      if (supRes && typeof supRes.supported === 'boolean') setSupported(supRes.supported)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    const enabled = ops.filter((o) => o.enabled).length
    const applied = ops.filter((o) => o.lastStatus).length
    return { total: ops.length, enabled, applied, history: history.length }
  }, [ops, history])

  function flash(msg: string, type: 'ok' | 'err' = 'ok') {
    setMessage(msg)
    setMsgType(type)
    setTimeout(() => setMessage(''), 6000)
  }

  function openEditor(op?: RegistryOp) {
    if (op) {
      setEditingId(op.id)
      setDraft({ name: op.name, description: op.description, enabled: !!op.enabled, steps: op.steps.map((s) => ({ ...s })) })
    } else {
      setEditingId(null)
      setDraft({ name: '', description: '', enabled: true, steps: [] })
    }
    setQueryState({})
    setEditorOpen(true)
  }

  async function handleLoadExample() {
    if (!api) return
    const ex = (await api.invoke('registry:example')) as { name: string; description: string; enabled: boolean; steps: RegistryStep[] }
    setEditingId(null)
    setDraft({ ...ex, steps: ex.steps.map((s) => ({ ...s })) })
    setQueryState({})
    setEditorOpen(true)
  }

  function updateStep(index: number, patch: Partial<RegistryStep>) {
    setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }))
  }

  function removeStep(index: number) {
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== index) }))
    setQueryState((q) => {
      const next: Record<number, { exists: boolean; raw: string; loading?: boolean }> = {}
      Object.keys(q).forEach((k) => {
        const ki = Number(k)
        if (ki < index) next[ki] = q[ki]
        else if (ki > index) next[ki - 1] = q[ki]
      })
      return next
    })
  }

  async function handleQuery(index: number) {
    if (!api) return
    const step = draft.steps[index]
    if (!step || !step.key) {
      flash(t('registry.query_key_required'), 'err')
      return
    }
    setQueryState((q) => ({ ...q, [index]: { exists: false, raw: '', loading: true } }))
    try {
      const res = (await api.invoke('registry:query', step)) as { ok: boolean; exists: boolean; raw: string }
      setQueryState((q) => ({ ...q, [index]: { exists: !!res.exists, raw: res.raw || '' } }))
    } catch {
      setQueryState((q) => ({ ...q, [index]: { exists: false, raw: t('registry.query_failed') } }))
    }
  }

  async function handleSave() {
    if (!api) return
    if (!draft.name.trim()) {
      flash(t('registry.name_required'), 'err')
      return
    }
    if (draft.steps.length === 0) {
      flash(t('registry.steps_required'), 'err')
      return
    }
    const invalid = draft.steps.find((s) => !s.key.trim())
    if (invalid) {
      flash(t('registry.step_key_invalid'), 'err')
      return
    }
    try {
      if (editingId == null) {
        await api.invoke('registry:add', {
          name: draft.name.trim(),
          description: draft.description.trim(),
          enabled: draft.enabled,
          steps: draft.steps,
        })
      } else {
        await api.invoke('registry:update', editingId, {
          name: draft.name.trim(),
          description: draft.description.trim(),
          enabled: draft.enabled,
          steps: draft.steps,
        })
      }
      setEditorOpen(false)
      flash(t('registry.saved'), 'ok')
      await loadAll()
    } catch (e) {
      flash(String(e), 'err')
    }
  }

  async function handleToggleEnabled(op: RegistryOp) {
    if (!api) return
    await api.invoke('registry:update', op.id, { enabled: !op.enabled })
    await loadAll()
  }

  async function handleApply(op: RegistryOp) {
    setConfirm({
      title: t('registry.confirm_apply_title'),
      desc: t('registry.confirm_apply_desc', { name: op.name }),
      okText: t('registry.apply'),
      onOk: async () => {
        setConfirm(null)
        if (!api) return
        const res = (await api.invoke('registry:apply', op.id)) as {
          ok: boolean
          status?: string
          applied?: number
          failed?: number
          error?: string
        }
        if (res.ok) {
          flash(t('registry.applied_msg', { applied: res.applied ?? 0, failed: res.failed ?? 0 }), 'ok')
        } else {
          flash(t('registry.apply_failed_msg') + (res.error ? '：' + res.error : ''), 'err')
        }
        await loadAll()
      },
    })
  }

  async function handleRollback(op: RegistryOp) {
    setConfirm({
      title: t('registry.confirm_rollback_title'),
      desc: t('registry.confirm_rollback_desc', { name: op.name }),
      okText: t('registry.rollback'),
      danger: true,
      onOk: async () => {
        setConfirm(null)
        if (!api) return
        const res = (await api.invoke('registry:rollback', op.id)) as {
          ok: boolean
          status?: string
          imported?: number
          failed?: number
          error?: string
        }
        if (res.ok) {
          flash(t('registry.rolled_msg', { imported: res.imported ?? 0, failed: res.failed ?? 0 }), 'ok')
        } else {
          flash(t('registry.rollback_failed_msg') + (res.error ? '：' + res.error : ''), 'err')
        }
        await loadAll()
      },
    })
  }

  async function handleDelete(op: RegistryOp) {
    setConfirm({
      title: t('registry.confirm_delete_title'),
      desc: t('registry.confirm_delete_desc', { name: op.name }),
      okText: t('registry.delete'),
      danger: true,
      onOk: async () => {
        setConfirm(null)
        if (!api) return
        await api.invoke('registry:delete', op.id)
        flash(t('registry.deleted'), 'ok')
        await loadAll()
      },
    })
  }

  async function handleOpenBackupDir() {
    if (!api) return
    await api.invoke('registry:open-backup-dir')
  }

  return (
    <div className="space-y-6">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('registry.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('registry.subtitle')}</p>
          </div>
        </div>
      </section>

      {!supported && (
        <section className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-300/90">{t('registry.not_windows')}</p>
        </section>
      )}

      {/* ── 统计 ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('registry.total_ops')} value={stats.total} />
        <StatCard label={t('registry.enabled_ops')} value={stats.enabled} accent="emerald" />
        <StatCard label={t('registry.applied_ops')} value={stats.applied} accent="primary" />
        <StatCard label={t('registry.history_count')} value={stats.history} accent="info" />
      </section>

      {/* ── 工具栏 ── */}
      <section className="glass flex flex-wrap items-center gap-2 rounded-2xl p-4">
        <Button size="sm" onClick={() => openEditor()} disabled={!supported}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('registry.new')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handleLoadExample()} disabled={!supported}>
          <FilePlus2 className="mr-1 h-3.5 w-3.5" />
          {t('registry.load_example')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handleOpenBackupDir()}>
          <FolderOpen className="mr-1 h-3.5 w-3.5" />
          {t('registry.open_backup')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
          {t('registry.refresh')}
        </Button>
      </section>

      {/* ── 操作列表 ── */}
      <section>
        {loading && ops.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t('registry.loading')}
          </div>
        ) : ops.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t('registry.no_ops')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {ops.map((op) => (
              <div key={op.id} className="glass flex flex-col gap-3 rounded-2xl p-4 transition-colors hover:border-primary/30">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{op.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {op.steps.length} {t('registry.steps_unit')}
                      </div>
                    </div>
                  </div>
                  <Switch checked={!!op.enabled} onCheckedChange={() => void handleToggleEnabled(op)} />
                </div>

                {op.description && <p className="line-clamp-2 text-xs text-muted-foreground">{op.description}</p>}

                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground/70">{t('registry.last_applied')}</span>
                  <span className="text-foreground/80">{relTime(op.lastApplied)}</span>
                  <StatusBadge status={op.lastStatus} />
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" className="flex-1" onClick={() => void handleApply(op)} disabled={!supported}>
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {t('registry.apply')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRollback(op)}
                    disabled={!supported || !op.lastStatus}
                    title={t('registry.rollback')}
                  >
                    <Undo2 className="mr-1 h-3.5 w-3.5" />
                    {t('registry.rollback')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEditor(op)} title={t('registry.edit')}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => void handleDelete(op)}
                    title={t('registry.delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 历史 ── */}
      <section className="glass rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <HistoryIcon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t('registry.history_title')}</h3>
        </div>
        {history.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{t('registry.no_history')}</p>
        ) : (
          <div className="max-h-80 space-y-1.5 overflow-auto">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                        h.action === 'apply' ? 'bg-primary/10 text-primary' : 'bg-info/10 text-info',
                      )}
                    >
                      {h.action === 'apply' ? t('registry.action_apply') : t('registry.action_rollback')}
                    </span>
                    <StatusBadge status={h.status} />
                    <span className="truncate text-xs font-medium">{h.opName}</span>
                  </div>
                  {h.message && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{h.message}</p>}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {relTime(h.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {message && (
        <p className={cn('flex items-center gap-1 text-xs', msgType === 'ok' ? 'text-emerald-400' : 'text-destructive')}>
          {msgType === 'ok' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {message}
        </p>
      )}

      {/* ── 编辑器 ── */}
      {editorOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass my-8 w-full max-w-2xl rounded-2xl p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">{editingId == null ? t('registry.new') : t('registry.edit')}</h3>
                <p className="text-xs text-muted-foreground">{t('registry.editor_hint')}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('registry.op_name')}</label>
                <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder={t('registry.op_name_placeholder')} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('registry.op_desc')}</label>
                <Input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder={t('registry.op_desc_placeholder')} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={draft.enabled} onCheckedChange={(c) => setDraft((d) => ({ ...d, enabled: c }))} />
                <span className="text-xs text-muted-foreground">{t('registry.op_enabled')}</span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted-foreground">{t('registry.steps')}</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, { hive: 'HKCU', key: '', valueName: '', action: 'set', type: 'REG_SZ', data: '' }] }))}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('registry.add_step')}
              </Button>
            </div>

            <div className="mt-2 space-y-2">
              {draft.steps.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">{t('registry.no_steps')}</p>
              ) : (
                draft.steps.map((step, i) => (
                  <StepRow
                    key={i}
                    step={step}
                    index={i}
                    query={queryState[i]}
                    onQuery={() => void handleQuery(i)}
                    onChange={(patch) => updateStep(i, patch)}
                    onRemove={() => removeStep(i)}
                  />
                ))
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditorOpen(false)}>
                {t('registry.cancel')}
              </Button>
              <Button size="sm" onClick={() => void handleSave()}>
                <Save className="mr-1 h-3.5 w-3.5" />
                {t('registry.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        desc={confirm?.desc || ''}
        okText={confirm?.okText || ''}
        danger={confirm?.danger}
        onOk={() => confirm?.onOk()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: 'primary' | 'emerald' | 'info' }) {
  const color =
    accent === 'emerald' ? 'text-emerald-400' : accent === 'info' ? 'text-info' : accent === 'primary' ? 'text-primary' : 'text-foreground'
  return (
    <div className="glass rounded-2xl p-4">
      <div className={cn('text-2xl font-bold tracking-tight', color)}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
