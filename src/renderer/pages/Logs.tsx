import { useEffect, useState } from 'react'
import { ScrollText, AlertTriangle, Info, XCircle, RefreshCw, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

interface AppLog {
  id: number
  level: 'info' | 'warn' | 'error'
  module: string
  message: string
  details?: string
  created_at: number
}

interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const PAGE_SIZE = 30

const levelConfig = {
  info: { label: 'INFO', class: 'bg-blue-500/12 text-blue-400 border border-blue-500/20' },
  warn: { label: 'WARN', class: 'bg-amber-500/12 text-amber-400 border border-amber-500/20' },
  error: { label: 'ERROR', class: 'bg-red-500/12 text-red-400 border border-red-500/20' },
}

function LogRow({ log, onExpand }: { log: AppLog; onExpand: () => void }) {
  const cfg = levelConfig[log.level]
  const Icon = log.level === 'error' ? XCircle : log.level === 'warn' ? AlertTriangle : Info
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-white/[0.04] py-2 last:border-0 transition-colors hover:bg-white/[0.02]">
      <button
        className="flex w-full items-center gap-3 text-left"
        onClick={() => { setExpanded(!expanded); onExpand() }}
      >
        <span className={cn('flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide', cfg.class)}>
          <Icon className="h-3 w-3" />
          {cfg.label}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground/50 w-20 font-mono">{log.module}</span>
        <span className="flex-1 truncate text-[12px] text-muted-foreground/70">{log.message}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground/40 w-16 text-right font-mono tabular-nums">
          {new Date(log.created_at).toLocaleTimeString()}
        </span>
      </button>
      {expanded && log.details && (
        <div className="mt-1 ml-20 rounded-lg bg-black/20 border border-white/[0.04] px-3 py-2">
          <pre className="whitespace-pre-wrap break-all text-[11px] text-muted-foreground/50 font-mono leading-relaxed">
            {log.details}
          </pre>
        </div>
      )}
    </div>
  )
}

function Pagination({ page, totalPages, onPageChange }: {
  page: number
  totalPages: number
  onPageChange: (p: number) => void
}) {
  if (totalPages <= 1) return null
  const pages: (number | '...')[] = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...')
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 pt-3">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dot-${i}`} className="px-1 text-[11px] text-muted-foreground/40">...</span>
        ) : (
          <Button
            key={p}
            variant={p === page ? 'default' : 'ghost'}
            size="icon"
            className="h-7 w-7 text-xs"
            onClick={() => onPageChange(p)}
          >
            {p}
          </Button>
        ),
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export default function Logs() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [data, setData] = useState<PaginatedResult<AppLog> | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<{ level?: string; module?: string }>({})
  const [modules, setModules] = useState<string[]>([])

  useEffect(() => {
    api?.invoke('get-app-log-modules').then((result: unknown) => {
      if (Array.isArray(result)) setModules((result as { module: string }[]).map((x) => x.module))
    })
  }, [])

  useEffect(() => {
    loadLogs()
  }, [page, filter])

  async function loadLogs() {
    setLoading(true)
    try {
      const filterArg = filter.level || filter.module ? filter : undefined
      const result = await api?.invoke('get-app-logs', page, PAGE_SIZE, filterArg)
      if (result && typeof result === 'object') setData(result as PaginatedResult<AppLog>)
    } finally {
      setLoading(false)
    }
  }

  function changePage(p: number) {
    if (p < 1) return
    setPage(p)
  }

  function changeFilter(key: 'level' | 'module', value: string | undefined) {
    setFilter((prev) => {
      const next = { ...prev }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
    setPage(1)
  }

  async function handleClear() {
    await api?.invoke('clear-app-logs')
    setData(null)
    setPage(1)
    loadLogs()
  }

  return (
    <div className="space-y-4">
      <section className="glass rounded-2xl border border-white/[0.05] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500/12 to-zinc-500/8 border border-white/[0.08]">
              <ScrollText className="h-4.5 w-4.5 text-muted-foreground/70" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight text-foreground/90">{t('nav.logs')}</h2>
              <p className="text-[11px] text-muted-foreground/50">
                {data ? `${data.total} records · Page ${data.page}/${data.totalPages}` : 'Loading...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" className="text-destructive/80 hover:text-destructive hover:border-destructive/20" onClick={handleClear}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Clear
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Level:</span>
            {['', 'info', 'warn', 'error'].map((l) => (
              <button
                key={l}
                onClick={() => changeFilter('level', l || undefined)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[10px] font-medium transition-all duration-200',
                  filter.level === l || (!filter.level && !l)
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-muted-foreground/50 hover:bg-white/[0.05]'
                )}
              >
                {l ? levelConfig[l as keyof typeof levelConfig].label : 'All'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Module:</span>
            <select
              className="bg-transparent text-[11px] text-muted-foreground/70 outline-none cursor-pointer"
              value={filter.module || ''}
              onChange={(e) => changeFilter('module', e.target.value || undefined)}
            >
              <option value="">All</option>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Log list */}
        <div className="max-h-[520px] overflow-auto rounded-xl border border-white/[0.04] bg-white/[0.01]">
          {loading && !data ? (
            <div className="py-16 text-center">
              <div className="inline-flex h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground/40">Loading...</p>
            </div>
          ) : data && data.items.length > 0 ? (
            data.items.map((log) => (
              <LogRow key={log.id} log={log} onExpand={() => {}} />
            ))
          ) : (
            <div className="py-16 text-center">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03] mb-3">
                <ScrollText className="h-5 w-5 text-muted-foreground/20" />
              </div>
              <p className="text-sm text-muted-foreground/40">No logs yet</p>
            </div>
          )}
        </div>

        {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={changePage} />}
      </section>
    </div>
  )
}
