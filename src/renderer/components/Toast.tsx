import { useEffect, useState, useCallback } from 'react'
import { X, FileWarning, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ToastItem {
  id: number
  title: string
  body: string
  timestamp: number
}

let toastIdCounter = 0

// 同屏 toast 上限：告警风暴（扫描/大文件检测连发）时 5 秒窗口内可堆出
// 成百上千个带入场动画的 fixed 元素，把合成器打爆。超过后丢弃最旧的。
const TOAST_MAX = 6

export function useToastNotifications() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const api = window.electronAPI

  useEffect(() => {
    const handler = (data: unknown) => {
      const d = data as { title: string; body: string; timestamp: number }
      if (d && d.title) {
        const id = ++toastIdCounter
        setToasts((prev) => {
          const next = [...prev, { ...d, id }]
          return next.length > TOAST_MAX ? next.slice(next.length - TOAST_MAX) : next
        })
        // 5 秒后自动移除
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 5000)
      }
    }
    api?.on('toast-notification', handler)
    return () => {
      api?.removeAllListeners('toast-notification')
    }
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, dismissToast }
}

export default function ToastContainer({
  toasts,
  dismissToast,
}: {
  toasts: ToastItem[]
  dismissToast: (id: number) => void
}) {
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto flex w-80 animate-in slide-in-from-right-5 fade-in items-start gap-3 rounded-xl border border-white/10 bg-background/95 backdrop-blur-xl p-4 shadow-2xl',
            'transition-all duration-300 hover:scale-[1.02]',
          )}
          style={{
            animation: 'slideInRight 0.3s ease-out',
          }}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
            {toast.body.includes('大文件') ? (
              <FileWarning className="h-3.5 w-3.5" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold tracking-tight">{toast.title}</div>
            <div className="mt-0.5 whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">
              {toast.body}
            </div>
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

// 在全局增加 slideInRight 动画
const style = document.createElement('style')
style.textContent = `
  @keyframes slideInRight {
    from {
      opacity: 0;
      transform: translateX(100%) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }
`
document.head.appendChild(style)