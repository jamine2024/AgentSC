import { useEffect, useMemo, useState } from 'react'
import {
  MousePointerClick,
  RefreshCw,
  Search,
  Ban,
  Power,
  Trash2,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  X,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { ContextMenuEntry, ContextMenuBackup } from '@/lib/systemTypes'

type Filter = 'all' | 'enabled' | 'disabled'

export default function ContextMenu() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [items, setItems] = useState<ContextMenuEntry[]>([])
  const [backups, setBackups] = useState<ContextMenuBackup[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [toDelete, setToDelete] = useState<ContextMenuEntry | null>(null)

  const load = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const [list, bk] = await Promise.all([
        api?.invoke('ctxmenu:list'),
        api?.invoke('ctxmenu:backups'),
      ])
      if (Array.isArray(list)) setItems(list as ContextMenuEntry[])
      else if (list && typeof list === 'object' && (list as { error?: string }).error)
        setMsg({ ok: false, text: String((list as { error: string }).error) })
      if (Array.isArray(bk)) setBackups(bk as ContextMenuBackup[])
    } catch (e) {
      setMsg({ ok: false, text: String(e) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (filter === 'enabled' && i.disabled) return false
      if (filter === 'disabled' && !i.disabled) return false
      if (q) {
        return (
          i.label.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          (i.command || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [items, search, filter])

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

  const toggle = (item: ContextMenuEntry) =>
    act(item.name, () => api!.invoke('ctxmenu:set-enabled', { root: item.root, name: item.name, disable: !item.disabled }), t('ctxmenu.toggle'))

  const confirmDelete = async () => {
    if (!toDelete) return
    const target = toDelete
    setToDelete(null)
    await act(target.name, () => api!.invoke('ctxmenu:delete', { root: target.root, name: target.name }), t('ctxmenu.delete'))
  }

  const restore = (b: ContextMenuBackup) =>
    act(b.name, () => api!.invoke('ctxmenu:restore', { root: b.root, name: b.name }), t('ctxmenu.restore'))

  const rootLabel = (root: string): string => {
    if (root.includes('*\\shell')) return t('ctxmenu.root_file')
    if (root.includes('*\\shellex')) return t('ctxmenu.root_file_handler')
    if (root.includes('Directory\\Background')) return t('ctxmenu.root_bg')
    if (root.includes('Directory\\shell')) return t('ctxmenu.root_dir')
    if (root.includes('Folder\\shell')) return t('ctxmenu.root_folder')
    if (root.includes('Drive\\shell')) return t('ctxmenu.root_drive')
    return root
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MousePointerClick className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('ctxmenu.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('ctxmenu.subtitle')}</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('ctxmenu.refresh')}
          </Button>
        </div>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t('ctxmenu.warning')}</span>
      </div>

      <section className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('ctxmenu.search_placeholder')} className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'enabled', 'disabled'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                filter === f ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`ctxmenu.filter_${f}`)}
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
                <th className="px-4 py-2.5 font-medium">{t('ctxmenu.col_name')}</th>
                <th className="px-3 py-2.5 font-medium">{t('ctxmenu.col_type')}</th>
                <th className="px-3 py-2.5 font-medium">{t('ctxmenu.col_location')}</th>
                <th className="px-3 py-2.5 font-medium">{t('ctxmenu.col_status')}</th>
                <th className="px-3 py-2.5 font-medium max-w-[220px]">{t('ctxmenu.col_command')}</th>
                <th className="px-4 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={`${item.root}/${item.name}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground">{item.label}</div>
                    <div className="text-[10px] text-muted-foreground/60">{item.name}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', item.type === 'shell' ? 'bg-primary/10 text-primary' : 'bg-info/10 text-info')}>
                      {item.type === 'shell' ? t('ctxmenu.type_shell') : t('ctxmenu.type_handler')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-muted-foreground" title={item.root}>{rootLabel(item.root)}</td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', item.disabled ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400')}>
                      {item.disabled ? t('ctxmenu.disabled') : t('ctxmenu.enabled')}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[220px] truncate text-muted-foreground" title={item.command}>{item.command || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-amber-400 hover:bg-amber-500/10" disabled={busy === item.name} onClick={() => toggle(item)}>
                        {item.disabled ? <Power className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-red-400 hover:bg-red-500/10" disabled={busy === item.name} onClick={() => setToDelete(item)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    {loading ? t('ctxmenu.loading') : items.length === 0 ? t('ctxmenu.no_items') : t('ctxmenu.no_match')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {backups.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('ctxmenu.backup_title')}（{backups.length}）</h3>
          <div className="glass rounded-2xl border border-white/5 p-3">
            <div className="space-y-1.5">
              {backups.map((b) => (
                <div key={`${b.root}/${b.name}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                  <RotateCcw className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span className="flex-1 truncate text-xs text-foreground">{b.name}</span>
                  <span className="text-[10px] text-muted-foreground">{rootLabel(b.root)}</span>
                  <Button size="sm" variant="ghost" className="h-6 text-emerald-400 hover:bg-emerald-500/10" disabled={busy === b.name} onClick={() => restore(b)}>
                    <RotateCcw className="h-3 w-3" />
                    {t('ctxmenu.restore')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[420px] rounded-2xl border border-white/10 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h3 className="text-sm font-semibold">{t('ctxmenu.delete_confirm_title')}</h3>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setToDelete(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{t('ctxmenu.delete_confirm_desc', { name: toDelete.label })}</p>
            <p className="mb-4 text-[11px] text-muted-foreground/60">{t('ctxmenu.delete_confirm_note')}</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setToDelete(null)}>{t('common.cancel')}</Button>
              <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={busy === toDelete.name}>
                <Trash2 className={cn('h-3.5 w-3.5', busy === toDelete.name && 'animate-pulse')} />
                {t('ctxmenu.delete_confirm_ok')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
