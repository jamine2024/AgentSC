import { useEffect, useMemo, useState } from 'react'
import {
  Sparkles, Clock, History, Trash2, FolderOpen, Globe, MemoryStick, X, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

type CleanerType = 'recycle_bin' | 'ie_history' | 'temp_dir' | 'browser_cache' | 'custom'

interface CleanerRule {
  id?: number
  name: string
  type: CleanerType
  target?: string
  patterns?: string | null
  schedule: string
  enabled?: number
  last_run?: number | null
  next_run?: number | null
  created_at?: number
  external_id?: string | null
}

interface CleanerResult {
  success: boolean
  freedBytes: number
  message: string
}

interface CleanerLog {
  id?: number
  rule_id?: number
  type: string
  name: string
  status: 'success' | 'failed'
  message?: string
  freed_bytes?: number
  started_at: number
  finished_at?: number
}

const typeIcons: Record<CleanerType, React.ElementType> = {
  recycle_bin: Trash2,
  ie_history: History,
  temp_dir: MemoryStick,
  browser_cache: Globe,
  custom: FolderOpen,
}

const typeClasses: Record<CleanerType, string> = {
  recycle_bin: 'bg-destructive/10 text-destructive',
  ie_history: 'bg-blue-500/10 text-blue-400',
  temp_dir: 'bg-amber-500/10 text-amber-400',
  browser_cache: 'bg-purple-500/10 text-purple-400',
  custom: 'bg-emerald-500/10 text-emerald-400',
}

function QuickCard({
  title,
  desc,
  type,
  target,
  onResult,
}: {
  title: string
  desc: string
  type: CleanerType
  target?: string
  onResult: (r: CleanerResult) => void
}) {
  const api = window.electronAPI
  const { t } = useI18n()
  const [running, setRunning] = useState(false)
  const Icon = typeIcons[type]

  async function handleRun() {
    setRunning(true)
    try {
      const result = (await api?.invoke('run-cleaner-task', type, target)) as CleanerResult
      onResult(result)
    } catch (err) {
      onResult({ success: false, freedBytes: 0, message: 'Error: ' + String(err) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="glass flex flex-col justify-between rounded-2xl border border-white/5 p-4 transition hover:scale-[1.01]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
        </div>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl', typeClasses[type])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <Button className="mt-4 w-full" size="sm" onClick={handleRun} disabled={running}>
        {running ? t('cleaner.cleaning') : t('cleaner.clean_now')}
      </Button>
    </div>
  )
}

export default function Cleaner() {
  const api = window.electronAPI
  const { t } = useI18n()
  const [rules, setRules] = useState<CleanerRule[]>([])
  const [logs, setLogs] = useState<CleanerLog[]>([])
  const [logPage, setLogPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)
  const [logTotalPages, setLogTotalPages] = useState(0)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [schedulePreset, setSchedulePreset] = useState('0 0 * * *')
  const [customSchedule, setCustomSchedule] = useState('0 0 * * *')
  const [message, setMessage] = useState('')
  const [runningRuleId, setRunningRuleId] = useState<number | null>(null)

  const typeLabels = useMemo(() => ({
    recycle_bin: t('cleaner.type.recycle_bin'),
    ie_history: t('cleaner.type.ie_history'),
    temp_dir: t('cleaner.type.temp_dir'),
    browser_cache: t('cleaner.type.browser_cache'),
    custom: t('cleaner.type.custom'),
  }), [t])

  const schedulePresets = useMemo(() => [
    { label: t('cleaner.schedule.hourly'), cron: '0 * * * *' },
    { label: t('cleaner.schedule.daily'), cron: '0 0 * * *' },
    { label: t('cleaner.schedule.weekly'), cron: '0 0 * * 0' },
    { label: t('cleaner.schedule.monthly'), cron: '0 0 1 * *' },
  ], [t])

  useEffect(() => {
    loadRules()
    loadLogs()
  }, [logPage])

  async function loadRules() {
    const r = await api?.invoke('get-cleaner-rules')
    if (Array.isArray(r)) setRules(r as CleanerRule[])
  }

  async function loadLogs() {
    const result = await api?.invoke('get-cleaner-logs-paginated', logPage, 15)
    if (result && typeof result === 'object') {
      const paginated = result as { items: CleanerLog[]; total: number; page: number; pageSize: number; totalPages: number }
      setLogs(paginated.items)
      setLogTotal(paginated.total)
      setLogTotalPages(paginated.totalPages)
    }
  }

  const totalFreed = useMemo(
    () => logs.reduce((sum, log) => sum + (log.freed_bytes || 0), 0),
    [logs],
  )

  const lastRun = useMemo(() => {
    const successLogs = logs.filter((l) => l.status === 'success')
    return successLogs[0]?.started_at || null
  }, [logs])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    if (!target.trim()) {
      setMessage(t('cleaner.target_required'))
      return
    }
    const scheduleExpr = schedulePreset === 'custom' ? customSchedule : schedulePreset
    try {
      await api?.invoke('add-cleaner-rule', {
        name: name.trim(),
        type: 'custom',
        target: target.trim(),
        schedule: scheduleExpr,
        enabled: 1,
      })
      setName('')
      setTarget('')
      setMessage(t('cleaner.rule_added'))
      loadRules()
    } catch (err) {
      setMessage('Error: ' + String(err))
    }
  }

  async function toggleRule(rule: CleanerRule) {
    await api?.invoke('update-cleaner-rule', {
      id: rule.id,
      rule: { enabled: rule.enabled ? 0 : 1 },
    })
    loadRules()
  }

  async function deleteRule(id: number) {
    await api?.invoke('delete-cleaner-rule', id)
    loadRules()
  }

  async function runRule(rule: CleanerRule) {
    if (rule.id === undefined) return
    setRunningRuleId(rule.id)
    try {
      const result = (await api?.invoke('run-cleaner-rule', rule)) as CleanerResult
      setMessage(result.message)
      loadRules()
      loadLogs()
    } catch (err) {
      setMessage('Error: ' + String(err))
    } finally {
      setRunningRuleId(null)
    }
  }

  async function handleQuickResult(result: CleanerResult) {
    setMessage(result.message)
    loadLogs()
  }

  function formatTime(ts?: number | null) {
    if (!ts) return '-'
    return new Date(ts).toLocaleString()
  }

  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('cleaner.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('cleaner.subtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuickCard
            title={t('cleaner.empty_recycle')}
            desc={t('cleaner.empty_recycle_desc')}
            type="recycle_bin"
            onResult={handleQuickResult}
          />
          <QuickCard
            title={t('cleaner.clear_ie')}
            desc={t('cleaner.clear_ie_desc')}
            type="ie_history"
            onResult={handleQuickResult}
          />
          <QuickCard
            title={t('cleaner.clear_temp')}
            desc={t('cleaner.clear_temp_desc')}
            type="temp_dir"
            onResult={handleQuickResult}
          />
          <QuickCard
            title={t('cleaner.clear_cache')}
            desc={t('cleaner.clear_cache_desc')}
            type="browser_cache"
            onResult={handleQuickResult}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="glass rounded-2xl border border-white/5 p-4">
          <div className="text-xs text-muted-foreground">{t('cleaner.enabled_rules')}</div>
          <div className="mt-2 text-2xl font-bold">{rules.filter((r) => r.enabled).length}</div>
        </div>
        <div className="glass rounded-2xl border border-white/5 p-4">
          <div className="text-xs text-muted-foreground">{t('cleaner.total_freed')}</div>
          <div className="mt-2 text-2xl font-bold">{formatBytes(totalFreed)}</div>
        </div>
        <div className="glass rounded-2xl border border-white/5 p-4">
          <div className="text-xs text-muted-foreground">{t('cleaner.last_success')}</div>
          <div className="mt-2 text-sm font-medium">{lastRun ? new Date(lastRun).toLocaleString() : t('cleaner.no_records')}</div>
        </div>
      </section>

      <section className="glass rounded-2xl border border-white/5 p-6">
        <h3 className="mb-1 text-sm font-semibold tracking-tight">{t('cleaner.subscribe_rules')}</h3>
        <p className="mb-4 text-xs text-muted-foreground">{t('cleaner.custom_only_hint')}</p>
        {message && (
          <p className={cn('mb-4 text-xs', message.startsWith('Error:') ? 'text-destructive' : 'text-emerald-400')}>
            {message}
          </p>
        )}

        <form onSubmit={handleAdd} className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-6">
          <Input
            placeholder={t('cleaner.rule_name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="md:col-span-2"
          />
          <div className="flex gap-2 md:col-span-2">
            <Input
              placeholder={t('cleaner.custom_path')}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const p = (await api?.invoke('select-directory')) as string | null
                if (typeof p === 'string' && p) setTarget(p)
              }}
              title={t('cleaner.select_dir')}
            >
              <FolderOpen className="mr-1 h-4 w-4" />
              {t('cleaner.select_dir')}
            </Button>
          </div>
          <select
            value={schedulePreset}
            onChange={(e) => setSchedulePreset(e.target.value)}
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-foreground outline-none focus:border-primary"
          >
            {schedulePresets.map((p) => (
              <option key={p.cron} value={p.cron}>
                {p.label}
              </option>
            ))}
            <option value="custom">{t('cleaner.custom_cron')}</option>
          </select>
          {schedulePreset === 'custom' && (
            <Input
              placeholder={t('cleaner.cron_placeholder')}
              value={customSchedule}
              onChange={(e) => setCustomSchedule(e.target.value)}
              className="md:col-span-6"
            />
          )}
          <Button type="submit" className="md:col-span-1">
            {t('cleaner.add_rule')}
          </Button>
        </form>

        <div className="space-y-2">
          {rules.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('cleaner.no_rules')}</div>
          ) : (
            rules.map((rule) => {
              const Icon = typeIcons[rule.type]
              return (
                <div
                  key={rule.id}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', typeClasses[rule.type])}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {(() => {
                            const m = rule.external_id?.match(/^builtin::([^:]+)::(.+)$/)
                            return m ? t(`cleaner.rule.${m[1]}.${m[2]}`, undefined, rule.name) : rule.name
                          })()}
                        </span>
                        {rule.external_id?.startsWith('builtin::') && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                            {t('cleaner.builtin_rule')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {typeLabels[rule.type]} · {rule.schedule}
                        {rule.patterns ? ' · ' + rule.patterns : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t('cleaner.next_run')}：{formatTime(rule.next_run)}
                    </span>
                    <span>{t('cleaner.last_run')}：{formatTime(rule.last_run)}</span>
                    <div className="flex items-center gap-2">
                      <Switch checked={!!rule.enabled} onCheckedChange={() => toggleRule(rule)} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runRule(rule)}
                        disabled={runningRuleId === rule.id}
                      >
                        {runningRuleId === rule.id ? t('cleaner.running') : t('cleaner.run_now')}
                      </Button>
                      {!rule.external_id?.startsWith('builtin::') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => rule.id !== undefined && deleteRule(rule.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight">{t('cleaner.recent_logs')} ({logTotal})</h3>
          {logTotalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={logPage <= 1} onClick={() => setLogPage(logPage - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[10px] text-muted-foreground">{logPage}/{logTotalPages}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={logPage >= logTotalPages} onClick={() => setLogPage(logPage + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        <div className="max-h-[320px] overflow-auto">
          {logs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('cleaner.no_logs')}</div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between border-b border-white/5 py-2.5 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px]',
                      log.status === 'success'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-destructive/10 text-destructive',
                    )}
                  >
                    {log.status === 'success' ? t('cleaner.success') : t('cleaner.failed')}
                  </span>
                  <span className="text-xs text-muted-foreground">{log.name}</span>
                  <span className="truncate text-xs text-muted-foreground" title={log.message}>
                    {log.message}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                  <span>{log.freed_bytes ? formatBytes(log.freed_bytes) : '-'}</span>
                  <span>{new Date(log.started_at).toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
