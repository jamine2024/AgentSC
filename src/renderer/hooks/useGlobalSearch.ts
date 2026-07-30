import { useCallback, useRef, useState } from 'react'
import type { FileResult } from '../lib/searchTypes'

/** 调用主进程全盘文件索引进行搜索（防抖 150ms） */
export function useGlobalSearch() {
  const [results, setResults] = useState<FileResult[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<number | null>(null)

  const query = useCallback((q: string, topK = 50) => {
    if (timer.current) window.clearTimeout(timer.current)
    const text = (q || '').trim()
    if (!text) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    timer.current = window.setTimeout(async () => {
      try {
        const res = await window.electronAPI?.invoke('search:query', text, topK)
        if (Array.isArray(res)) setResults(res as FileResult[])
        else setResults([])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 150)
  }, [])

  return { results, loading, query }
}
