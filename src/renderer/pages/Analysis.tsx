import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { BarChart3, ChevronDown, Download, FileSearch, FolderOpen, HardDrive, History, ListTree, Loader2, SquareStack, Trash2, XCircle } from 'lucide-react'
import { Treemap, ResponsiveContainer } from 'recharts'
import { Button } from '@/components/ui/button'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { ScanNode } from '@/App'

interface ScanProgressData {
  phase: 'scanning' | 'done'
  currentPath: string
  itemsScanned: number
  currentSize: number
  topDirs: { name: string; size: number }[]
}

interface ScanHistoryRow {
  id: number
  target_path: string
  total_size: number
  items_scanned: number
  max_depth: number
  result_json: string
  created_at: number
}

interface ScanExportPayload {
  target_path: string
  total_size: number
  items_scanned: number
  max_depth: number
  created_at: number
  result: ScanNode
}

const MAX_LOG_ENTRIES = 200

function flatten(node: ScanNode, depth = 0, result: { name: string; path: string; size: number; depth: number }[] = []) {
  result.push({ name: node.name, path: node.path, size: node.size, depth })
  if (node.children) {
    for (const child of node.children) {
      flatten(child, depth + 1, result)
    }
  }
  return result
}

function toTreemapData(node: ScanNode, maxChildren = 6, maxDepth = 3, depth = 0): any {
  const raw = node.children || []
  let kids = raw.map((c) => toTreemapData(c, maxChildren, maxDepth, depth + 1))
  // 限制每层子节点数与递归深度，避免万级扫描树渲染成上万 SVG 导致白屏卡死
  if (depth < maxDepth && kids.length > maxChildren) {
    kids.sort((a, b) => (b.size || 0) - (a.size || 0))
    const top = kids.slice(0, maxChildren)
    const rest = kids.slice(maxChildren)
    const restSize = rest.reduce((s, c) => s + (c.size || 0), 0)
    if (restSize > 0) top.push({ name: `其他(${rest.length})`, size: restSize })
    kids = top
  }
  return { name: node.name, path: node.path, size: node.size, children: kids.length ? kids : undefined }
}

function TreemapContent(props: any) {
  const { x, y, width, height, name, size, root } = props
  if (width < 40 || height < 20) return null
  const depth = props.depth || 0
  const hue = (depth * 40 + (name?.length || 0) * 5) % 360
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={`hsl(${hue}, 70%, ${30 + depth * 5}%)`}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
        rx={4}
      />
      {width > 80 && height > 30 && (
        <text x={x + 6} y={y + 16} fill="rgba(255,255,255,0.9)" fontSize={10} fontWeight={500}>
          {name}
        </text>
      )}
      {width > 80 && height > 44 && (
        <text x={x + 6} y={y + 30} fill="rgba(255,255,255,0.6)" fontSize={9}>
          {formatBytes(size || root?.size || 0)}
        </text>
      )}
    </g>
  )
}

function AnimatedCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0)
  const frameRef = useRef<number>()

  useEffect(() => {
    const start = display
    const diff = value - start
    if (Math.abs(diff) < 1) {
      setDisplay(value)
      return
    }
    const duration = 100
    const startTime = performance.now()
    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      setDisplay(Math.round(start + diff * progress))
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      }
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [value])

  return <>{display.toLocaleString()}{suffix}</>
}

