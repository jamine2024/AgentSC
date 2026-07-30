import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MousePointer2,
  Pen,
  StickyNote,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Pause,
  Play,
  Eraser,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

export type VEventType = 'created' | 'modified' | 'deleted' | 'renamed'

export interface VEvent {
  type: VEventType
  path: string
  size?: number
  recorded_at: number
  process_name?: string
  process_id?: number
}

type SimNode = {
  id: string
  kind: 'process' | 'file'
  label: string
  sub?: string
  count: number
  size: number
  color: string
  type?: VEventType
  processName?: string
  time?: number
  x: number
  y: number
  vx: number
  vy: number
  r: number
  fixed?: boolean
}

type SimEdge = { source: string; target: string; type: VEventType }

type StrokeAnno = { kind: 'stroke'; points: { x: number; y: number }[]; color: string }
type NoteAnno = { kind: 'note'; x: number; y: number; text: string; color: string }
type Annotation = StrokeAnno | NoteAnno

type HoverInfo = {
  id: string
  kind: SimNode['kind']
  label: string
  sub?: string
  count: number
  size: number
  type?: VEventType
  time?: number
  sx: number
  sy: number
}

const TYPE_COLORS: Record<VEventType, string> = {
  created: '#34d399',
  modified: '#60a5fa',
  deleted: '#f87171',
  renamed: '#fbbf24',
}

const ANNO_COLOR = '#22d3ee'
const UNKNOWN_COLOR = '#94a3b8'

const DENSITY = [
  { p: 12, label: 'visualize.toolbar_density' },
  { p: 20, label: 'visualize.toolbar_density' },
  { p: 28, label: 'visualize.toolbar_density' },
]
const MAX_FILES = 160

const REPULSION = 1400
const LINK_LEN = 64
const SPRING = 0.02
const CENTER = 0.006
const DAMPING = 0.9

function cssVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function primaryColor(): string {
  const v = cssVar('--primary')
  return v ? `hsl(${v})` : '#6366f1'
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function shortName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

interface RelationCanvasProps {
  events: VEvent[]
  selectedProcess: string | null
  onSelectProcess: (p: string | null) => void
}

export default function RelationCanvas({
  events,
  selectedProcess,
  onSelectProcess,
}: RelationCanvasProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  const nodesRef = useRef<Map<string, SimNode>>(new Map())
  const edgesRef = useRef<SimEdge[]>([])
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 })
  const alphaRef = useRef(1)
  const annotationsRef = useRef<Annotation[]>([])
  const hoverRef = useRef<SimNode | null>(null)
  const dragRef = useRef<{
    type: 'node' | 'pan' | null
    id?: string
    startX: number
    startY: number
    ox: number
    oy: number
    moved: boolean
  }>({ type: null, startX: 0, startY: 0, ox: 0, oy: 0, moved: false })
  const penRef = useRef<{ x: number; y: number }[] | null>(null)
  const pausedRef = useRef(false)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const centeredRef = useRef(false)

  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [mode, setMode] = useState<'move' | 'pen' | 'note'>('move')
  const [paused, setPaused] = useState(false)
  const [density, setDensity] = useState(1)
  const [annoCount, setAnnoCount] = useState(0)

  const eventsSig = useMemo(
    () => events.length + ':' + (events[events.length - 1]?.recorded_at ?? 0),
    [events],
  )

  // 根据事件重建图模型（保留已有节点坐标，保证布局稳定）
  const rebuild = useCallback(
    (evs: VEvent[]) => {
      const procCounts = new Map<string, number>()
      const procFiles = new Map<string, VEvent[]>()
      for (const e of evs) {
        const p = e.process_name || t('event.unknown_process')
        procCounts.set(p, (procCounts.get(p) || 0) + 1)
        const arr = procFiles.get(p)
        if (arr) arr.push(e)
        else procFiles.set(p, [e])
      }
      const top = [...procCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, DENSITY[density].p)
      const filesPerProc = Math.max(2, Math.floor(MAX_FILES / Math.max(1, top.length)))
      const newNodes = new Map<string, SimNode>()
      const newEdges: SimEdge[] = []
      const primary = primaryColor()

      for (const [p, count] of top) {
        const pid = `proc:${p}`
        const existing = nodesRef.current.get(pid)
        const node: SimNode = existing
          ? { ...existing }
          : {
              id: pid,
              kind: 'process',
              label: p,
              count: 0,
              size: 0,
              color: p === t('event.unknown_process') ? UNKNOWN_COLOR : primary,
              x: (Math.random() - 0.5) * 240,
              y: (Math.random() - 0.5) * 240,
              vx: 0,
              vy: 0,
              r: 11,
            }
        node.count = count
        node.size = 0
        newNodes.set(pid, node)

        const files = (procFiles.get(p) || []).slice(0, filesPerProc)
        for (const f of files) {
          const fid = `file:${f.path}`
          const ex = nodesRef.current.get(fid)
          const fnode: SimNode = ex
            ? { ...ex }
            : {
              id: fid,
              kind: 'file',
              label: shortName(f.path),
              sub: f.path,
              count: 0,
              size: f.size || 0,
              color: TYPE_COLORS[f.type],
                type: f.type,
                processName: p,
                time: f.recorded_at,
                x: node.x + (Math.random() - 0.5) * 50,
                y: node.y + (Math.random() - 0.5) * 50,
                vx: 0,
                vy: 0,
                r: 4,
              }
          fnode.size = f.size || 0
          fnode.time = f.recorded_at
          node.size += f.size || 0
          newNodes.set(fid, fnode)
          newEdges.push({ source: pid, target: fid, type: f.type })
        }
        node.r = Math.max(10, Math.min(34, 9 + Math.sqrt(count) * 1.7))
      }
      // 文件节点半径按大小
      for (const n of newNodes.values()) {
        if (n.kind === 'file') {
          n.r = Math.max(3, Math.min(14, 3 + Math.log10(1 + (n.size || 0)) * 1.7))
        }
      }
      nodesRef.current = newNodes
      edgesRef.current = newEdges
      alphaRef.current = Math.max(alphaRef.current, 0.5)
    },
    [density, t],
  )

  useEffect(() => {
    rebuild(events)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsSig])

  // 力导向仿真步进
  const tick = useCallback(() => {
    const nodes = [...nodesRef.current.values()]
    const n = nodes.length
    const alpha = alphaRef.current
    if (n === 0) return
    for (let i = 0; i < n; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d2 = dx * dx + dy * dy + 0.01
        }
        const d = Math.sqrt(d2)
        const rep = (REPULSION * alpha) / d2
        const fx = (dx / d) * rep
        const fy = (dy / d) * rep
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }
    for (const e of edgesRef.current) {
      const s = nodesRef.current.get(e.source)
      const tt = nodesRef.current.get(e.target)
      if (!s || !tt) continue
      const dx = tt.x - s.x
      const dy = tt.y - s.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = (d - LINK_LEN) * SPRING * alpha
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      s.vx += fx
      s.vy += fy
      tt.vx -= fx
      tt.vy -= fy
    }
    for (const node of nodes) {
      if (node.fixed) {
        node.vx = 0
        node.vy = 0
        continue
      }
      node.vx += -node.x * CENTER * alpha
      node.vy += -node.y * CENTER * alpha
      node.vx *= DAMPING
      node.vy *= DAMPING
      node.x += node.vx
      node.y += node.vy
    }
    alphaRef.current = Math.max(0, alpha * 0.985)
  }, [])

  const drawAnnotations = (ctx: CanvasRenderingContext2D, scale: number) => {
    for (const a of annotationsRef.current) {
      if (a.kind === 'stroke') {
        if (a.points.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(a.points[0].x, a.points[0].y)
        for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y)
        ctx.strokeStyle = a.color
        ctx.lineWidth = 2 / scale
        ctx.lineCap = 'round'
        ctx.stroke()
      } else {
        const fs = 12 / scale
        ctx.font = `${fs}px ui-sans-serif, system-ui, sans-serif`
        const w = ctx.measureText(a.text).width + 14 / scale
        const h = 22 / scale
        ctx.fillStyle = 'rgba(15,23,42,0.92)'
        ctx.strokeStyle = a.color
        ctx.lineWidth = 1.5 / scale
        const rx = a.x
        const ry = a.y - h / 2
        const rad = 6 / scale
        ctx.beginPath()
        ctx.moveTo(rx + rad, ry)
        ctx.arcTo(rx + w, ry, rx + w, ry + h, rad)
        ctx.arcTo(rx + w, ry + h, rx, ry + h, rad)
        ctx.arcTo(rx, ry + h, rx, ry, rad)
        ctx.arcTo(rx, ry, rx + w, ry, rad)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#e2e8f0'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(a.text, rx + 7 / scale, a.y)
      }
    }
    if (penRef.current && penRef.current.length > 1) {
      ctx.beginPath()
      ctx.moveTo(penRef.current[0].x, penRef.current[0].y)
      for (let i = 1; i < penRef.current.length; i++)
        ctx.lineTo(penRef.current[i].x, penRef.current[i].y)
      ctx.strokeStyle = ANNO_COLOR
      ctx.lineWidth = 2 / scale
      ctx.lineCap = 'round'
      ctx.stroke()
    }
  }

  const draw = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { w, h, dpr } = sizeRef.current
    if (w === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const { scale, ox, oy } = viewRef.current
    ctx.save()
    ctx.translate(ox, oy)
    ctx.scale(scale, scale)

    // 连线
    for (const e of edgesRef.current) {
      const s = nodesRef.current.get(e.source)
      const tt = nodesRef.current.get(e.target)
      if (!s || !tt) continue
      const dim = selectedProcess != null && s.label !== selectedProcess
      ctx.strokeStyle = hexToRgba(TYPE_COLORS[e.type], dim ? 0.05 : 0.28)
      ctx.lineWidth = (dim ? 0.5 : 1.2) / scale
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(tt.x, tt.y)
      ctx.stroke()
    }

    drawAnnotations(ctx, scale)

    // 节点
    for (const node of nodesRef.current.values()) {
      const dim =
        selectedProcess != null &&
        (node.kind === 'file' ? node.processName !== selectedProcess : node.label !== selectedProcess)
      const sel = selectedProcess != null && node.kind === 'process' && node.label === selectedProcess
      ctx.beginPath()
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
      ctx.globalAlpha = dim ? 0.22 : 1
      ctx.fillStyle = node.color
      ctx.fill()
      if (node.kind === 'process') {
        ctx.lineWidth = 2 / scale
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'
        ctx.stroke()
      }
      if (sel) {
        ctx.lineWidth = 3 / scale
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    ctx.restore()

    // 标签（屏幕坐标，保证可读）
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const node of nodesRef.current.values()) {
      const dim =
        selectedProcess != null &&
        (node.kind === 'file' ? node.processName !== selectedProcess : node.label !== selectedProcess)
      if (node.kind === 'process' || hoverRef.current === node) {
        const sx = node.x * scale + ox
        const sy = node.y * scale + oy + node.r * scale + 11
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
        ctx.fillStyle = dim ? 'rgba(226,232,240,0.3)' : 'rgba(226,232,240,0.92)'
        ctx.fillText(truncate(node.label, 20), sx, sy)
      }
    }
  }, [selectedProcess])

  // 主渲染循环
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    ctxRef.current = canvas.getContext('2d')

    const ro = new ResizeObserver(() => {
      const el = containerRef.current
      if (!el) return
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      if (!centeredRef.current && w > 0) {
        viewRef.current = { scale: 1, ox: w / 2, oy: h / 2 }
        centeredRef.current = true
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)

    let raf = 0
    const loop = () => {
      if (!pausedRef.current) tick()
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [tick, draw])

  // 坐标转换
  const screenToWorld = (sx: number, sy: number) => {
    const { scale, ox, oy } = viewRef.current
    return { x: (sx - ox) / scale, y: (sy - oy) / scale }
  }
  const getPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }
  }
  const hitTest = (sx: number, sy: number): SimNode | null => {
    const { scale } = viewRef.current
    const wp = screenToWorld(sx, sy)
    let found: SimNode | null = null
    for (const node of nodesRef.current.values()) {
      const dx = wp.x - node.x
      const dy = wp.y - node.y
      const r = Math.max(node.r, 6 / scale)
      if (dx * dx + dy * dy <= r * r) found = node
    }
    return found
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { sx, sy } = getPos(e)
    canvasRef.current?.setPointerCapture(e.pointerId)
    if (mode === 'pen') {
      const wp = screenToWorld(sx, sy)
      penRef.current = [wp]
      return
    }
    if (mode === 'note') {
      dragRef.current = { type: 'node', startX: sx, startY: sy, ox: 0, oy: 0, moved: false }
      return
    }
    const hit = hitTest(sx, sy)
    if (hit) {
      hit.fixed = true
      dragRef.current = { type: 'node', id: hit.id, startX: sx, startY: sy, ox: 0, oy: 0, moved: false }
    } else {
      const { ox, oy } = viewRef.current
      dragRef.current = { type: 'pan', startX: sx, startY: sy, ox, oy, moved: false }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { sx, sy } = getPos(e)
    if (mode === 'pen' && penRef.current) {
      penRef.current.push(screenToWorld(sx, sy))
      return
    }
    const drag = dragRef.current
    if (drag.type === 'node' && drag.id) {
      const node = nodesRef.current.get(drag.id)
      if (node) {
        const wp = screenToWorld(sx, sy)
        node.x = wp.x
        node.y = wp.y
        node.vx = 0
        node.vy = 0
      }
      if (Math.abs(sx - drag.startX) > 3 || Math.abs(sy - drag.startY) > 3) drag.moved = true
      return
    }
    if (drag.type === 'pan') {
      viewRef.current = {
        ...viewRef.current,
        ox: drag.ox + (sx - drag.startX),
        oy: drag.oy + (sy - drag.startY),
      }
      if (Math.abs(sx - drag.startX) > 3 || Math.abs(sy - drag.startY) > 3) drag.moved = true
      return
    }
    // 悬浮提示
    const hit = hitTest(sx, sy)
    hoverRef.current = hit
    if (hit) {
      setHover({
        id: hit.id,
        kind: hit.kind,
        label: hit.label,
        sub: hit.sub,
        count: hit.count,
        size: hit.size,
        type: hit.type,
        time: hit.time,
        sx,
        sy,
      })
    } else if (hover) {
      setHover(null)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const { sx, sy } = getPos(e)
    canvasRef.current?.releasePointerCapture(e.pointerId)
    if (mode === 'pen') {
      if (penRef.current && penRef.current.length > 1) {
        annotationsRef.current.push({ kind: 'stroke', points: penRef.current, color: ANNO_COLOR })
        setAnnoCount(annotationsRef.current.length)
      }
      penRef.current = null
      return
    }
    const drag = dragRef.current
    if (mode === 'note') {
      if (!drag.moved) {
        const text = window.prompt(t('visualize.anno_note_placeholder'))
        if (text && text.trim()) {
          const wp = screenToWorld(sx, sy)
          annotationsRef.current.push({
            kind: 'note',
            x: wp.x,
            y: wp.y,
            text: text.trim(),
            color: ANNO_COLOR,
          })
          setAnnoCount(annotationsRef.current.length)
        }
      }
      dragRef.current = { type: null, startX: 0, startY: 0, ox: 0, oy: 0, moved: false }
      return
    }
    if (drag.type === 'node' && drag.id) {
      const node = nodesRef.current.get(drag.id)
      if (node) node.fixed = false
      // 视为点击（未拖动）
      if (!drag.moved && node && node.kind === 'process') {
        onSelectProcess(selectedProcess === node.label ? null : node.label)
      }
    }
    dragRef.current = { type: null, startX: 0, startY: 0, ox: 0, oy: 0, moved: false }
  }

  const onWheel = (e: React.WheelEvent) => {
    const { sx, sy } = getPos(e as unknown as React.PointerEvent)
    const { scale, ox, oy } = viewRef.current
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newScale = Math.max(0.2, Math.min(4, scale * factor))
    const wx = (sx - ox) / scale
    const wy = (sy - oy) / scale
    viewRef.current = { scale: newScale, ox: sx - wx * newScale, oy: sy - wy * newScale }
  }

  const zoomBy = (factor: number) => {
    const { w, h } = sizeRef.current
    const { scale, ox, oy } = viewRef.current
    const newScale = Math.max(0.2, Math.min(4, scale * factor))
    const cx = w / 2
    const cy = h / 2
    const wx = (cx - ox) / scale
    const wy = (cy - oy) / scale
    viewRef.current = { scale: newScale, ox: cx - wx * newScale, oy: cy - wy * newScale }
  }

  const resetView = () => {
    const { w, h } = sizeRef.current
    viewRef.current = { scale: 1, ox: w / 2, oy: h / 2 }
    alphaRef.current = 1
  }

  const togglePause = () => {
    const next = !paused
    pausedRef.current = next
    setPaused(next)
  }

  const cycleDensity = () => setDensity((d) => (d + 1) % DENSITY.length)

  const clearAnnotations = () => {
    annotationsRef.current = []
    setAnnoCount(0)
  }

  const nodeCount = nodesRef.current.size
  const edgeCount = edgesRef.current.length

  const toolBtn = (active: boolean) =>
    cn(
      'flex h-8 w-8 items-center justify-center rounded-lg border transition',
      active
        ? 'border-primary bg-primary/15 text-primary'
        : 'border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:border-white/20',
    )

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={cn(
          'absolute inset-0 h-full w-full touch-none',
          mode === 'pen' ? 'cursor-crosshair' : mode === 'note' ? 'cursor-copy' : 'cursor-grab',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hoverRef.current = null
          setHover(null)
        }}
        onWheel={onWheel}
      />

      {/* 悬浮提示 */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 max-w-[260px] rounded-lg border border-white/10 bg-[hsl(var(--background))]/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(hover.sx + 14, (sizeRef.current.w || 0) - 270), top: hover.sy + 14 }}
        >
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: hover.kind === 'process' ? primaryColor() : TYPE_COLORS[hover.type || 'created'] }}
            />
            {hover.label}
          </div>
          {hover.sub && <div className="break-all text-[10px] text-muted-foreground">{hover.sub}</div>}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            {hover.kind === 'process' ? (
              <span>
                {hover.count} {t('visualize.node_events')}
              </span>
            ) : (
              <>
                <span>{hover.size ? (hover.size / 1024 / 1024).toFixed(2) + ' MB' : '-'}</span>
                {hover.time && <span>{new Date(hover.time).toLocaleTimeString()}</span>}
              </>
            )}
          </div>
        </div>
      )}

      {/* 工具栏 */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/30 p-1.5 backdrop-blur">
        <div className="flex gap-1.5">
          <button className={toolBtn(mode === 'move')} title={t('visualize.toolbar_move')} onClick={() => setMode('move')}>
            <MousePointer2 className="h-4 w-4" />
          </button>
          <button className={toolBtn(mode === 'pen')} title={t('visualize.toolbar_pen')} onClick={() => setMode('pen')}>
            <Pen className="h-4 w-4" />
          </button>
          <button className={toolBtn(mode === 'note')} title={t('visualize.toolbar_note')} onClick={() => setMode('note')}>
            <StickyNote className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <button className={toolBtn(false)} title={t('visualize.toolbar_zoom_in')} onClick={() => zoomBy(1.2)}>
            <ZoomIn className="h-4 w-4" />
          </button>
          <button className={toolBtn(false)} title={t('visualize.toolbar_zoom_out')} onClick={() => zoomBy(1 / 1.2)}>
            <ZoomOut className="h-4 w-4" />
          </button>
          <button className={toolBtn(false)} title={t('visualize.toolbar_reset')} onClick={resetView}>
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <button className={toolBtn(false)} title={paused ? t('visualize.toolbar_resume') : t('visualize.toolbar_pause')} onClick={togglePause}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button className={toolBtn(false)} title={t('visualize.toolbar_density')} onClick={cycleDensity}>
            <span className="text-[11px] font-semibold">{DENSITY[density].p}</span>
          </button>
        </div>
        <button
          className={cn(toolBtn(false), annoCount === 0 && 'opacity-40')}
          title={t('visualize.toolbar_clear_anno')}
          onClick={clearAnnotations}
          disabled={annoCount === 0}
        >
          <Eraser className="h-4 w-4" />
        </button>
      </div>

      {/* 图例 */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-muted-foreground backdrop-blur">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-white/50" style={{ background: primaryColor() }} />
          {t('visualize.legend_process')}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS.created }} />
          {t('visualize.legend_file')}
        </div>
        <div className="mt-0.5 text-muted-foreground/70">
          {nodeCount} {t('visualize.legend_process')} · {edgeCount} links
        </div>
      </div>
    </div>
  )
}
