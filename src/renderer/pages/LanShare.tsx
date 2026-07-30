import { useEffect, useState } from 'react'
import {
  Share2,
  Network,
  Monitor,
  FolderOpen,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

interface LocalShare {
  name: string
  path: string
  description: string
  maxUsers: number | null
  type: number
  hidden: boolean
  system: boolean
}

interface RemoteShare {
  name: string
  remark: string
}

type Msg = { type: 'ok' | 'err'; text: string } | null

export default function LanShare() {
  const { t } = useI18n()
  const api = window.electronAPI

  // ── 本机共享 ──
  const [shares, setShares] = useState<LocalShare[]>([])
  const [loadingLocal, setLoadingLocal] = useState(false)
  const [localMsg, setLocalMsg] = useState<Msg>(null)

  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [readOnly, setReadOnly] = useState(true)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // ── 局域网设备 ──
  const [computers, setComputers] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [netMsg, setNetMsg] = useState<Msg>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [remoteShares, setRemoteShares] = useState<Record<string, RemoteShare[]>>({})
  const [loadingRemote, setLoadingRemote] = useState<string | null>(null)

  async function loadShares() {
    if (!api) return
    setLoadingLocal(true)
    try {
      const res = await api.invoke('lanshare:local-shares')
      if (Array.isArray(res)) setShares(res as LocalShare[])
      else setLocalMsg({ type: 'err', text: '加载本机共享失败：' + ((res as { error?: string })?.error || '') })
    } catch (e) {
      setLocalMsg({ type: 'err', text: '加载本机共享失败：' + String(e) })
    } finally {
      setLoadingLocal(false)
    }
  }

  useEffect(() => {
    void loadShares()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleBrowse() {
    if (!api) return
    const p = await api.invoke('select-directory')
    if (typeof p === 'string' && p) setNewPath(p)
  }

  async function handleCreate() {
    if (!api) return
    if (!newName.trim() || !newPath.trim()) {
      setLocalMsg({ type: 'err', text: '请填写共享名和文件夹路径' })
      return
    }
    setCreating(true)
    setLocalMsg(null)
    try {
      const res = (await api.invoke('lanshare:create', {
        name: newName.trim(),
        path: newPath.trim(),
        description: newDesc.trim(),
        readOnly,
      })) as { ok: boolean; error?: string }
      if (res.ok) {
        setLocalMsg({ type: 'ok', text: t('lanshare.created').replace('{name}', newName.trim()) })
        setNewName('')
        setNewPath('')
        setNewDesc('')
        setReadOnly(true)
        setShowForm(false)
        await loadShares()
      } else {
        setLocalMsg({ type: 'err', text: t('lanshare.create') + '失败：' + (res.error || '') })
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleRemove(name: string) {
    if (!api) return
    setLocalMsg(null)
    try {
      const res = (await api.invoke('lanshare:remove', name)) as { ok: boolean; error?: string }
      if (res.ok) {
        setLocalMsg({ type: 'ok', text: t('lanshare.removed').replace('{name}', name) })
      } else {
        setLocalMsg({ type: 'err', text: t('lanshare.removed').replace('{name}', name) + '失败：' + (res.error || '') })
      }
    } finally {
      setPendingDelete(null)
      await loadShares()
    }
  }

  async function handleScan() {
    if (!api) return
    setScanning(true)
    setNetMsg(null)
    setComputers([])
    setExpanded(null)
    setRemoteShares({})
    try {
      const res = await api.invoke('lanshare:computers')
      if (Array.isArray(res)) {
        setComputers(res as string[])
        if ((res as string[]).length === 0) setNetMsg({ type: 'ok', text: t('lanshare.no_computers') })
      } else {
        const err = (res as { error?: string })?.error || ''
        if (err === 'net-view-unavailable') setNetMsg({ type: 'err', text: t('lanshare.net_unavailable') })
        else setNetMsg({ type: 'err', text: t('lanshare.network_title') + '失败：' + err })
      }
    } finally {
      setScanning(false)
    }
  }

  async function toggleExpand(computer: string) {
    if (expanded === computer) {
      setExpanded(null)
      return
    }
    setExpanded(computer)
    if (remoteShares[computer]) return
    if (!api) return
    setLoadingRemote(computer)
    try {
      const res = await api.invoke('lanshare:remote-shares', computer)
      if (Array.isArray(res)) {
        setRemoteShares((prev) => ({ ...prev, [computer]: res as RemoteShare[] }))
      } else {
        setRemoteShares((prev) => ({ ...prev, [computer]: [] }))
        setNetMsg({ type: 'err', text: t('lanshare.remote_error') })
      }
    } finally {
      setLoadingRemote(null)
    }
  }

  async function openRemote(computer: string, name: string) {
    if (!api) return
    await api.invoke('open-path', `\\\\${computer}\\${name}`)
  }

  return (
    <div className="space-y-6">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Share2 className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('lanshare.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('lanshare.subtitle')}</p>
          </div>
        </div>
      </section>

      {/* ── 本机共享 ── */}
      <section className="glass rounded-2xl p-6 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10 text-info">
              <Network className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('lanshare.local_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('lanshare.local_desc')}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => loadShares()} disabled={loadingLocal} title={t('common.refresh')}>
              <RefreshCw className={cn('h-3.5 w-3.5', loadingLocal && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus className="h-3.5 w-3.5" /> {t('lanshare.new_share')}
            </Button>
          </div>
        </header>

        {showForm && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder={t('lanshare.share_name_ph')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="sm:w-48"
              />
              <Input
                placeholder={t('lanshare.share_path')}
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                className="flex-1"
              />
              <Button variant="outline" type="button" onClick={handleBrowse}>
                {t('lanshare.browse')}
              </Button>
            </div>
            <Input
              placeholder={t('lanshare.description_opt')}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={readOnly} onCheckedChange={(c) => setReadOnly(c)} />
                {readOnly ? t('lanshare.readonly') : t('lanshare.readwrite')}
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" onClick={handleCreate} disabled={creating}>
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {creating ? t('lanshare.creating') : t('lanshare.create')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {localMsg && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
              localMsg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive',
            )}
          >
            {localMsg.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span>{localMsg.text}</span>
          </div>
        )}

        {loadingLocal ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : shares.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('lanshare.no_local')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {shares.map((s) => (
              <div key={s.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <button
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                      onClick={() => api?.invoke('open-path', s.path)}
                      title={t('lanshare.open_folder')}
                      type="button"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">{s.name}</span>
                        {s.hidden && (
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t('lanshare.hidden_share')}
                          </span>
                        )}
                        {s.system && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                            {t('lanshare.protected_share')}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{s.path}</div>
                      {s.description && <div className="mt-1 truncate text-xs text-muted-foreground/80">{s.description}</div>}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {s.system ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cursor-not-allowed text-muted-foreground/40"
                        disabled
                        title={t('lanshare.cannot_remove')}
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : pendingDelete === s.name ? (
                      <div className="flex items-center gap-1">
                        <Button variant="destructive" size="sm" onClick={() => handleRemove(s.name)}>
                          {t('common.delete')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(s.name)}
                        title={t('common.delete')}
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {pendingDelete === s.name && (
                  <p className="mt-2 text-xs text-destructive">
                    {t('lanshare.confirm_remove').replace('{name}', s.name)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 局域网设备 ── */}
      <section className="glass rounded-2xl p-6 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10 text-info">
              <Monitor className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('lanshare.network_title')}</h2>
              <p className="text-xs text-muted-foreground">{t('lanshare.network_desc')}</p>
            </div>
          </div>
          <Button size="sm" onClick={handleScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
            {scanning ? t('lanshare.scanning') : t('lanshare.scan')}
          </Button>
        </header>

        {netMsg && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
              netMsg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive',
            )}
          >
            {netMsg.type === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span>{netMsg.text}</span>
          </div>
        )}

        {scanning ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('lanshare.scanning')}
          </div>
        ) : computers.length === 0 && !netMsg ? (
          <p className="text-sm text-muted-foreground">{t('lanshare.no_computers')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {computers.map((c) => {
              const isOpen = expanded === c
              const remotes = remoteShares[c] || []
              const count = remotes.length
              return (
                <div key={c} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted-foreground">
                        <Monitor className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{c}</div>
                        <div className="text-xs text-muted-foreground">
                          {isOpen && count > 0 ? t('lanshare.share_count').replace('{n}', String(count)) : t('lanshare.computer')}
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => toggleExpand(c)} type="button">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {isOpen ? t('lanshare.collapse') : t('lanshare.expand')}
                    </Button>
                  </div>
                  {isOpen && (
                    <div className="mt-3 space-y-1 border-t border-white/5 pt-3">
                      {loadingRemote === c ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t('common.loading')}
                        </div>
                      ) : count === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('lanshare.no_remote')}</p>
                      ) : (
                        remotes.map((rs) => (
                          <button
                            key={rs.name}
                            type="button"
                            onClick={() => openRemote(c, rs.name)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/[0.04]"
                          >
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-medium text-foreground">{rs.name}</span>
                            {rs.remark && <span className="truncate text-xs text-muted-foreground">· {rs.remark}</span>}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
