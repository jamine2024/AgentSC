import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  File,
  Folder,
  FileText,
  FileImage,
  FileCode,
  FileAudio,
  FileVideo,
  FileArchive,
  FileSpreadsheet,
  FolderOpen,
  CornerDownLeft,
  RotateCw,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { useGlobalSearch } from '@/hooks/useGlobalSearch'
import type { FileResult, FileSearchStatus } from '@/lib/searchTypes'

const EXT_ICON: Record<string, LucideIcon> = {
  // 图片
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, bmp: FileImage,
  webp: FileImage, svg: FileImage, ico: FileImage, tiff: FileImage, heic: FileImage,
  // 文档
  pdf: FileText, doc: FileText, docx: FileText, txt: FileText, md: FileText, rtf: FileText,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet,
  ppt: FileText, pptx: FileText,
  // 代码
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode, json: FileCode, html: FileCode,
  css: FileCode, py: FileCode, java: FileCode, go: FileCode, rs: FileCode, c: FileCode, cpp: FileCode,
  sh: FileCode, bat: FileCode, ps1: FileCode, xml: FileCode, yml: FileCode, yaml: FileCode,
  // 音视频
  mp3: FileAudio, wav: FileAudio, flac: FileAudio, aac: FileAudio, ogg: FileAudio, m4a: FileAudio,
  mp4: FileVideo, mov: FileVideo, avi: FileVideo, mkv: FileVideo, webm: FileVideo, wmv: FileVideo, flv: FileVideo,
  // 压缩包
  zip: FileArchive, rar: FileArchive, '7z': FileArchive, tar: FileArchive, gz: FileArchive, bz2: FileArchive,
}

function iconFor(r: FileResult): LucideIcon {
  if (r.is_dir) return Folder
  const icon = EXT_ICON[r.ext.replace(/^\./, '').toLowerCase()]
  return icon || File
}

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(ms: number): string {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleDateString()
  } catch {
    return ''
  }
}

/** 在标题中高亮命中的查询词（大小写不敏感） */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const tokens = Array.from(new Set(q.toLowerCase().split(/\s+/).filter(Boolean)))
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const re = new RegExp(`(${pattern})`, 'gi')
  const parts: Array<{ s: string; hit: boolean }> = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) parts.push({ s: text.slice(last, idx), hit: false })
    parts.push({ s: m[0], hit: true })
    last = idx + m[0].length
  }
  if (last < text.length) parts.push({ s: text.slice(last), hit: false })
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-primary/25 text-foreground rounded px-0.5">
            {p.s}
          </mark>
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </>
  )
}

interface GlobalSearchProps {
  open: boolean
  onClose: () => void
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const { t } = useI18n()
  const { results, loading, query } = useGlobalSearch()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [status, setStatus] = useState<FileSearchStatus | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setText('')
      setActive(0)
      query('')
      requestAnimationFrame(() => inputRef.current?.focus())
      window.electronAPI?.invoke('search:status').then((s) => {
        if (s && typeof s === 'object') setStatus(s as FileSearchStatus)
      }).catch(() => {})
    }
  }, [open])

  // 输入防抖 250ms：query 背后是主进程的同步 FTS/LIKE 查询，每个按键都打一次
  // 会在建索期间 / 大索引下把主进程连续钉住（打字直接卡死）。250ms 对输入
  // 手感无感，查询次数却从「每键一次」降到「停顿才查」。
  useEffect(() => {
    const t = setTimeout(() => {
      query(text)
      setActive(0)
    }, 250)
    return () => clearTimeout(t)
  }, [text])

  // 定时刷新状态（建索引进度）
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => {
      window.electronAPI?.invoke('search:status').then((s) => {
        if (s && typeof s === 'object') setStatus(s as FileSearchStatus)
      }).catch(() => {})
    }, 800)
    return () => window.clearInterval(id)
  }, [open])

  const groups = useMemo(() => results, [results])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  function openFile(r: FileResult) {
    window.electronAPI?.invoke('open-path', r.path)
    onClose()
  }
  function revealFile(r: FileResult) {
    window.electronAPI?.invoke('open-file-location', r.path)
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[active]
      if (r) {
        if (e.shiftKey) revealFile(r)
        else openFile(r)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  function rebuild() {
    setRebuilding(true)
    window.electronAPI?.invoke('search:build').finally(() => {
      setRebuilding(false)
      window.electronAPI?.invoke('search:status').then((s) => {
        if (s && typeof s === 'object') setStatus(s as FileSearchStatus)
      }).catch(() => {})
    })
  }

  let flatIdx = -1

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[680px] overflow-hidden rounded-2xl border border-white/10 bg-[hsl(222_41%_7%)]/95 shadow-2xl shadow-black/50 app-region-no-drag"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 输入区 */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground/70" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/40 border-t-primary" />}
          <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        {/* 结果区 */}
        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground/70">
              {text.trim()
                ? status?.indexing
                  ? t('search.indexing')
                  : t('search.no_results')
                : status?.indexing
                  ? t('search.indexing')
                  : t('search.empty')}
            </div>
          ) : (
            groups.map((r) => {
              flatIdx += 1
              const idx = flatIdx
              const Icon = iconFor(r)
              const isActive = idx === active
              const meta = [r.is_dir ? t('search.folder') : formatBytes(r.size), formatDate(r.mtime)]
                .filter(Boolean)
                .join(' · ')
              return (
                <button
                  key={r.path}
                  data-idx={idx}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => openFile(r)}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    isActive ? 'bg-primary/12 border border-primary/15' : 'border border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      isActive ? 'bg-primary/20 text-primary' : 'bg-white/5 text-muted-foreground/70'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      <Highlight text={r.name} query={text} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground/70">{r.parent}</span>
                    {meta && <span className="block truncate text-[10px] text-muted-foreground/50">{meta}</span>}
                  </span>
                  {isActive && (
                    <span
                      role="button"
                      tabIndex={-1}
                      title={t('search.reveal')}
                      onClick={(e) => {
                        e.stopPropagation()
                        revealFile(r)
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-white/10 hover:text-foreground"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </span>
                  )}
                  {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary/70" />}
                </button>
              )
            })
          )}
        </div>

        {/* 底部状态栏 */}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[10px] text-muted-foreground/60">
          <span className="flex items-center gap-2">
            {status?.indexing ? (
              <>{t('search.indexing_progress', { count: (status.scannedCount || 0).toLocaleString() })}</>
            ) : status?.ready ? (
              <>{t('search.indexed', { count: (status.fileCount || 0).toLocaleString() })}</>
            ) : (
              <>{t('search.indexing')}</>
            )}
            {status?.drives?.length ? ` · ${status.drives.join(' ')}` : ''}
          </span>
          <span className="flex items-center gap-3">
            <button
              onClick={rebuild}
              disabled={rebuilding}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 disabled:opacity-40"
              title={t('search.rebuild')}
            >
              <RotateCw className={`h-3 w-3 ${rebuilding ? 'animate-spin' : ''}`} />
              {t('search.rebuild')}
            </button>
            <span>↑↓ {t('search.nav')}</span>
            <span>↵ {t('search.open')}</span>
            <span>⇧↵ {t('search.reveal')}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
