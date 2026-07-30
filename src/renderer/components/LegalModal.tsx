import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LegalModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * 轻量协议弹窗：全屏遮罩 + 居中卡片，内容区可滚动。
 * 关闭方式：右上角关闭按钮 / 点击遮罩 / 按 ESC。
 */
export default function LegalModal({ open, title, onClose, children }: LegalModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* 卡片 */}
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[hsl(222,41%,7%)] shadow-2xl shadow-black/50 animate-scale-in">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight gradient-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-muted-foreground/70 transition-all hover:border-primary/25 hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容（可滚动） */}
        <div className={cn('flex-1 overflow-auto px-5 py-5 text-[13px] leading-relaxed text-muted-foreground/80')}>
          {children}
        </div>

        {/* 底部 */}
        <div className="border-t border-white/[0.06] px-5 py-3 text-right">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-primary/20 bg-primary/10 px-4 text-xs font-medium text-primary transition-all hover:border-primary/35 hover:bg-primary/15"
          >
            我已阅读
          </button>
        </div>
      </div>
    </div>
  )
}
