import { useEffect, memo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Eye, LayoutDashboard, Watch, BarChart3, Calendar, Filter, Trash2, Settings, ScrollText, Wand2, Workflow, Bot, Cpu, Activity, PackageX, TerminalSquare, History, Blocks, ChevronRight, CalendarClock, HardDrive, MousePointerClick, MousePointer2, Gauge, Database, Route, Container, Clock, ShieldCheck, Power, Share2, BadgeCheck, Network } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

export interface NavItem {
  id: string
  labelKey: string
  icon: typeof LayoutDashboard
}

export interface NavGroup {
  id: string
  labelKey: string
  items: NavItem[]
}

// 按功能分类的分组（顺序即展示顺序）
export const navGroups: NavGroup[] = [
  {
    id: 'overview',
    labelKey: 'nav.group.overview',
    items: [
      { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
      { id: 'visualize', labelKey: 'nav.visualize', icon: Workflow },
      { id: 'tracking', labelKey: 'nav.tracking', icon: Watch },
    ],
  },
  {
    id: 'analysis',
    labelKey: 'nav.group.analysis',
    items: [
      { id: 'analysis', labelKey: 'nav.analysis', icon: BarChart3 },
      { id: 'reports', labelKey: 'nav.reports_insights', icon: Calendar },
    ],
  },
  {
    id: 'cleanup',
    labelKey: 'nav.group.cleanup',
    items: [
      { id: 'cleaner', labelKey: 'nav.cleaner', icon: Trash2 },
      { id: 'ai-cleanup', labelKey: 'nav.ai_cleanup', icon: Wand2 },
      { id: 'exclusions', labelKey: 'nav.exclusions', icon: Filter },
      { id: 'uninstaller', labelKey: 'nav.uninstaller', icon: PackageX },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.group.system',
    items: [
      { id: 'task-manager', labelKey: 'nav.task_manager', icon: Activity },
      { id: 'hardware', labelKey: 'nav.hardware', icon: Cpu },
      { id: 'mousekb', labelKey: 'nav.mousekb', icon: MousePointer2 },
      { id: 'wintask', labelKey: 'nav.wintask', icon: CalendarClock },
      { id: 'pcicons', labelKey: 'nav.pcicons', icon: HardDrive },
      { id: 'ctxmenu', labelKey: 'nav.ctxmenu', icon: MousePointerClick },
      { id: 'speedtest', labelKey: 'nav.speedtest', icon: Gauge },
      { id: 'eventviewer', labelKey: 'nav.eventviewer', icon: History },
      { id: 'registry', labelKey: 'nav.registry', icon: Database },
      { id: 'cert', labelKey: 'nav.cert', icon: BadgeCheck },
      { id: 'startup', labelKey: 'nav.startup', icon: Power },
      { id: 'timesync', labelKey: 'nav.timesync', icon: Clock },
      { id: 'logs', labelKey: 'nav.logs', icon: ScrollText },
      { id: 'lanshare', labelKey: 'nav.lanshare', icon: Share2 },
    ],
  },
  {
    id: 'devtools',
    labelKey: 'nav.group.devtools',
    items: [
      { id: 'ollama', labelKey: 'nav.ollama', icon: Bot },
      { id: 'cli', labelKey: 'nav.cli', icon: TerminalSquare },
      { id: 'devtools', labelKey: 'nav.devtools', icon: Blocks },
      { id: 'wsl', labelKey: 'nav.wsl', icon: Container },
    ],
  },
  {
    id: 'security',
    labelKey: 'nav.group.security',
    items: [
      { id: 'netsec', labelKey: 'nav.netsec', icon: ShieldCheck },
      { id: 'network', labelKey: 'nav.network', icon: Route },
      { id: 'packet_capture', labelKey: 'nav.packet_capture', icon: Network },
    ],
  },
]

// 固定底部的独立项（不折叠）
export const pinnedItems: NavItem[] = [
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
]

// 兼容旧调用：扁平化的全部菜单（含 pinned）
export const navItems: NavItem[] = [
  ...navGroups.flatMap((g) => g.items),
  ...pinnedItems,
]

const COLLAPSE_STORAGE_KEY = 'agentsc-sidebar-collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* ignore */
  }
  return new Set()
}

