import { useEffect, useMemo, useState } from 'react'
import {
  Brain,
  Code2,
  Boxes,
  Wrench,
  Cloud,
  RefreshCw,
  Play,
  ExternalLink,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { type CliManagerProps } from '@/lib/cliTypes'

// 与主进程 cliManager.ts 对应的本地类型
interface CliTool {
  id: string
  name: string
  command: string
  category: string
  description?: string
  installed: boolean
  version: string | null
  exePath: string | null
  known: boolean
}

const CATEGORY_META: Record<string, { labelKey: string; icon: LucideIcon }> = {
  model: { labelKey: 'cli.cat_model', icon: Brain },
  coding: { labelKey: 'cli.cat_coding', icon: Code2 },
  framework: { labelKey: 'cli.cat_framework', icon: Boxes },
  tooling: { labelKey: 'cli.cat_tooling', icon: Wrench },
  cloud: { labelKey: 'cli.cat_cloud', icon: Cloud },
  other: { labelKey: 'cli.cat_other', icon: Brain },
}

export default function CliManager(props: CliManagerProps) {
  const { t } = useI18n()
  const { runs, onOpenTool, onOpenConsole } = props
  const api = window.electronAPI

  const [tools, setTools] = useState<CliTool[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  const [message, setMessage] = useState('')

  async function loadList(force = false) {
    if (!api) return
    setLoading(true)
    try {
      const list = (await api.invoke('cli:list', force)) as CliTool[]
      setTools(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categories = useMemo(() => {
    const set = new Set(tools.map((x) => x.category))
    return ['all', ...Array.from(set)]
  }, [tools])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tools.filter((x) => {
      if (onlyInstalled && !x.installed) return false
      if (catFilter !== 'all' && x.category !== catFilter) return false
      if (q) {
        const hay = `${x.name} ${x.command} ${x.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tools, search, catFilter, onlyInstalled])

  const stats = useMemo(() => {
    const installed = tools.filter((x) => x.installed).length
    const discovered = tools.filter((x) => x.installed && !x.known).length
    return { total: tools.length, installed, discovered }
  }, [tools])

  // 每个工具是否有正在后台运行的任务
  function isToolRunning(toolId: string): boolean {
    return runs.some((r) => r.toolId === toolId && r.running)
  }

  async function handleLaunchTerminal(tool: CliTool) {
    if (!api || !tool.installed) return
    const res = (await api.invoke('cli:open-terminal', tool.command)) as { ok: boolean; error?: string }
    if (!res.ok) setMessage('⚠ ' + t('cli.open_failed') + '：' + (res.error || ''))
  }

  function catIcon(cat: string): LucideIcon {
    return CATEGORY_META[cat]?.icon || Brain
  }

  return (
    <div className="space-y-6">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('cli.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('cli.subtitle')}</p>
          </div>
        </div>
      </section>

      {/* ── 统计 ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('cli.total')} value={stats.total} />
        <StatCard label={t('cli.installed')} value={stats.installed} accent="emerald" />
        <StatCard label={t('cli.discovered')} value={stats.discovered} accent="primary" />
        <StatCard label={t('cli.categories')} value={new Set(tools.map((x) => x.category)).size} accent="info" />
      </section>

      {/* ── 工具栏 ── */}
      <section className="glass rounded-2xl p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              placeholder={t('cli.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {categories.map((c) => {
                const Icon = c === 'all' ? Brain : catIcon(c)
                const label = c === 'all' ? t('cli.filter_all') : t(CATEGORY_META[c]?.labelKey || 'cli.cat_other')
                const active = catFilter === c
                return (
                  <button
                    key={c}
                    onClick={() => setCatFilter(c)}
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
            <button
              onClick={() => setOnlyInstalled((v) => !v)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all',
                onlyInstalled
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground',
              )}
            >
              {t('cli.only_installed')}
            </button>
            <Button variant="outline" size="sm" onClick={() => void loadList(true)} disabled={loading}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('cli.refresh')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── 工具网格 ── */}
      <section>
        {loading && tools.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t('cli.scanning')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t('cli.no_tools')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((tool) => {
              const Icon = catIcon(tool.category)
              const meta = CATEGORY_META[tool.category]
              const running = isToolRunning(tool.id)
              return (
                <div
                  key={tool.id}
                  className="glass flex flex-col gap-3 rounded-2xl p-4 transition-colors hover:border-primary/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                          tool.installed ? 'bg-primary/10 text-primary' : 'bg-white/5 text-muted-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{tool.name}</div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground">{tool.command}</div>
                      </div>
                    </div>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        tool.installed
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-destructive/10 text-destructive',
                      )}
                    >
                      {tool.installed ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                      {tool.installed ? t('common.enabled') : t('cli.not_installed')}
                    </span>
                  </div>

                  {tool.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                  )}

                  <div className="space-y-1 text-[11px]">
                    <Row label={t('cli.version')} value={tool.installed ? tool.version || '—' : '—'} mono />
                    {tool.exePath && (
                      <Row label={t('cli.path')} value={tool.exePath} mono title={tool.exePath} />
                    )}
                    {meta && <Row label={t('common.type')} value={t(meta.labelKey)} />}
                  </div>

                  <div className="mt-auto flex items-center gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => onOpenTool(tool)}
                      disabled={!tool.installed}
                    >
                      {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                      {running ? t('cli.keep_running') : t('cli.run')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleLaunchTerminal(tool)}
                      disabled={!tool.installed}
                      title={t('cli.open_terminal')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {running && (
                    <button
                      className="text-left text-[10px] text-emerald-400/80 hover:text-emerald-400"
                      onClick={onOpenConsole}
                    >
                      ↳ {t('cli.keep_running')} · {t('cli.tasks_indicator')}
                    </button>
                  )}

                  {!tool.installed && (
                    <p className="text-[10px] text-muted-foreground/70">{t('cli.install_hint')}</p>
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

function StatCard({ label, value, accent }: { label: string; value: number; accent?: 'primary' | 'emerald' | 'info' }) {
  const color =
    accent === 'emerald'
      ? 'text-emerald-400'
      : accent === 'info'
        ? 'text-info'
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
