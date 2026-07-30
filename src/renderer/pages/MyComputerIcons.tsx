import { useEffect, useMemo, useState } from 'react'
import {
  HardDrive,
  RefreshCw,
  Search,
  Trash2,
  RotateCcw,
  Cloud,
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
  X,
  ShieldAlert,
  Folder,
  Globe,
  AppWindow,
  FileText,
  Plus,
  FolderPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { PcIcon, PcIconBackup, PcIconCategory, CustomEntry, CustomEntryType } from '@/lib/systemTypes'

type Filter = 'all' | PcIconCategory

export default function MyComputerIcons() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [icons, setIcons] = useState<PcIcon[]>([])
  const [backups, setBackups] = useState<PcIconBackup[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [toRemove, setToRemove] = useState<PcIcon | null>(null)

  // 自定义快捷入口
  const [custom, setCustom] = useState<CustomEntry[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<{ type: CustomEntryType; name: string; target: string; iconPath: string }>({
    type: 'folder',
    name: '',
    target: '',
    iconPath: '',
  })
  const [pickLoading, setPickLoading] = useState<'target' | 'icon' | null>(null)
  const [toRemoveCustom, setToRemoveCustom] = useState<CustomEntry | null>(null)

  const load = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const [list, bk] = await Promise.all([
        api?.invoke('pcicons:list'),
        api?.invoke('pcicons:backups'),
      ])
      if (Array.isArray(list)) setIcons(list as PcIcon[])
      else if (list && typeof list === 'object' && (list as { error?: string }).error)
        setMsg({ ok: false, text: String((list as { error: string }).error) })
      if (Array.isArray(bk)) setBackups(bk as PcIconBackup[])
    } catch (e) {
      setMsg({ ok: false, text: String(e) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void loadCustom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadCustom = async () => {
    try {
      const list = await api?.invoke('pcicons:custom:list')
      if (Array.isArray(list)) setCustom(list as CustomEntry[])
    } catch {
      /* ignore */
    }
  }

  const submitAdd = async () => {
    if (!form.name.trim() || !form.target.trim()) {
      setMsg({ ok: false, text: t('pcicons.custom_add_err') + '：名称与目标都不能为空' })
      return
    }
    setAdding(true)
    setMsg(null)
    try {
      const r = await api!.invoke('pcicons:custom:add', {
        name: form.name.trim(),
        type: form.type,
        target: form.target.trim(),
        iconPath: form.iconPath.trim() || undefined,
      })
      if (r && r.ok) {
        setMsg({ ok: true, text: t('pcicons.custom_add_ok') })
        setShowAdd(false)
        setForm({ type: 'folder', name: '', target: '', iconPath: '' })
        await loadCustom()
      } else {
        setMsg({ ok: false, text: (r && r.message) || t('pcicons.custom_add_err') })
      }
    } catch (e) {
      setMsg({ ok: false, text: t('pcicons.custom_add_err') + '：' + String(e) })
    } finally {
      setAdding(false)
    }
  }

  const pick = async (which: 'target' | 'icon') => {
    setPickLoading(which)
    try {
      const kind: 'folder' | 'file' = which === 'icon' ? 'file' : form.type === 'folder' ? 'folder' : 'file'
      const exts = form.type === 'exe' && which === 'target' ? ['exe'] : undefined
      // 把当前已填路径作为默认打开位置，对话框直接从该目录开始，避免扫描桌面/下载等位置。
      const defaultPath = which === 'target' ? form.target || undefined : form.iconPath || undefined
      const r = await api!.invoke('pcicons:pick', kind, exts, defaultPath)
      if (r && !r.canceled && r.path) {
        if (which === 'target') setForm((f) => ({ ...f, target: r.path }))
        else setForm((f) => ({ ...f, iconPath: r.path }))
      }
    } catch {
      /* ignore */
    } finally {
      setPickLoading(null)
    }
  }

  const confirmRemoveCustom = async () => {
    if (!toRemoveCustom) return
    const g = toRemoveCustom.guid
    setToRemoveCustom(null)
    setBusy(g)
    setMsg(null)
    try {
      const r = await api!.invoke('pcicons:custom:remove', g)
      if (r && r.ok) {
        setMsg({ ok: true, text: t('pcicons.custom_remove_ok') })
        await loadCustom()
      } else {
        setMsg({ ok: false, text: (r && r.message) || t('pcicons.custom_remove_ok') })
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) })
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return icons.filter((i) => {
      if (filter !== 'all' && i.category !== filter) return false
      if (q && !i.name.toLowerCase().includes(q) && !i.guid.toLowerCase().includes(q)) return false
      return true
    })
  }, [icons, search, filter])

  const act = async (key: string, fn: () => Promise<any>, label: string) => {
    setBusy(key)
    setMsg(null)
    try {
      const r = await fn()
      setMsg({ ok: r.ok, text: `${label}：${r.message}` })
      if (r.ok) await load()
    } catch (e) {
      setMsg({ ok: false, text: `${label}失败：${String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const confirmRemove = async () => {
    if (!toRemove) return
    const target = toRemove
    setToRemove(null)
    await act(target.guid, () => api!.invoke('pcicons:remove', { parent: target.parent, guid: target.guid }), t('pcicons.remove'))
  }

  const restore = (b: PcIconBackup) =>
    act(b.guid, () => api!.invoke('pcicons:restore', { parent: b.parent, guid: b.guid }), t('pcicons.restore'))

  const categoryStyle: Record<PcIconCategory, { color: string; bg: string; label: string }> = {
    cloud: { color: 'text-sky-400', bg: 'bg-sky-500/10', label: t('pcicons.cat_cloud') },
    folder: { color: 'text-amber-400', bg: 'bg-amber-500/10', label: t('pcicons.cat_folder') },
    system: { color: 'text-muted-foreground', bg: 'bg-white/5', label: t('pcicons.cat_system') },
    other: { color: 'text-muted-foreground', bg: 'bg-white/5', label: t('pcicons.cat_other') },
  }

  const customTypeMeta: Record<CustomEntryType, { icon: typeof Folder; label: string; color: string }> = {
    folder: { icon: Folder, label: t('pcicons.custom_type_folder'), color: 'text-amber-400 bg-amber-500/10' },
    exe: { icon: AppWindow, label: t('pcicons.custom_type_exe'), color: 'text-emerald-400 bg-emerald-500/10' },
    url: { icon: Globe, label: t('pcicons.custom_type_url'), color: 'text-sky-400 bg-sky-500/10' },
    file: { icon: FileText, label: t('pcicons.custom_type_file'), color: 'text-violet-400 bg-violet-500/10' },
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HardDrive className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('pcicons.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('pcicons.subtitle')}</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('pcicons.refresh')}
          </Button>
        </div>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t('pcicons.warning')}</span>
      </div>

      <section className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('pcicons.search_placeholder')} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'cloud', 'folder', 'system', 'other'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                filter === f ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'all' ? t('pcicons.filter_all') : categoryStyle[f].label}
            </button>
          ))}
        </div>
      </section>

      {msg && (
        <div className={cn('rounded-lg px-3 py-2 text-xs', msg.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
          <span className="flex items-center gap-1.5">
            {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {msg.text}
          </span>
        </div>
      )}

      <section className="glass rounded-2xl border border-white/5 p-0 overflow-hidden">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t('pcicons.col_name')}</th>
                <th className="px-3 py-2.5 font-medium">{t('pcicons.col_category')}</th>
                <th className="px-3 py-2.5 font-medium">{t('pcicons.col_guid')}</th>
                <th className="px-3 py-2.5 font-medium">{t('pcicons.col_location')}</th>
                <th className="px-4 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((icon) => {
                const cs = categoryStyle[icon.category]
                const Icon = icon.category === 'cloud' ? Cloud : icon.category === 'folder' ? FolderOpen : HardDrive
                return (
                  <tr key={`${icon.parent}/${icon.guid}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('h-4 w-4 shrink-0', cs.color)} />
                        <div className="font-medium text-foreground">{icon.name}</div>
                      </div>
                      {icon.description && <div className="mt-0.5 text-[10px] text-muted-foreground/60">{icon.description}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', cs.bg, cs.color)}>
                        {cs.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[180px] truncate font-mono text-[10px] text-muted-foreground" title={icon.guid}>{icon.guid}</td>
                    <td className="px-3 py-2 text-muted-foreground">{icon.parent}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-red-400 hover:bg-red-500/10"
                        disabled={busy === icon.guid}
                        onClick={() => setToRemove(icon)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('pcicons.remove')}
                      </Button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    {loading ? t('pcicons.loading') : icons.length === 0 ? t('pcicons.no_icons') : t('pcicons.no_match')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {backups.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('pcicons.backup_title')}（{backups.length}）</h3>
          <div className="glass rounded-2xl border border-white/5 p-3">
            <div className="space-y-1.5">
              {backups.map((b) => (
                <div key={`${b.parent}/${b.guid}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                  <RotateCcw className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span className="flex-1 truncate text-xs text-foreground">{b.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{b.guid}</span>
                  <Button size="sm" variant="ghost" className="h-6 text-emerald-400 hover:bg-emerald-500/10" disabled={busy === b.guid} onClick={() => restore(b)}>
                    <RotateCcw className="h-3 w-3" />
                    {t('pcicons.restore')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FolderPlus className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('pcicons.custom_title')}</h2>
            <p className="text-xs text-muted-foreground">{t('pcicons.custom_subtitle')}</p>
          </div>
          <Button size="sm" className="ml-auto" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('pcicons.custom_add')}
          </Button>
        </div>

        <div className="glass rounded-2xl border border-white/5 p-4">
          {custom.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">{t('pcicons.custom_empty')}</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {custom.map((e) => {
                const m = customTypeMeta[e.type]
                const Icon = m.icon
                return (
                  <div key={e.guid} className="group flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:bg-white/[0.04]">
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', m.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">{e.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', m.color)}>{m.label}</span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground" title={e.target}>{e.target}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-red-400 hover:bg-red-500/10" disabled={busy === e.guid} onClick={() => setToRemoveCustom(e)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/70">{t('pcicons.custom_restart_note')}</p>
      </section>

      {toRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[420px] rounded-2xl border border-white/10 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h3 className="text-sm font-semibold">{t('pcicons.remove_confirm_title')}</h3>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setToRemove(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{t('pcicons.remove_confirm_desc', { name: toRemove.name })}</p>
            <p className="mb-4 text-[11px] text-muted-foreground/60">{t('pcicons.remove_confirm_note')}</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setToRemove(null)}>{t('common.cancel')}</Button>
              <Button size="sm" variant="destructive" onClick={() => void confirmRemove()} disabled={busy === toRemove.guid}>
                <Trash2 className={cn('h-3.5 w-3.5', busy === toRemove.guid && 'animate-pulse')} />
                {t('pcicons.remove_confirm_ok')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[460px] rounded-2xl border border-white/10 p-5">
            <div className="mb-4 flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold">{t('pcicons.custom_add')}</h3>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setShowAdd(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('pcicons.custom_type')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(customTypeMeta) as CustomEntryType[]).map((tp) => {
                    const m = customTypeMeta[tp]
                    const Icon = m.icon
                    return (
                      <button
                        key={tp}
                        onClick={() => setForm((f) => ({ ...f, type: tp }))}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition',
                          form.type === tp ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-white/5 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className={cn('h-3.5 w-3.5', form.type === tp ? 'text-primary' : '')} />
                        {m.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('pcicons.custom_name')}</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t('pcicons.custom_name_ph')}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('pcicons.custom_target')}</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={form.target}
                    onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                    placeholder={
                      form.type === 'folder'
                        ? t('pcicons.custom_target_ph_folder')
                        : form.type === 'exe'
                          ? t('pcicons.custom_target_ph_exe')
                          : form.type === 'file'
                            ? t('pcicons.custom_target_ph_file')
                            : t('pcicons.custom_target_ph_url')
                    }
                    disabled={form.type === 'url'}
                  />
                  {form.type !== 'url' && (
                    <Button size="sm" variant="outline" onClick={() => void pick('target')} disabled={pickLoading === 'target'}>
                      <Search className={cn('h-3.5 w-3.5', pickLoading === 'target' && 'animate-spin')} />
                      {t('pcicons.custom_browse')}
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('pcicons.custom_icon')}</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={form.iconPath}
                    onChange={(e) => setForm((f) => ({ ...f, iconPath: e.target.value }))}
                    placeholder=".ico / .exe / 留空取默认"
                  />
                  <Button size="sm" variant="outline" onClick={() => void pick('icon')} disabled={pickLoading === 'icon'}>
                    <Search className={cn('h-3.5 w-3.5', pickLoading === 'icon' && 'animate-spin')} />
                    {t('pcicons.custom_browse')}
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => void submitAdd()} disabled={adding}>
                <Plus className={cn('h-3.5 w-3.5', adding && 'animate-spin')} />
                {adding ? t('pcicons.custom_adding') : t('pcicons.custom_confirm_add')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {toRemoveCustom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[420px] rounded-2xl border border-white/10 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h3 className="text-sm font-semibold">{t('pcicons.custom_remove_confirm_title')}</h3>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setToRemoveCustom(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              {t('pcicons.custom_remove_confirm_desc', { name: toRemoveCustom.name })}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setToRemoveCustom(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void confirmRemoveCustom()} disabled={busy === toRemoveCustom.guid}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('pcicons.remove')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
