import { useCallback, useEffect, useMemo, useRef, useDeferredValue, useState } from 'react'
import { FixedSizeList, ListChildComponentProps } from 'react-window'
import {
  PackageX,
  Search,
  RefreshCw,
  FolderOpen,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  X,
  HardDriveDownload,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { ProgramInfo } from '@/lib/systemTypes'

// ---- 纯函数（模块级，避免每次渲染重建）----
function iconPathFor(p: ProgramInfo): string {
  if (!p.displayIcon) return ''
  return p.displayIcon.split(',')[0].trim()
}

function fmtInstallDate(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return '—'
  // 注册表常见 YYYYMMDD
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('zh-CN')
  return s
}

function installDateSortValue(raw: string): number | null {
  const s = (raw || '').trim()
  if (!s) return null
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.getTime()
  return null
}

function SortIcon({ dir }: { dir: 'asc' | 'desc' }) {
  return dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
}

type SortKey = 'name' | 'size' | 'installed'

type RowData = {
  filtered: ProgramInfo[]
  icons: Record<string, string>
  onOpen: (loc: string) => void
  onUninstall: (p: ProgramInfo) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const UN_GRID = 'grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_88px_96px_120px_72px] items-center'

// 列表行提到组件外，仅依赖 itemData，函数引用稳定，
// react-window 不会因父组件重渲染而重建整列，只重渲染可见窗口。
const UnRow = ({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { filtered, icons, onOpen, onUninstall, t } = data
  const p = filtered[index]
  if (!p) return null
  const ip = iconPathFor(p)
  return (
    <div style={style} className={cn(UN_GRID, 'border-t border-white/5 hover:bg-white/[0.03]')}>
      <div className="px-4 py-2">
        <div className="flex items-center gap-2">
          {icons[ip] ? (
            <img src={icons[ip]} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
          ) : (
            <PackageX className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          )}
          <div className="font-medium text-foreground">{p.name}</div>
        </div>
        {p.installLocation && (
          <button
            onClick={() => onOpen(p.installLocation)}
            className="mt-0.5 flex max-w-[260px] items-center gap-1 truncate pl-6 text-[10px] text-primary/70 hover:text-primary"
            title={p.installLocation}
          >
            <FolderOpen className="h-3 w-3 shrink-0" />
            <span className="truncate">{p.installLocation}</span>
          </button>
        )}
      </div>
      <div className="px-3 py-2 text-muted-foreground">
        <span className="block max-w-[160px] truncate" title={p.publisher || ''}>
          {p.publisher || '—'}
        </span>
      </div>
      <div className="px-3 py-2 text-muted-foreground">{p.version || '—'}</div>
      <div className="px-3 py-2 text-right text-muted-foreground">
        {p.estimatedSize > 0 ? formatBytes(p.estimatedSize * 1024) : '—'}
      </div>
      <div className="px-3 py-2 text-muted-foreground">{fmtInstallDate(p.installDate)}</div>
      <div className="px-4 py-2 text-right">
        {p.uninstallString ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-red-400 hover:bg-red-500/10"
            onClick={() => onUninstall(p)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('uninstall.uninstall')}
          </Button>
        ) : (
          <span className="text-[10px] text-muted-foreground/50">—</span>
        )}
      </div>
    </div>
  )
}

export default function Uninstaller() {
  const { t } = useI18n()
  const api = window.electronAPI

  const [programs, setPrograms] = useState<ProgramInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // 搜索输入即时响应（受控组件不卡），过滤结果延后到后台提交，
  // 避免大列表每次按键都同步重算+重渲染导致输入框掉帧。
  const deferredSearch = useDeferredValue(search)

  const [target, setTarget] = useState<ProgramInfo | null>(null)
  const [quiet, setQuiet] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [icons, setIcons] = useState<Record<string, string>>({})
  // 已请求过的图标路径，防止重复请求（跨渲染持久）
  const requestedIcons = useRef<Set<string>>(new Set())

  const loadIcons = useCallback(
    async (paths: string[]) => {
      const need = paths.filter((x) => x && !requestedIcons.current.has(x))
      if (need.length === 0) return
      need.forEach((x) => requestedIcons.current.add(x))
      try {
        const r = await api?.invoke('get-file-icons', need)
        if (r && typeof r === 'object') {
          setIcons((prev) => ({ ...prev, ...(r as Record<string, string>) }))
        }
      } catch {
        /* ignore */
      }
    },
    [api],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api?.invoke('list-programs')
      if (Array.isArray(r)) setPrograms(r as ProgramInfo[])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // 名称默认升序，大小/日期默认降序（大优先、新优先）
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    let list = programs
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.publisher || '').toLowerCase().includes(q) ||
          (p.version || '').toLowerCase().includes(q),
      )
    }
    const nameCmp = (a: ProgramInfo, b: ProgramInfo) => a.name.localeCompare(b.name, 'zh-Hans-CN')
    const sorted = [...list].sort((a, b) => {
      let r = 0
      if (sortKey === 'size') {
        r = (b.estimatedSize || 0) - (a.estimatedSize || 0)
      } else if (sortKey === 'installed') {
        const va = installDateSortValue(a.installDate)
        const vb = installDateSortValue(b.installDate)
        const ua = va == null
        const ub = vb == null
        if (ua && ub) r = 0
        else if (ua) r = 1 // 未知日期始终排末尾
        else if (ub) r = -1
        else r = va - vb
      } else {
        r = nameCmp(a, b)
      }
      if (r === 0) r = nameCmp(a, b)
      return sortDir === 'asc' ? r : -r
    })
    return sorted
  }, [programs, deferredSearch, sortKey, sortDir])

  const totalSize = useMemo(
    () => programs.reduce((s, p) => s + (p.estimatedSize || 0) * 1024, 0),
    [programs],
  )

  const stats = [
    {
      icon: PackageX,
      label: t('uninstall.total_programs'),
      value: programs.length.toLocaleString(),
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      icon: HardDriveDownload,
      label: t('uninstall.col_size'),
      value: totalSize > 0 ? formatBytes(totalSize) : '—',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
  ]

  const openLocation = useCallback(
    async (loc: string) => {
      if (!loc) return
      try {
        await api?.invoke('open-path', loc)
      } catch {
        /* ignore */
      }
    },
    [api],
  )

  const onUninstall = useCallback((p: ProgramInfo) => {
    setTarget(p)
    setQuiet(false)
    setMsg(null)
  }, [])

  const confirmUninstall = async () => {
    if (!target) return
    setUninstalling(true)
    setMsg(null)
    try {
      const r = await api?.invoke('uninstall-program', {
        uninstallString: target.uninstallString,
        quietUninstallString: target.quietUninstallString,
        quiet,
      })
      const res = r as { ok?: boolean; launched?: boolean; error?: string }
      if (res?.ok || res?.launched) {
        setMsg({ ok: true, text: t('uninstall.uninstall_started') })
        // 给系统向导一点时间启动后再刷新列表
        setTimeout(() => void load(), 1200)
      } else {
        setMsg({ ok: false, text: t('uninstall.uninstall_failed', { reason: res?.error || '' }) })
      }
    } catch (err) {
      setMsg({ ok: false, text: t('uninstall.uninstall_failed', { reason: String(err) }) })
    } finally {
      setUninstalling(false)
    }
  }

  // 图标懒加载：只提取「可见窗口 + 少量预读缓冲」的图标，并 debounce 合并滚动过程中的
  // 连续请求。避免一次性向主进程请求数百个 exe 图标（PowerShell 长时间占满 CPU + 大对象
  // IPC 回传）造成打开/刷新页面时整个窗口卡死。
  const iconLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleItemsRendered = useCallback(
    (info: { visibleStartIndex: number; visibleStopIndex: number }) => {
      if (iconLoadTimer.current) clearTimeout(iconLoadTimer.current)
      iconLoadTimer.current = setTimeout(() => {
        const start = Math.max(0, info.visibleStartIndex - 5)
        const end = Math.min(filtered.length - 1, info.visibleStopIndex + 10)
        const paths: string[] = []
        for (let i = start; i <= end; i++) {
          const p = filtered[i]
          if (p) {
            const ip = iconPathFor(p)
            if (ip) paths.push(ip)
          }
        }
        void loadIcons(paths)
      }, 180)
    },
    [filtered, loadIcons],
  )

  // 列表行所需数据统一通过 itemData 传入，函数引用稳定，避免整列重渲染
  const rowData = useMemo<RowData>(
    () => ({ filtered, icons, onOpen: openLocation, onUninstall, t }),
    [filtered, icons, openLocation, onUninstall, t],
  )

  const SortHeader = ({
    label,
    k,
    align = 'left',
  }: {
    label: string
    k: SortKey
    align?: 'left' | 'right'
  }) => {
    const active = sortKey === k
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          'flex items-center gap-1 font-medium transition',
          align === 'right' ? 'ml-auto' : '',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {label}
        {active ? <SortIcon dir={sortDir} /> : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </button>
    )
  }

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <section>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <PackageX className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('uninstall.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('uninstall.subtitle')}</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('uninstall.refresh')}
          </Button>
        </div>
      </section>

      {/* 工具栏 */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('uninstall.search_placeholder')}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          {(
            [
              { key: 'name', label: t('uninstall.col_name') },
              { key: 'size', label: t('uninstall.col_size') },
              { key: 'installed', label: t('uninstall.col_installed') },
            ] as { key: SortKey; label: string }[]
          ).map((opt) => {
            const active = sortKey === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => toggleSort(opt.key)}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                  active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
                {active && <SortIcon dir={sortDir} />}
              </button>
            )
          })}
        </div>
      </section>

      {/* 统计卡 */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      {/* 程序表 */}
      <section className="glass rounded-2xl border border-white/5 p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">
            {loading
              ? t('uninstall.refreshing')
              : programs.length === 0
                ? t('uninstall.no_programs')
                : t('uninstall.no_match')}
          </div>
        ) : (
          <>
            <div
              className={cn(
                UN_GRID,
                'border-b border-white/10 bg-card/95 py-2.5 text-left text-xs font-medium text-muted-foreground',
              )}
            >
              <div className="px-4">
                <SortHeader label={t('uninstall.col_name')} k="name" />
              </div>
              <div className="px-3">{t('uninstall.col_publisher')}</div>
              <div className="px-3">{t('uninstall.col_version')}</div>
              <div className="px-3 text-right">
                <SortHeader label={t('uninstall.col_size')} k="size" align="right" />
              </div>
              <div className="px-3">
                <SortHeader label={t('uninstall.col_installed')} k="installed" />
              </div>
              <div className="px-4 text-right"></div>
            </div>
            <FixedSizeList
              height={Math.min(filtered.length * 52, 520)}
              itemCount={filtered.length}
              itemSize={52}
              width="100%"
              itemData={rowData}
              onItemsRendered={handleItemsRendered}
            >
              {UnRow}
            </FixedSizeList>
          </>
        )}
      </section>

      {/* 卸载确认弹窗 */}
      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[400px] rounded-2xl border border-white/10 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h3 className="text-sm font-semibold">{t('uninstall.uninstall_confirm_title')}</h3>
              <button
                className="ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => setTarget(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              {t('uninstall.uninstall_confirm_desc', { name: target.name })}
            </p>
            {target.quietUninstallString && (
              <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={quiet}
                  onChange={(e) => setQuiet(e.target.checked)}
                  className="accent-primary"
                />
                {t('uninstall.silent')}
              </label>
            )}
            {msg && (
              <div
                className={cn(
                  'mb-3 rounded-lg px-3 py-2 text-xs',
                  msg.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400',
                )}
              >
                <span className="flex items-center gap-1.5">
                  {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                  {msg.text}
                </span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void confirmUninstall()}
                disabled={uninstalling}
              >
                <Trash2 className={cn('h-3.5 w-3.5', uninstalling && 'animate-pulse')} />
                {uninstalling ? t('uninstall.uninstalling') : t('uninstall.uninstall_confirm_ok')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