interface SidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
  version: string
}

export const Sidebar = memo(function Sidebar({ activeTab, onTabChange, version }: SidebarProps) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)

  // 持久化折叠状态
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(collapsed)))
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const toggleGroup = (groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // 分组是否展开：手动未折叠，或包含当前激活项时强制展开
  const isExpanded = (group: NavGroup) =>
    !collapsed.has(group.id) || group.items.some((i) => i.id === activeTab)

  const renderItem = (item: NavItem) => {
    const Icon = item.icon
    const active = activeTab === item.id
    return (
      <button
        key={item.id}
        onClick={() => onTabChange(item.id)}
        className={cn(
          'app-region-no-drag',
          'group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium border border-transparent transition-colors duration-200',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80'
        )}
      >
        {active && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-gradient-to-b from-primary to-info" />
        )}
        <span
          className={cn(
            'absolute inset-0 rounded-xl border border-transparent transition-colors duration-200',
            active
              ? 'bg-gradient-to-r from-primary/12 via-primary/6 to-transparent border-primary/10'
              : 'bg-transparent group-hover:bg-white/[0.03] group-hover:border-white/5'
          )}
        />
        <Icon
          className={cn(
            'relative h-4 w-4 shrink-0 transition-colors duration-200',
            active ? 'text-primary' : 'text-muted-foreground/60 group-hover:text-muted-foreground'
          )}
        />
        <span className="relative">{t(item.labelKey)}</span>
      </button>
    )
  }

  return (
    <aside className="flex w-60 flex-col border-r border-white/[0.06] bg-[hsl(var(--background))]">
      {/* ── Logo Area with gradient brand treatment ── */}
      <div className="app-region-drag relative flex h-16 items-center gap-3 px-5 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-info/5" />
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl brand-gradient shadow-lg shadow-primary/20">
          <Eye className="h-4.5 w-4.5 text-white" />
        </div>
        <div className="relative">
          <div className="text-[15px] font-bold tracking-tight text-foreground">AgentSC</div>
          <div className="mt-0.5 text-[10px] font-medium tracking-wider uppercase text-muted-foreground/70">{t('sidebar.subtitle')}</div>
        </div>
      </div>

      {/* ── Navigation (分组可折叠) ── */}
      <nav className="flex-1 space-y-3 px-3 py-3 overflow-y-auto transform-gpu">
        {navGroups.map((group) => {
          const expanded = isExpanded(group)
          return (
            <div key={group.id}>
              {/* 分组标题（可点击折叠） */}
              <button
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  'app-region-no-drag',
                  'group flex w-full items-center justify-between rounded-lg px-3 py-1.5',
                  'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50',
                  'hover:text-muted-foreground/80 transition-colors duration-150'
                )}
              >
                <span>{t(group.labelKey)}</span>
                <ChevronRight
                  className={cn(
                    'h-3 w-3 shrink-0 transition-transform duration-200',
                    expanded && 'rotate-90'
                  )}
                />
              </button>

              {/* 分组菜单项 */}
              {expanded && (
                <div className="mt-1 space-y-1">{group.items.map(renderItem)}</div>
              )}
            </div>
          )
        })}

        {/* ── 固定项（设置） ── */}
        <div className="mt-2 border-t border-white/[0.06] pt-3">{pinnedItems.map(renderItem)}</div>
      </nav>

      {/* ── Footer Status ── */}
      <div className="border-t border-white/[0.06] p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
          <span className="text-[10px] font-medium text-emerald-400/90">{t('sidebar.status_ready')}</span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground/50">v{version}</div>
      </div>
    </aside>
  )
})
