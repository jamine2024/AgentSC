import { useEffect, useMemo, useState } from 'react'
import {
  Blocks,
  Box,
  Package,
  Boxes,
  Database,
  Hammer,
  Container,
  Cloud,
  GitBranch,
  Wrench,
  Search,
  RefreshCw,
  FolderOpen,
  TerminalSquare,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

// 与主进程 devTools.ts 对应的本地类型
interface DevTool {
  id: string
  name: string
  category: string
  description?: string
  installed: boolean
  version: string | null
  installPath: string | null
  publisher?: string | null
  command?: string | null
  known: boolean
  source: 'cli' | 'registry' | 'known'
}

const CATEGORY_META: Record<string, { labelKey: string; icon: LucideIcon }> = {
  ide: { labelKey: 'devtools.cat_ide', icon: Blocks },
  runtime: { labelKey: 'devtools.cat_runtime', icon: Box },
  sdk: { labelKey: 'devtools.cat_sdk', icon: Package },
  db: { labelKey: 'devtools.cat_db', icon: Database },
  build: { labelKey: 'devtools.cat_build', icon: Hammer },
  container: { labelKey: 'devtools.cat_container', icon: Container },
  package: { labelKey: 'devtools.cat_package', icon: Boxes },
  cloud: { labelKey: 'devtools.cat_cloud', icon: Cloud },
  vcs: { labelKey: 'devtools.cat_vcs', icon: GitBranch },
  other: { labelKey: 'devtools.cat_other', icon: Wrench },
}

// 计算「打开安装位置」应显示的路径：文件→取其所在目录，目录→原样
function revealPath(p: string): string {
  if (/\.(exe|cmd|bat|ps1|msi|dll|lnk|app)$/i.test(p)) {
    return p.replace(/[\\/][^\\/]*$/, '')
  }
  return p
}

export default function DevTools() {
  const api = window.electronAPI
  const { t } = useI18n()

  const [tools, setTools] = useState<DevTool[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  const [message, setMessage] = useState('')

  async function loadList(force = false) {
    if (!api) return
    setLoading(true)
    try {
      const list = (await api.invoke('devtools:list', force)) as DevTool[]
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
    const set = new Set(tools.filter((x) => x.installed).map((x) => x.category))
    return ['all', ...Array.from(set)]
  }, [tools])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tools.filter((x) => {
      if (onlyInstalled && !x.installed) return false
      if (catFilter !== 'all' && x.category !== catFilter) return false
      if (q) {
        const hay = `${x.name} ${x.publisher || ''} ${x.command || ''} ${x.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tools, search, catFilter, onlyInstalled])

  const stats = useMemo(() => {
    const installed = tools.filter((x) => x.installed).length
    const ides = tools.filter((x) => x.installed && x.category === 'ide').length
    const discovered = tools.filter((x) => x.installed && !x.known).length
    return { total: tools.length, installed, ides, discovered }
  }, [tools])

  async function handleOpenLocation(tool: DevTool) {
    if (!api || !tool.installPath) return
    const res = (await api.invoke('open-path', revealPath(tool.installPath))) as boolean
    if (!res) setMessage('⚠ ' + t('devtools.open_failed'))
  }

  async function handleLaunchTerminal(tool: DevTool) {
    if (!api || !tool.command) return
    const res = (await api.invoke('cli:open-terminal', tool.command)) as { ok: boolean; error?: string }
    if (!res.ok) setMessage('⚠ ' + t('devtools.open_failed') + '：' + (res.error || ''))
  }

  function catIcon(cat: string): LucideIcon {
    return CATEGORY_META[cat]?.icon || Wrench
  }

  return (
    <div className="space-y-6">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Blocks className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('devtools.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('devtools.subtitle')}</p>
          </div>
        </div>
      </section>

      {/* ── 统计 ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('devtools.total')} value={stats.total} />
        <StatCard label={t('devtools.installed')} value={stats.installed} accent="emerald" />
        <StatCard label={t('devtools.ide_count')} value={stats.ides} accent="primary" />
        <StatCard label={t('devtools.discovered')} value={stats.discovered} accent="info" />
      </section>

      {/* ── 工具栏 ── */}
      <section className="glass rounded-2xl border border-white/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              placeholder={t('devtools.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {categories.map((c) => {
                const Icon = c === 'all' ? Blocks : catIcon(c)
                const label = c === 'all' ? t('devtools.filter_all') : t(CATEGORY_META[c]?.labelKey || 'devtools.cat_other')
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
              {t('devtools.only_installed')}
            </button>
            <Button variant="outline" size="sm" onClick={() => void loadList(true)} disabled={loading}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('devtools.refresh')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── 工具网格 ── */}
      <section>
        {loading && tools.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t('devtools.scanning')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t('devtools.no_tools')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((tool) => {
              const Icon = catIcon(tool.category)
              const meta = CATEGORY_META[tool.category]
              return (
                <div
                  key={tool.id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:border-white/10"
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
                        {tool.command && (
                          <div className="truncate font-mono text-[10px] text-muted-foreground">{tool.command}</div>
                        )}
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
                      {tool.installed ? t('common.enabled') : t('devtools.not_installed')}
                    </span>
                  </div>

                  {tool.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                  )}

                  <div className="space-y-1 text-[11px]">
                    <Row label={t('devtools.version')} value={tool.installed ? tool.version || '—' : '—'} mono />
                    {tool.installPath && (
                      <Row label={t('devtools.path')} value={tool.installPath} mono title={tool.installPath} />
                    )}
                    {tool.publisher && <Row label={t('devtools.publisher')} value={tool.publisher} title={tool.publisher} />}
                    {meta && <Row label={t('common.type')} value={t(meta.labelKey)} />}
                  </div>

                  <div className="mt-auto flex items-center gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => void handleOpenLocation(tool)}
                      disabled={!tool.installed || !tool.installPath}
                    >
                      <FolderOpen className="mr-1 h-3.5 w-3.5" />
                      {t('devtools.open_location')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleLaunchTerminal(tool)}
                      disabled={!tool.installed || !tool.command}
                      title={t('devtools.open_terminal')}
                    >
                      <TerminalSquare className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {!tool.installed && (
                    <p className="text-[10px] text-muted-foreground/70">{t('devtools.install_hint')}</p>
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
    <div className="glass rounded-2xl border border-white/5 p-4">
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