// 复用的扫描结果视图：占用热力图 + Top 文件夹排行
function ScanResultView({ node, onExport }: { node: ScanNode; onExport?: () => void }) {
  const { t } = useI18n()
  const flatList = useMemo(() => {
    return flatten(node).filter((n) => n.depth > 0).sort((a, b) => b.size - a.size).slice(0, 20)
  }, [node])

  const treemapData = useMemo(() => {
    return [toTreemapData(node)]
  }, [node])

  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 glass rounded-2xl border border-white/5 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight">{t('analysis.heatmap')}</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{node.path} · {formatBytes(node.size)}</span>
            {onExport && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onExport}
                className="gap-1.5 text-muted-foreground hover:text-primary"
              >
                <Download className="h-3.5 w-3.5" />
                {t('analysis.export_txt')}
              </Button>
            )}
          </div>
        </div>
        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={treemapData}
              dataKey="size"
              stroke="rgba(255,255,255,0.05)"
              content={<TreemapContent />}
              animationDuration={300}
              isAnimationActive={false}
            />
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass rounded-2xl border border-white/5 p-4">
        <h3 className="mb-3 text-sm font-semibold tracking-tight">{t('analysis.top_folders')}</h3>
        <div className="max-h-[360px] overflow-auto">
          {flatList.map((item, idx) => (
            <div
              key={item.path}
              className="flex items-center justify-between border-b border-white/5 py-2.5 last:border-0"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-muted-foreground">
                  {idx + 1}
                </span>
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs text-muted-foreground" title={item.path}>
                  {item.name}
                </span>
              </div>
              <span className="ml-2 shrink-0 text-xs font-medium">{formatBytes(item.size)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function formatPath(path: string, maxLen = 60) {
  if (path.length <= maxLen) return path
  const head = path.slice(0, 20)
  const tail = path.slice(-35)
  return `${head}...${tail}`
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function Analysis({
  scanning,
  scanResult,
  scanError,
  scanSelectedPath,
  onScanningChange,
  onScanResultChange,
  onScanErrorChange,
  onScanSelectedPathChange,
}: {
  scanning: boolean
  scanResult: ScanNode | null
  scanError: string
  scanSelectedPath: string
  onScanningChange: (v: boolean) => void
  onScanResultChange: (v: ScanNode | null) => void
  onScanErrorChange: (v: string) => void
  onScanSelectedPathChange: (v: string) => void
}) {
  const { t } = useI18n()
  const api = window.electronAPI
  const [disks, setDisks] = useState<{ letter: string; label: string; total: number; used: number }[]>([])

  // 实时扫描状态
  const [scanProgress, setScanProgress] = useState<ScanProgressData | null>(null)
  const [scanLog, setScanLog] = useState<{ path: string; time: number }[]>([])
  const logContainerRef = useRef<HTMLDivElement>(null)

  // 历史记录
  const [history, setHistory] = useState<ScanHistoryRow[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const lastProgressRef = useRef<ScanProgressData | null>(null)

  // 自动滚动日志
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [scanLog])

  useEffect(() => {
    api?.invoke('get-disk-info').then((d) => {
      if (Array.isArray(d)) {
        setDisks(d)
        if (d.length > 0 && !scanSelectedPath) onScanSelectedPathChange(d[0].letter)
      }
    })
  }, [])

  // 加载历史记录
  useEffect(() => {
    api?.invoke('get-scan-history').then((h) => {
      if (Array.isArray(h)) setHistory(h as ScanHistoryRow[])
    })
  }, [])

  // 监听扫描进度
  useEffect(() => {
    const handler = (data: unknown) => {
      const p = data as ScanProgressData
      if (p.phase === 'done') {
        // done事件由handleScan的finally处理，这里只清理临时状态
        setScanProgress(null)
        return
      }
      lastProgressRef.current = p
      setScanProgress(p)
      setScanLog((prev) => {
        const next = [...prev, { path: p.currentPath, time: Date.now() }]
        if (next.length > MAX_LOG_ENTRIES) {
          return next.slice(next.length - MAX_LOG_ENTRIES)
        }
        return next
      })
    }
    api?.on('scan-progress', handler)
    return () => {
      api?.removeAllListeners('scan-progress')
    }
  }, [])

  async function handleScan() {
    if (!scanSelectedPath) return
    onScanningChange(true)
    onScanErrorChange('')
    onScanResultChange(null)
    setScanProgress(null)
    setScanLog([])
    lastProgressRef.current = null
    try {
      const result = await api?.invoke('scan-directory', scanSelectedPath, 3)
      if (result && typeof result === 'object') {
        onScanResultChange(result as ScanNode)
        // 保存历史记录（失败不影响结果展示）
        try {
          await api?.invoke('save-scan-history', {
            target_path: scanSelectedPath,
            total_size: (result as ScanNode).size,
            items_scanned: (lastProgressRef.current as ScanProgressData | null)?.itemsScanned ?? 0,
            max_depth: 3,
            result_json: JSON.stringify(result),
          })
          const updated = await api?.invoke('get-scan-history')
          if (Array.isArray(updated)) setHistory(updated as ScanHistoryRow[])
        } catch {
          // 忽略历史保存失败
        }
      }
    } catch (err) {
      onScanErrorChange(String(err))
    } finally {
      onScanningChange(false)
      setScanProgress(null)
    }
  }

  async function handleDeleteHistory(id: number, e: MouseEvent) {
    e.stopPropagation()
    try {
      await api?.invoke('delete-scan-history', id)
      const updated = await api?.invoke('get-scan-history')
      if (Array.isArray(updated)) setHistory(updated as ScanHistoryRow[])
      if (expandedId === id) setExpandedId(null)
    } catch {
      // 忽略删除失败
    }
  }

  async function handleClearHistory() {
    try {
      await api?.invoke('clear-scan-history')
      setHistory([])
      setExpandedId(null)
    } catch {
      // 忽略清空失败
    }
  }

  async function handleExport(payload: ScanExportPayload) {
    try {
      const res = (await api?.invoke('export-scan-txt', payload)) as
        | { canceled: boolean; filePath: string | null; error?: string }
        | undefined
      if (!res) return
      if (res.error) {
        api?.send('toast-notification', { title: t('analysis.export_failed'), body: res.error, timestamp: Date.now() })
        return
      }
      if (res.canceled) return
      if (res.filePath) {
        api?.send('toast-notification', { title: t('analysis.export_success'), body: res.filePath, timestamp: Date.now() })
      }
    } catch (err) {
      api?.send('toast-notification', { title: t('analysis.export_failed'), body: String(err), timestamp: Date.now() })
    }
  }

  function handleExportCurrent() {
    if (!scanResult) return
    handleExport({
      target_path: scanSelectedPath,
      total_size: scanResult.size,
      items_scanned: (lastProgressRef.current as ScanProgressData | null)?.itemsScanned ?? 0,
      max_depth: 3,
      created_at: Date.now(),
      result: scanResult,
    })
  }

  function handleExportHistory(h: ScanHistoryRow) {
    let node: ScanNode | null = null
    try {
      node = JSON.parse(h.result_json) as ScanNode
    } catch {
      node = null
    }
    if (!node) {
      api?.send('toast-notification', { title: t('analysis.export_failed'), body: t('analysis.history_empty'), timestamp: Date.now() })
      return
    }
    handleExport({
      target_path: h.target_path,
      total_size: h.total_size,
      items_scanned: h.items_scanned,
      max_depth: h.max_depth,
      created_at: h.created_at,
      result: node,
    })
  }

  return (
    <div className="space-y-6">
      {/* 头部：选择扫描目标 */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('analysis.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('analysis.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground">{t('analysis.select_target')}</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {disks.map((disk) => {
                const percent = disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0
                return (
                  <button
                    key={disk.letter}
                    onClick={() => !scanning && onScanSelectedPathChange(disk.letter)}
                    className={cn(
                      'flex flex-col gap-1 rounded-xl border p-3 text-left transition',
                      scanSelectedPath === disk.letter
                        ? 'border-primary bg-primary/10'
                        : 'border-white/10 bg-white/5 hover:border-white/20',
                      scanning && 'pointer-events-none opacity-60',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <HardDrive className="h-3.5 w-3.5" />
                      {disk.letter}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{formatBytes(disk.used)} / {formatBytes(disk.total)}</span>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn('h-full rounded-full', percent > 85 ? 'bg-destructive' : 'bg-primary')}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex gap-2">
            {scanning && (
              <Button variant="ghost" onClick={() => api?.invoke('abort-scan')} className="gap-2 text-destructive hover:text-destructive">
                <XCircle className="h-4 w-4" />
                {t('analysis.stop_scan')}
              </Button>
            )}
            <Button onClick={handleScan} disabled={scanning || !scanSelectedPath} className="gap-2">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareStack className="h-4 w-4" />}
              {scanning ? t('analysis.scanning') : t('analysis.start_scan')}
            </Button>
          </div>
        </div>
        {scanError && <p className="mt-3 text-xs text-destructive">{scanError}</p>}
      </section>

      {/* 实时扫描面板 */}
      {(scanning || scanProgress) && (
        <section className="glass rounded-2xl border border-white/5 p-5">
          {/* 实时统计行 */}
          <div className="mb-4 grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileSearch className="h-3.5 w-3.5" />
                {t('analysis.scanned_items')}
              </div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-primary">
                <AnimatedCounter value={scanProgress?.itemsScanned ?? 0} suffix="" />
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5" />
                {t('analysis.total_size')}
              </div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-emerald-400">
                {scanProgress ? formatBytes(scanProgress.currentSize) : '0 B'}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ListTree className="h-3.5 w-3.5" />
                {t('analysis.current_path')}
              </div>
              <div className="mt-1.5 max-w-full overflow-hidden text-sm font-medium">
                <span
                  key={scanProgress?.currentPath || ''}
                  className="block animate-in fade-in slide-in-from-left-2 duration-300"
                  title={scanProgress?.currentPath || ''}
                >
                  {scanProgress ? formatPath(scanProgress.currentPath) : t('analysis.waiting')}
                </span>
              </div>
            </div>
          </div>

          {/* 实时日志 + 实时 Top 目录 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 实时扫描日志 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-medium text-muted-foreground">{t('analysis.realtime_log')}</h4>
                <span className="text-[10px] text-muted-foreground/60">{scanLog.length} {t('analysis.records')}</span>
              </div>
              <div
                ref={logContainerRef}
                className="h-[220px] overflow-auto rounded-xl bg-black/20 p-3 font-mono text-[11px] leading-relaxed"
              >
                {scanLog.length === 0 ? (
                  <span className="text-muted-foreground/40">{t('analysis.waiting_for_scan')}</span>
                ) : (
                  scanLog.map((entry, i) => (
                    <div
                      key={i}
                      className={cn(
                        'truncate text-muted-foreground/70 transition-colors',
                        i === scanLog.length - 1 && 'text-foreground/90',
                      )}
                    >
                      {entry.path}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 实时 Top 目录 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-medium text-muted-foreground">{t('analysis.realtime_ranking')}</h4>
                <span className="text-[10px] text-muted-foreground/60">{t('analysis.updating')}</span>
              </div>
              <div className="h-[220px] overflow-auto rounded-xl bg-black/20 p-3">
                {(!scanProgress || scanProgress.topDirs.length === 0) ? (
                  <span className="text-muted-foreground/40">{t('analysis.waiting_for_data')}</span>
                ) : (
                  <div className="space-y-1.5">
                    {scanProgress.topDirs.map((d, i) => {
                      const maxSize = scanProgress.topDirs[0]?.size || 1
                      const pct = (d.size / maxSize) * 100
                      return (
                        <div key={d.name + i} className="flex items-center gap-2">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-muted-foreground">
                            {i + 1}
                          </span>
                          <div className="flex-1 overflow-hidden">
                            <div className="flex items-center justify-between">
                              <span className="truncate text-[11px] text-muted-foreground">{d.name}</span>
                              <span className="ml-2 shrink-0 text-[10px] font-medium">{formatBytes(d.size)}</span>
                            </div>
                            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-white/5">
                              <div
                                className="h-full rounded-full bg-primary/60 transition-all duration-300"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 扫描结果 */}
      {scanResult && !scanning && <ScanResultView node={scanResult} onExport={handleExportCurrent} />}

      {/* 历史记录 */}
      <section className="glass rounded-2xl border border-white/5 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">{t('analysis.history_title')}</h3>
            <span className="text-xs text-muted-foreground">{t('analysis.history_subtitle')}</span>
          </div>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('analysis.history_clear')}
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground/60">{t('analysis.history_empty')}</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => {
              const expanded = expandedId === h.id
              let node: ScanNode | null = null
              try {
                node = JSON.parse(h.result_json) as ScanNode
              } catch {
                node = null
              }
              return (
                <div key={h.id} className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() => setExpandedId(expanded ? null : h.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left transition hover:opacity-80"
                    >
                      <ChevronDown
                        className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium" title={h.target_path}>
                            {h.target_path}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{formatTime(h.created_at)}</span>
                          <span>·</span>
                          <span>{formatBytes(h.total_size)}</span>
                          <span>·</span>
                          <span>
                            {(h.items_scanned ?? 0).toLocaleString()} {t('analysis.history_items')}
                          </span>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteHistory(h.id, e)}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 transition hover:bg-white/10 hover:text-destructive"
                      title={t('analysis.history_delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {expanded && node && (
                    <div className="border-t border-white/5 px-4 py-4">
                      <ScanResultView node={node} onExport={() => handleExportHistory(h)} />
                    </div>
                  )}
                  {expanded && !node && (
                    <div className="border-t border-white/5 px-4 py-4 text-xs text-destructive">
                      {t('analysis.history_empty')}
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
