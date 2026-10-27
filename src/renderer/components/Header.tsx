import { cn } from '@/lib/utils'
import { HeartPulse, Activity, Sun, Moon, Globe, Monitor, TerminalSquare, Search } from 'lucide-react'
import { navItems } from './Sidebar'
import type { WatcherStatus } from '@/App'
import { useTheme } from '@/lib/theme'
import { useI18n } from '@/lib/i18n'

interface HeaderProps {
  activeTab: string
  watcherStatus: WatcherStatus
  cliRunningCount?: number
  onOpenCliConsole?: () => void
  onOpenSearch?: () => void
}

// heartbeat 原先是一个每秒自增的 state，仅用于让心跳图标隔秒闪烁；这会让 App 每秒
// 重渲染整棵页面树（Dashboard 的图表/事件列表一并被调和），是本应用最稳定的一处
// 周期性卡顿源。改用纯 CSS 的 pulse 动画后不再需要任何定时器与重渲染。
export function Header({ activeTab, watcherStatus, cliRunningCount = 0, onOpenCliConsole, onOpenSearch }: HeaderProps) {
  const { t } = useI18n()
  const labelKey = navItems.find((n) => n.id === activeTab)?.labelKey
  const label = labelKey ? t(labelKey) : ''
  const { mode, theme, toggleTheme } = useTheme()
  const { locale, setLocale } = useI18n()

  return (
    <header className="app-region-drag flex h-14 items-center justify-between border-b border-white/[0.06] px-8">
      {/* ── Page Title ── */}
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">{label}</h1>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">{t('header.subtitle')}</p>
      </div>

      {/* ── Actions ── */}
      <div className="app-region-no-drag flex items-center gap-2">
        {/* 全局搜索触发 */}
        <button
          onClick={onOpenSearch}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200',
            'border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] hover:border-white/12'
          )}
          title={t('search.open')}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('search.placeholder_short')}</span>
          <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 text-[10px] text-muted-foreground/70 sm:inline">⌘K</kbd>
        </button>

        {/* Language Toggle */}
        <button
          onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200',
            'border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] hover:border-white/12'
          )}
          title={locale === 'zh-CN' ? 'Switch to English' : '切换到中文'}
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{locale === 'zh-CN' ? 'EN' : '中'}</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200',
            'border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] hover:border-white/12'
          )}
          title={mode === 'system' ? t('theme.system') : (theme === 'dark' ? t('theme.light') : t('theme.dark'))}
        >
          {mode === 'system' ? <Monitor className="h-3.5 w-3.5" /> : (theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />)}
          <span>{mode === 'system' ? t('theme.system') : (theme === 'dark' ? t('theme.light') : t('theme.dark'))}</span>
        </button>

        {/* Unified Monitoring Status — single indicator (FIX: was duplicated before) */}
        <div className={cn(
          'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-all duration-300',
          watcherStatus.active
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-white/[0.04] border border-white/[0.08] text-muted-foreground/60'
        )}>
          <HeartPulse className={cn(
            'h-3.5 w-3.5',
            watcherStatus.active && 'animate-pulse'
          )} />
          <span>
            {watcherStatus.active ? t('header.monitoring') : t('header.stopped')}
          </span>
          {watcherStatus.active && watcherStatus.paths.length > 0 && (
            <span className="text-emerald-400/50">· {watcherStatus.paths.length} {t('header.targets')}</span>
          )}
        </div>

        {/* Process Tracker Status (only when active and has tracker) */}
        {watcherStatus.active && watcherStatus.processTracker?.active && (
          <div className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium',
            'bg-primary/10 border border-primary/15 text-primary'
          )}>
            <Activity className="h-3.5 w-3.5" />
            <span>{watcherStatus.processTracker.mode === 'etw' ? 'ETW' : 'Snapshot'}</span>
            <span className="text-primary/50">· {watcherStatus.processTracker.eventCount.toLocaleString()}</span>
          </div>
        )}

        {/* Background CLI tasks indicator — click to reopen the persistent console */}
        {cliRunningCount > 0 && (
          <button
            onClick={onOpenCliConsole}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-all duration-200',
              'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
            )}
            title={t('cli.close_console_hint')}
          >
            <TerminalSquare className="h-3.5 w-3.5 animate-pulse" />
            <span>
              {cliRunningCount} {t('cli.tasks_indicator')}
            </span>
          </button>
        )}
      </div>
    </header>
  )
}
