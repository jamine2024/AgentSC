import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

const STAGES = ['boot.warming', 'boot.loading_monitor', 'boot.ready'] as const

// 首次启动软件时的全屏过渡动画，盖住主界面直到看板首屏数据加载完成
export default function Splash({ visible }: { visible: boolean }) {
  const { t } = useI18n()
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 850)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background grid-bg transition-opacity duration-500 ease-out',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {/* 中心光晕 */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />

      <div className="relative flex flex-col items-center">
        {/* 品牌 Logo：渐变方块 + 旋转光环 + 眼睛图标 */}
        <div className="relative mb-8 flex h-24 w-24 items-center justify-center">
          <span
            className="absolute inset-0 animate-spin rounded-3xl border-2 border-transparent border-t-white/70 border-r-white/25"
            style={{ animationDuration: '2.6s' }}
          />
          <span className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary via-[hsl(var(--grad-via))] to-info opacity-90 blur-[3px]" />
          <div className="relative flex h-[72px] w-[72px] items-center justify-center rounded-[18px] bg-[hsl(222,41%,9%)]">
            <Eye className="h-9 w-9 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]" />
          </div>
        </div>

        {/* 产品名 */}
        <div className="text-2xl font-bold tracking-tight gradient-text">{t('sidebar.subtitle')}</div>

        {/* 不确定进度条 */}
        <div className="mt-7 h-1 w-60 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="splash-bar h-full w-1/3 rounded-full bg-gradient-to-r from-primary to-info" />
        </div>

        {/* 分阶段文案 */}
        <p key={stage} className="mt-4 animate-fade-in text-xs text-muted-foreground/70">
          {t(STAGES[stage])}
        </p>
      </div>
    </div>
  )
}
