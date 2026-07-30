import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  RefreshCw,
  Search,
  Download,
  Trash2,
  Lock,
  KeyRound,
  Fingerprint,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  CalendarClock,
  Copy,
  Filter,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

interface CertStore {
  location: string
  name: string
  count: number
}

interface CertSummary {
  thumbprint: string
  subject: string
  issuer: string
  notBefore: string
  notAfter: string
  hasPrivateKey: boolean
  friendlyName: string
  serialNumber: string
  eku: string
  template: string
  location: string
  store: string
}

interface CertDetail extends CertSummary {
  thumbprintSha256: string
  san: string
  version: number
  signatureAlgorithm: string
  publicKey: string
}

interface CertRef {
  location: string
  store: string
  thumbprint: string
  friendlyName?: string
  subject?: string
}

interface ExportResult {
  ok: boolean
  canceled?: boolean
  error?: string
  filePath?: string
  dir?: string
  results?: Array<{ thumbprint: string; ok: boolean; error?: string; filePath: string }>
}

interface DeleteResult {
  ok: boolean
  error?: string
  results: Array<{ thumbprint: string; ok: boolean; error?: string }>
}

type CertValidity = 'valid' | 'expiring' | 'expired'

function cnOf(subject: string): string {
  const m = subject.match(/CN=([^,]+)/i)
  return m ? m[1].trim() : subject
}

function parseDate(s: string): Date {
  const d = new Date(s.replace(' ', 'T'))
  return isNaN(d.getTime()) ? new Date(0) : d
}

function certValidity(notAfter: string): CertValidity {
  const d = parseDate(notAfter)
  const now = Date.now()
  if (d.getTime() < now) return 'expired'
  if (d.getTime() - now < 30 * 86400000) return 'expiring'
  return 'valid'
}

