import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  RefreshCw,
  Search,
  Play,
  Ban,
  CheckCircle2,
  Trash2,
  Plus,
  AlertTriangle,
  X,
  Power,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { WinTask, WinTaskCreateOptions } from '@/lib/systemTypes'

type Filter = 'all' | 'enabled' | 'disabled'

export default function WinTaskScheduler() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [tasks, setTasks] = useState<WinTask[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [toDelete, setToDelete] = useState<WinTask | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<WinTaskCreateOptions>({
    name: '',
    command: '',
    scheduleType: 'DAILY',
    modifier: '1',
    startTime: '09:00',
    day: 'MON',
    force: true,
  })
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const r = await api?.invoke('wintask:list')
      if (Array.isArray(r)) setTasks(r as WinTask[])
      else if (r && typeof r === 'object' && (r as { error?: string }).error) setMsg({ ok: false, text: String((r as { error: string }).error) })
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
    return tasks.filter((t) => {
      if (filter === 'enabled' && !t.enabled) return false
      if (filter === 'disabled' && t.enabled) return false
      if (q) {
        return (
          t.name.toLowerCase().includes(q) ||
          (t.command || '').toLowerCase().includes(q) ||
          (t.author || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [tasks, search, filter])

  const act = async (name: string, fn: () => Promise<any>, label: string) => {
    setBusy(name)
    setMsg(null)
    try {
      const r = await fn()
      if (r.ok) {
        setMsg({ ok: true, text: `${label}：${r.message}` })
        await load()
      } else {
        setMsg({ ok: false, text: `${label}失败：${r.message}` })
      }
    } catch (e) {
      setMsg({ ok: false, text: `${label}失败：${String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const toggle = (task: WinTask) =>
    act(task.name, () => api!.invoke('wintask:set-enabled', task.name, !task.enabled), t('wintask.toggle'))

  const run = (task: WinTask) => act(task.name, () => api!.invoke('wintask:run', task.name), t('wintask.run'))

  const confirmDelete = async () => {
    if (!toDelete) return
    const name = toDelete.name
    setToDelete(null)
    await act(name, () => api!.invoke('wintask:delete', name), t('wintask.delete'))
  }

  const create = async () => {
    if (!form.name.trim() || !form.command.trim()) {
      setMsg({ ok: false, text: t('wintask.form_required') })
      return
    }
    setCreating(true)
    setMsg(null)
    try {
      const r = (await api?.invoke('wintask:create', form)) as { ok: boolean; message: string }
      if (r.ok) {
        setMsg({ ok: true, text: `${t('wintask.create')}：${r.message}` })
        setCreateOpen(false)
        setForm({ name: '', command: '', scheduleType: 'DAILY', modifier: '1', startTime: '09:00', day: 'MON', force: true })
        await load()
      } else {
        setMsg({ ok: false, text: `${t('wintask.create')}失败：${r.message}` })
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) })
    } finally {
      setCreating(false)
    }
  }

  const stats = [
    { icon: CalendarClock, label: t('wintask.total'), value: tasks.length, color: 'text-primary', bg: 'bg-primary/10' },
    { icon: Power, label: t('wintask.enabled'), value: tasks.filter((t) => t.enabled).length, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { icon: Ban, label: t('wintask.disabled'), value: tasks.filter((t) => !t.enabled).length, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ]

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('wintask.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('wintask.subtitle')}</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('wintask.refresh')}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('wintask.create')}
          </Button>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('wintask.search_placeholder')} className="pl-9" />
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
              {t(`wintask.filter_${f}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.label} className="glass rounded-2xl border border-white/5 p-4">
              <div className="flex items-center gap-2.5">
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', s.bg, s.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
              <div className="mt-2 text-xl font-semibold tracking-tight">{s.value}</div>
            </div>
          )
        })}
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
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t('wintask.col_name')}</th>
                <th className="px-3 py-2.5 font-medium">{t('wintask.col_status')}</th>
                <th className="px-3 py-2.5 font-medium">{t('wintask.col_next')}</th>
                <th className="px-3 py-2.5 font-medium">{t('wintask.col_last')}</th>
                <th className="px-3 py-2.5 font-medium">{t('wintask.col_command')}</th>
                <th className="px-4 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr key={task.name} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground">{task.taskName}</div>
                    <div className="text-[10px] text-muted-foreground/70">{task.folder || '\\'}</div>
                    {task.author && <div className="text-[10px] text-muted-foreground/50">{task.author}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        task.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400',
                      )}
                    >
                      {task.enabled ? t('wintask.enabled') : t('wintask.disabled')}
                    </span>
                    {task.lastResult && task.lastResult !== '0' && (
                      <span className="ml-1 text-[10px] text-red-400/70">({t('wintask.last_result')}: {task.lastResult})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{task.nextRun || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{task.lastRun || '—'}</td>
                  <td className="px-3 py-2 max-w-[240px] truncate text-muted-foreground" title={task.command}>{task.command || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-primary hover:bg-primary/10" disabled={busy === task.name} onClick={() => run(task)}>
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-amber-400 hover:bg-amber-500/10" disabled={busy === task.name} onClick={() => toggle(task)}>
                        {task.enabled ? <Ban className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-red-400 hover:bg-red-500/10" disabled={busy === task.name} onClick={() => setToDelete(task)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    {loading ? t('wintask.refreshing') : tasks.length === 0 ? t('wintask.no_tasks') : t('wintask.no_match')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 删除确认 */}
      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[400px] rounded-2xl border border-white/10 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h3 className="text-sm font-semibold">{t('wintask.delete_confirm_title')}</h3>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setToDelete(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{t('wintask.delete_confirm_desc', { name: toDelete.name })}</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setToDelete(null)}>{t('common.cancel')}</Button>
              <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={busy === toDelete.name}>
                <Trash2 className={cn('h-3.5 w-3.5', busy === toDelete.name && 'animate-pulse')} />
                {t('wintask.delete_confirm_ok')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 新建任务 */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[460px] rounded-2xl border border-white/10 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold">{t('wintask.create')}</h3>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setCreateOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">{t('wintask.form_name')}</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('wintask.form_name_ph')} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">{t('wintask.form_command')}</label>
                <Input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder={t('wintask.form_command_ph')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">{t('wintask.form_schedule')}</label>
                  <select
                    value={form.scheduleType}
                    onChange={(e) => setForm({ ...form, scheduleType: e.target.value as WinTaskCreateOptions['scheduleType'] })}
                    className="w-full rounded-lg border border-white/10 bg-card px-2.5 py-1.5 text-xs text-foreground"
                  >
                    {(['MINUTE', 'HOURLY', 'DAILY', 'WEEKLY', 'ONLOGON', 'ONSTART', 'ONCE'] as const).map((s) => (
                      <option key={s} value={s}>{t(`wintask.sched_${s.toLowerCase()}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">{t('wintask.form_start')}</label>
                  <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                </div>
              </div>
              {(form.scheduleType === 'MINUTE' || form.scheduleType === 'HOURLY' || form.scheduleType === 'DAILY' || form.scheduleType === 'WEEKLY') && (
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    {form.scheduleType === 'WEEKLY' ? t('wintask.form_day') : t('wintask.form_interval')}
                  </label>
                  {form.scheduleType === 'WEEKLY' ? (
                    <select
                      value={form.day}
                      onChange={(e) => setForm({ ...form, day: e.target.value })}
                      className="w-full rounded-lg border border-white/10 bg-card px-2.5 py-1.5 text-xs text-foreground"
                    >
                      {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => (
                        <option key={d} value={d}>{t(`wintask.day_${d.toLowerCase()}`)}</option>
                      ))}
                    </select>
                  ) : (
                    <Input type="number" min={1} value={form.modifier} onChange={(e) => setForm({ ...form, modifier: e.target.value })} />
                  )}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => void create()} disabled={creating}>
                <CheckCircle2 className={cn('h-3.5 w-3.5', creating && 'animate-pulse')} />
                {creating ? t('wintask.creating') : t('wintask.create_confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