function shortDate(s: string): string {
  const d = parseDate(s)
  if (d.getTime() === 0) return '—'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 有效期状态徽标
function ValidityBadge({ status }: { status: CertValidity }) {
  const { t } = useI18n()
  const map: Record<CertValidity, { color: string; icon: typeof CheckCircle2; key: string }> = {
    valid: { color: 'bg-emerald-500/10 text-emerald-400', icon: CheckCircle2, key: 'cert.status_valid' },
    expiring: { color: 'bg-amber-500/10 text-amber-400', icon: ShieldAlert, key: 'cert.status_expiring' },
    expired: { color: 'bg-destructive/10 text-destructive', icon: XCircle, key: 'cert.status_expired' },
  }
  const item = map[status]
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="glass w-full max-w-md rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', danger ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
            {danger ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{desc}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('cert.cancel')}
          </Button>
          <Button variant={danger ? 'destructive' : 'default'} size="sm" onClick={onOk}>
            {okText}
          </Button>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.05] py-2.5">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</div>
      <div className="text-xs leading-relaxed text-foreground/90">{children}</div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: 'primary' | 'emerald' | 'info' | 'destructive' }) {
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

export default function CertManager() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [supported, setSupported] = useState(true)
  const [stores, setStores] = useState<CertStore[]>([])
  const [storesLoading, setStoresLoading] = useState(false)
  const [selected, setSelected] = useState<{ location: string; store: string } | null>(null)
  const [certificates, setCertificates] = useState<CertSummary[]>([])
  const [certsLoading, setCertsLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')

  const [detail, setDetail] = useState<CertDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [pfxPassword, setPfxPassword] = useState('')
  const [showPfx, setShowPfx] = useState(false)

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [selectedRefs, setSelectedRefs] = useState<Record<string, CertRef>>({})
  const [deleteKey, setDeleteKey] = useState(false)

  const [confirm, setConfirm] = useState<null | {
    title: string
    desc: string
    okText: string
    danger?: boolean
    onOk: () => void
  }>(null)

  const storeKey = (location: string, store: string) => `${location}|${store}`
  const certKey = (c: CertSummary) => `${c.location}|${c.store}|${c.thumbprint}`

  async function loadStores() {
    if (!api) return
    setStoresLoading(true)
    try {
      const [sup, storesRes] = await Promise.all([
        api.invoke('cert:supported') as Promise<{ ok: boolean; supported: boolean }>,
        api.invoke('cert:stores') as Promise<{ ok: boolean; stores: CertStore[]; error?: string }>,
      ])
      if (sup && typeof sup.supported === 'boolean') setSupported(sup.supported)
      if (storesRes && storesRes.ok) setStores(Array.isArray(storesRes.stores) ? storesRes.stores : [])
      else if (storesRes && storesRes.error) flash(storesRes.error, 'err')
    } catch (e) {
      flash(String(e), 'err')
    } finally {
      setStoresLoading(false)
    }
  }

  async function loadCertificates(location: string, store: string) {
    if (!api) return
    setSelected({ location, store })
    setSelectedKeys(new Set())
    setSelectedRefs({})
    setCertsLoading(true)
    try {
      const res = (await api.invoke('cert:list', location, store)) as { ok: boolean; certificates: CertSummary[]; error?: string }
      if (res && res.ok) setCertificates(Array.isArray(res.certificates) ? res.certificates : [])
      else if (res && res.error) flash(res.error, 'err')
    } catch (e) {
      flash(String(e), 'err')
    } finally {
      setCertsLoading(false)
    }
  }

  useEffect(() => {
    void loadStores()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function flash(msg: string, type: 'ok' | 'err' = 'ok') {
    setMessage(msg)
    setMsgType(type)
    setTimeout(() => setMessage(''), 6000)
  }

  const groupedStores = useMemo(() => {
    const g: Record<string, CertStore[]> = { CurrentUser: [], LocalMachine: [] }
    for (const s of stores) {
      if (!g[s.location]) g[s.location] = []
      g[s.location].push(s)
    }
    return g
  }, [stores])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return certificates
    return certificates.filter((c) =>
      [c.subject, c.issuer, c.thumbprint, c.serialNumber, c.friendlyName, c.eku].some((f) => (f || '').toLowerCase().includes(q)),
    )
  }, [certificates, query])

  const stats = useMemo(() => {
    const expired = certificates.filter((c) => certValidity(c.notAfter) === 'expired').length
    const expiring = certificates.filter((c) => certValidity(c.notAfter) === 'expiring').length
    return { total: certificates.length, expired, expiring, selected: selectedKeys.size }
  }, [certificates, selectedKeys])

  async function openDetail(c: CertSummary) {
    if (!api) return
    setDetail(null)
    setShowPfx(false)
    setPfxPassword('')
    setDetailLoading(true)
    try {
      const res = (await api.invoke('cert:detail', c.location, c.store, c.thumbprint)) as {
        ok: boolean
        cert?: CertDetail
        error?: string
      }
      if (res && res.ok && res.cert) setDetail(res.cert)
      else if (res && res.error) flash(res.error, 'err')
    } catch (e) {
      flash(String(e), 'err')
    } finally {
      setDetailLoading(false)
    }
  }

  function toggleSelect(c: CertSummary) {
    const key = certKey(c)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setSelectedRefs((prev) => {
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = { location: c.location, store: c.store, thumbprint: c.thumbprint, friendlyName: c.friendlyName, subject: c.subject }
      return next
    })
  }

  async function handleExport(refs: CertRef[], format: 'cer' | 'pfx', password?: string) {
    if (!api) return
    if (refs.length === 0) {
      flash(t('cert.select_first'), 'err')
      return
    }
    try {
      const res = (await api.invoke('cert:export', { items: refs, format, password })) as ExportResult
      if (res.canceled) return
      if (!res.ok && !res.results) {
        flash((res.error || t('cert.export_failed')) + (res.filePath ? `：${res.filePath}` : ''), 'err')
        return
      }
      if (res.results) {
        const failed = res.results.filter((r) => !r.ok)
        if (failed.length === 0) flash(t('cert.exported_dir', { dir: res.dir || '' }), 'ok')
        else flash(t('cert.export_partial', { ok: res.results.length - failed.length, failed: failed.length }), 'err')
      } else {
        flash(t('cert.exported_file', { file: res.filePath || '' }), 'ok')
      }
    } catch (e) {
      flash(String(e), 'err')
    }
  }

  async function handleDelete(refs: CertRef[], withKey: boolean) {
    if (!api) return
    if (refs.length === 0) {
      flash(t('cert.select_first'), 'err')
      return
    }
    try {
      const res = (await api.invoke('cert:delete', { items: refs, deleteKey: withKey })) as DeleteResult
      const failed = (res.results || []).filter((r) => !r.ok)
      if (failed.length === 0) flash(t('cert.deleted_ok', { n: refs.length }), 'ok')
      else flash(t('cert.delete_partial', { ok: (res.results || []).length - failed.length, failed: failed.length }), 'err')
      setDetail(null)
      if (selected) await loadCertificates(selected.location, selected.store)
    } catch (e) {
      flash(String(e), 'err')
    }
  }

  function confirmDelete(refs: CertRef[], withKey: boolean) {
    setConfirm({
      title: t('cert.confirm_delete_title'),
      desc: t('cert.confirm_delete_desc', { n: refs.length, key: withKey ? t('cert.with_private_key') : t('cert.cert_only') }),
      okText: t('cert.delete'),
      danger: true,
      onOk: () => {
        setConfirm(null)
        void handleDelete(refs, withKey)
      },
    })
  }

  async function copyText(s: string) {
    try {
      await navigator.clipboard.writeText(s)
      flash(t('cert.copied'), 'ok')
    } catch {
      /* ignore */
    }
  }

  const selectedRefList = Object.values(selectedRefs)

  return (
    <div className="space-y-6">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BadgeCheck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('cert.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('cert.subtitle')}</p>
          </div>
        </div>
      </section>

      {!supported && (
        <section className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-300/90">{t('cert.not_windows')}</p>
        </section>
      )}

      {/* ── 统计 ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('cert.stat_total')} value={stats.total} />
        <StatCard label={t('cert.stat_expiring')} value={stats.expiring} accent="info" />
        <StatCard label={t('cert.stat_expired')} value={stats.expired} accent="destructive" />
        <StatCard label={t('cert.stat_selected')} value={stats.selected} accent="emerald" />
      </section>

      {/* ── 工具栏 ── */}
      <section className="glass flex flex-wrap items-center gap-2 rounded-2xl p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('cert.search_placeholder')}
            className="h-9 pl-9 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadStores()} disabled={storesLoading || !supported}>
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', storesLoading && 'animate-spin')} />
          {t('cert.refresh')}
        </Button>
        {selected && (
          <Button variant="outline" size="sm" onClick={() => void loadCertificates(selected.location, selected.store)} disabled={certsLoading}>
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', certsLoading && 'animate-spin')} />
            {t('cert.reload_store')}
          </Button>
        )}
        <div className="mx-1 h-6 w-px bg-white/10" />
        <Button
          variant="outline"
          size="sm"
          disabled={selectedRefList.length === 0}
          onClick={() => void handleExport(selectedRefList, 'cer')}
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          {t('cert.export_cer')}
          {selectedRefList.length > 0 && <span className="ml-1 text-[10px]">({selectedRefList.length})</span>}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10"
          disabled={selectedRefList.length === 0}
          onClick={() => confirmDelete(selectedRefList, deleteKey)}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          {t('cert.delete')}
          {selectedRefList.length > 0 && <span className="ml-1 text-[10px]">({selectedRefList.length})</span>}
        </Button>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={deleteKey} onCheckedChange={setDeleteKey} />
          {t('cert.delete_with_key')}
        </label>
      </section>

      {/* ── 主体：左侧 store 树 + 右侧证书列表 ── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        {/* 左侧存储树 */}
        <div className="glass rounded-2xl p-3">
          <div className="mb-2 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            <Filter className="h-3 w-3" />
            {t('cert.stores')}
          </div>
          {storesLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t('cert.loading')}
            </div>
          ) : stores.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{t('cert.no_stores')}</p>
          ) : (
            <div className="space-y-3">
              {Object.keys(groupedStores).map((loc) =>
                groupedStores[loc].length === 0 ? null : (
                  <div key={loc}>
                    <div className="px-1 py-1 text-[11px] font-semibold text-foreground/70">{loc}</div>
                    <div className="space-y-1">
                      {groupedStores[loc].map((s) => {
                        const active = selected?.location === s.location && selected?.store === s.name
                        return (
                          <button
                            key={storeKey(s.location, s.name)}
                            onClick={() => void loadCertificates(s.location, s.name)}
                            className={cn(
                              'group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                              active ? 'bg-primary/12 text-foreground' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground/80',
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', active && 'rotate-90')} />
                              <span className="truncate font-mono">{s.name}</span>
                            </span>
                            <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px]', active ? 'bg-primary/20 text-primary' : 'bg-white/5 text-muted-foreground/70')}>
                              {s.count}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {/* 右侧证书列表 */}
        <div className="glass rounded-2xl p-3">
          {!selected ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-sm text-muted-foreground">
              <BadgeCheck className="h-8 w-8 opacity-40" />
              <p>{t('cert.pick_store')}</p>
            </div>
          ) : certsLoading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t('cert.loading')}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-sm text-muted-foreground">
              {query ? t('cert.no_match') : t('cert.no_certs')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((c) => {
                const key = certKey(c)
                const sel = selectedKeys.has(key)
                const validity = certValidity(c.notAfter)
                return (
                  <div
                    key={key}
                    onClick={() => void openDetail(c)}
                    className={cn(
                      'group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                      sel ? 'border-primary/30 bg-primary/[0.06]' : 'border-white/[0.06] hover:border-white/10 hover:bg-white/[0.02]',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={sel}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(c)}
                      className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                    />
                    {c.hasPrivateKey ? (
                      <KeyRound className="h-4 w-4 shrink-0 text-amber-400" />
                    ) : (
                      <Lock className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{cnOf(c.subject) || c.subject}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {t('cert.issuer')}：{cnOf(c.issuer) || c.issuer}
                      </div>
                    </div>
                    <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                      <ValidityBadge status={validity} />
                      <span className="text-[10px] text-muted-foreground/70">
                        {shortDate(c.notBefore)} ~ {shortDate(c.notAfter)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {message && (
        <p className={cn('flex items-center gap-1 text-xs', msgType === 'ok' ? 'text-emerald-400' : 'text-destructive')}>
          {msgType === 'ok' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {message}
        </p>
      )}

      {/* ── 详情抽屉 ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="glass flex h-full w-full max-w-md flex-col overflow-auto rounded-l-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  {detail.hasPrivateKey ? <KeyRound className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold">{cnOf(detail.subject) || detail.subject}</h3>
                  <p className="text-xs text-muted-foreground">{detail.friendlyName || detail.store}</p>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('cert.loading')}
              </div>
            ) : (
              <div className="mt-4 flex-1">
                <div className="mb-3 flex items-center gap-2">
                  <ValidityBadge status={certValidity(detail.notAfter)} />
                  {detail.hasPrivateKey && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                      <KeyRound className="h-3 w-3" />
                      {t('cert.has_private_key')}
                    </span>
                  )}
                </div>

                <DetailRow label={t('cert.field_subject')}>
                  <span className="break-all">{detail.subject}</span>
                </DetailRow>
                <DetailRow label={t('cert.field_issuer')}>
                  <span className="break-all">{detail.issuer}</span>
                </DetailRow>
                <DetailRow label={t('cert.field_thumbprint')}>
                  <span className="flex items-center gap-1.5">
                    <span className="break-all font-mono text-[10px]">{detail.thumbprint}</span>
                    <button onClick={() => void copyText(detail.thumbprint)} className="shrink-0 text-muted-foreground hover:text-primary">
                      <Copy className="h-3 w-3" />
                    </button>
                  </span>
                </DetailRow>
                <DetailRow label={t('cert.field_thumbprint_sha256')}>
                  <span className="flex items-center gap-1.5">
                    <span className="break-all font-mono text-[10px]">{detail.thumbprintSha256 || '—'}</span>
                    {detail.thumbprintSha256 && (
                      <button onClick={() => void copyText(detail.thumbprintSha256)} className="shrink-0 text-muted-foreground hover:text-primary">
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </DetailRow>
                <DetailRow label={t('cert.field_serial')}>
                  <span className="break-all font-mono text-[10px]">{detail.serialNumber || '—'}</span>
                </DetailRow>
                <DetailRow label={t('cert.field_validity')}>
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="h-3 w-3 text-muted-foreground" />
                    {detail.notBefore} ~ {detail.notAfter}
                  </span>
                </DetailRow>
                <DetailRow label={t('cert.field_version')}>{detail.version || '—'}</DetailRow>
                <DetailRow label={t('cert.field_signature')}>{detail.signatureAlgorithm || '—'}</DetailRow>
                <DetailRow label={t('cert.field_publickey')}>{detail.publicKey || '—'}</DetailRow>
                <DetailRow label={t('cert.field_eku')}>{detail.eku || '—'}</DetailRow>
                <DetailRow label={t('cert.field_san')}>
                  {detail.san ? <span className="whitespace-pre-wrap break-all">{detail.san}</span> : '—'}
                </DetailRow>
                <DetailRow label={t('cert.field_template')}>{detail.template || '—'}</DetailRow>
                <DetailRow label={t('cert.field_location')}>
                  <span className="font-mono">
                    {detail.location}\{detail.store}
                  </span>
                </DetailRow>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
              {showPfx ? (
                <div className="space-y-2">
                  <Input
                    type="password"
                    value={pfxPassword}
                    onChange={(e) => setPfxPassword(e.target.value)}
                    placeholder={t('cert.pfx_password_placeholder')}
                    className="h-9 text-xs"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={!pfxPassword}
                      onClick={() => {
                        void handleExport([{ location: detail.location, store: detail.store, thumbprint: detail.thumbprint, friendlyName: detail.friendlyName, subject: detail.subject }], 'pfx', pfxPassword)
                        setShowPfx(false)
                        setPfxPassword('')
                      }}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" />
                      {t('cert.export_pfx_confirm')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setShowPfx(false); setPfxPassword('') }}>
                      {t('cert.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => void handleExport([{ location: detail.location, store: detail.store, thumbprint: detail.thumbprint, friendlyName: detail.friendlyName, subject: detail.subject }], 'cer')}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    {t('cert.export_cer')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowPfx(true)}>
                    <Fingerprint className="mr-1 h-3.5 w-3.5" />
                    {t('cert.export_pfx')}
                  </Button>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive hover:bg-destructive/10"
                onClick={() =>
                  confirmDelete(
                    [{ location: detail.location, store: detail.store, thumbprint: detail.thumbprint, friendlyName: detail.friendlyName, subject: detail.subject }],
                    deleteKey,
                  )
                }
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t('cert.delete')}
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
