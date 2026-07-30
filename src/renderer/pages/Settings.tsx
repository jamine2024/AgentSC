import { useEffect, useState } from 'react'
import { Settings, Database, HardDrive, Bell, Monitor, Power, FileWarning, Palette, Moon, Sun, Check, Brain, Clock, Sparkles, Trash2, Zap, Globe, User, MessageCircle, Copy, FileText, Shield, AlertTriangle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { useTheme, ACCENTS } from '@/lib/theme'
import LegalModal from '@/components/LegalModal'
import { TOS_CONTENT, PRIVACY_CONTENT, DISCLAIMER_CONTENT } from '@/lib/legal'

interface StorageStats {
  events: number
  cleanerLogs: number
}

/* ══════════════════════════════════════════════════════════════
   STAT CARD — 数据统计卡片（通用/数据页）
   ══════════════════════════════════════════════════════════════ */
function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="glass glass-hover group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:border-primary/20">
      {/* 微光装饰 */}
      <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-br from-primary/8 to-transparent blur-2xl transition-opacity duration-300 group-hover:opacity-100 opacity-0" />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums gradient-text">{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/12 to-info/8 border border-primary/10 text-primary shadow-sm shadow-primary/5">
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   SETTING ROW — 单行设置项（图标 + 标题 + 描述 + 控件）
   ══════════════════════════════════════════════════════════════ */
function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="glass glass-hover group relative flex flex-col gap-3 rounded-2xl p-4 transition-all duration-200 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3.5 min-w-0 flex-1">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 to-info/6 border border-primary/8 text-primary/80 transition-colors group-hover:text-primary group-hover:border-primary/15">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-foreground/90">{title}</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">{description}</div>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   SECTION CARD — 分区卡片容器
   ══════════════════════════════════════════════════════════════ */
function SectionCard({
  icon: Icon,
  iconClass,
  title,
  desc,
  children,
  action,
}: {
  icon: React.ElementType
  iconClass: string
  title: string
  desc?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="glass group relative overflow-hidden rounded-2xl transition-all duration-300 hover:border-primary/15">
      {/* 顶部微光条 */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />

      <div className="p-6 pb-5">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl border backdrop-blur-sm', iconClass)}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight text-foreground">{title}</h2>
              {desc && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">{desc}</p>}
            </div>
          </div>
          {action && <div>{action}</div>}
        </div>
        {children}
      </div>
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════
   TAB 类型 & 配置
   ══════════════════════════════════════════════════════════════ */
type TabId = 'appearance' | 'general' | 'notifications' | 'ai' | 'data' | 'about'

const TABS: { id: TabId; icon: React.ElementType; labelKey: string }[] = [
  { id: 'appearance', icon: Palette, labelKey: 'settings.tab.appearance' },
  { id: 'general', icon: Settings, labelKey: 'settings.tab.general' },
  { id: 'notifications', icon: Bell, labelKey: 'settings.tab.notifications' },
  { id: 'ai', icon: Brain, labelKey: 'settings.tab.ai' },
  { id: 'data', icon: Database, labelKey: 'settings.tab.data' },
  { id: 'about', icon: Info, labelKey: 'settings.tab.about' },
]

/* ══════════════════════════════════════════════════════════════
   SETTINGS PAGE — 主组件
   ══════════════════════════════════════════════════════════════ */
export default function SettingsPage() {
  const api = window.electronAPI
  const { t, locale } = useI18n()
  const { mode, accent, setMode, setAccent } = useTheme()
  const [version, setVersion] = useState('0.1.0')
  const [stats, setStats] = useState<StorageStats>({ events: 0, cleanerLogs: 0 })
  const [clearing, setClearing] = useState<'events' | 'logs' | null>(null)
  const [message, setMessage] = useState('')

  // GPU 硬件加速界面渲染
  const [gpuAcceleration, setGpuAcceleration] = useState(true)
  const [gpuApplied, setGpuApplied] = useState(true) // 当前已生效值（启动时读取）

  // 当前设置分类 TAB
  const [activeTab, setActiveTab] = useState<TabId>('appearance')

  // 开机自启
  const [autoStart, setAutoStart] = useState(false)

  // 托盘设置
  const [minimizeToTray, setMinimizeToTray] = useState(true)

  // 大文件阈值 (MB)
  const [thresholdInput, setThresholdInput] = useState('100')

  // AI 洞察配置
  interface AiProviderConfig {
    provider: 'ollama' | 'openai'
    endpoint: string
    model: string
    apiKey?: string
  }
  const AI_DEFAULT_CONFIG: AiProviderConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'qwen2.5',
    apiKey: '',
  }
  const AI_INTERVAL_OPTIONS = [0, 2, 4, 6, 12, 24]
  const [aiConfig, setAiConfig] = useState<AiProviderConfig>(AI_DEFAULT_CONFIG)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiIntervalHours, setAiIntervalHours] = useState(0)
  const [aiLastGenerated, setAiLastGenerated] = useState<number | null>(null)
  const [aiNextRunAt, setAiNextRunAt] = useState<number | null>(null)

  // ── 关于信息（官网 / 开发者 / QQ） ──
  const WEBSITE_URL = 'https://box.fiime.cn/agentsc'
  const DEVELOPER_QQ = '741500926'
  const [copied, setCopied] = useState(false)
  // 当前打开的协议弹窗：null = 关闭；'tos' | 'privacy' | 'disclaimer' = 对应协议
  const [activeDoc, setActiveDoc] = useState<null | 'tos' | 'privacy' | 'disclaimer'>(null)
  const handleOpenWebsite = () => {
    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('open-external', WEBSITE_URL).catch(() => {})
    }
  }
  const handleCopyQQ = async () => {
    try {
      await navigator.clipboard.writeText(DEVELOPER_QQ)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // 剪贴板不可用时静默忽略
    }
  }

  useEffect(() => {
    api?.invoke('get-app-version').then((v) => {
      if (typeof v === 'string') setVersion(v)
    })
    loadStats()

    // 读取开机自启状态
    api?.invoke('get-auto-start').then((v) => {
      if (typeof v === 'boolean') setAutoStart(v)
    })

    // 读取托盘设置
    api?.invoke('get-minimize-to-tray').then((v) => {
      if (typeof v === 'boolean') setMinimizeToTray(v)
    })

    // 读取 GPU 加速设置（当前生效值）
    api?.invoke('get-gpu-acceleration').then((v) => {
      if (typeof v === 'boolean') {
        setGpuAcceleration(v)
        setGpuApplied(v)
      }
    })

    // 读取大文件阈值
    api?.invoke('get-large-file-threshold').then((v) => {
      if (typeof v === 'number') {
        setThresholdInput(String(v))
      }
    })

    // 读取 AI 洞察配置与定时状态
    api?.invoke('get-ai-config').then((v) => {
      if (v && typeof v === 'object') {
        setAiConfig({ ...AI_DEFAULT_CONFIG, ...(v as AiProviderConfig) })
      }
    })
    api?.invoke('get-ai-insights-status').then((s) => {
      if (s && typeof s === 'object') {
        const st = s as { intervalHours?: number; lastResult?: { generatedAt?: number }; nextRunAt?: number | null }
        if (typeof st.intervalHours === 'number') setAiIntervalHours(st.intervalHours)
        if (st.lastResult && typeof st.lastResult.generatedAt === 'number') setAiLastGenerated(st.lastResult.generatedAt)
        if (typeof st.nextRunAt === 'number') setAiNextRunAt(st.nextRunAt)
      }
    })
  }, [])

  // 监听主进程推送的状态变化
  useEffect(() => {
    api?.on('auto-start-changed', (enabled: unknown) => {
      if (typeof enabled === 'boolean') setAutoStart(enabled)
    })
    api?.on('minimize-tray-changed', (enabled: unknown) => {
      if (typeof enabled === 'boolean') setMinimizeToTray(enabled)
    })
    return () => {
      api?.removeAllListeners('auto-start-changed')
      api?.removeAllListeners('minimize-tray-changed')
    }
  }, [])


  async function loadStats() {
    const s = await api?.invoke('get-storage-stats')
    if (s && typeof s === 'object') {
      setStats(s as StorageStats)
    }
  }

  async function handleClearEvents() {
    if (!confirm(t('settings.clear_events_confirm'))) return
    setClearing('events')
    setMessage('')
    try {
      await api?.invoke('clear-file-events')
      await loadStats()
      setMessage(t('settings.events_cleared'))
    } catch (err) {
      setMessage(t('settings.clear_failed') + String(err))
    } finally {
      setClearing(null)
    }
  }

  async function handleClearLogs() {
    if (!confirm(t('settings.clear_logs_confirm'))) return
    setClearing('logs')
    setMessage('')
    try {
      await api?.invoke('clear-cleaner-logs')
      await loadStats()
      setMessage(t('settings.logs_cleared'))
    } catch (err) {
      setMessage(t('settings.clear_failed') + String(err))
    } finally {
      setClearing(null)
    }
  }

  async function handleAutoStartChange(checked: boolean) {
    setAutoStart(checked)
    await api?.invoke('set-auto-start', checked)
    setMessage(checked ? t('settings.auto_start_enabled') : t('settings.auto_start_disabled'))
  }

  async function handleMinimizeToTrayChange(checked: boolean) {
    setMinimizeToTray(checked)
    await api?.invoke('set-minimize-to-tray', checked)
    setMessage(checked ? t('settings.minimize_tray_enabled') : t('settings.minimize_tray_disabled'))
  }

  async function handleGpuAccelerationChange(checked: boolean) {
    setGpuAcceleration(checked)
    await api?.invoke('set-gpu-acceleration', checked)
    setMessage(t('settings.gpu_saved'))
  }

  async function handleRelaunch() {
    await api?.invoke('relaunch-app').catch(() => {})
  }

  async function handleThresholdSave() {
    const val = parseInt(thresholdInput, 10)
    if (isNaN(val) || val < 1) {
      setMessage(t('settings.threshold_invalid'))
      return
    }
    await api?.invoke('set-large-file-threshold', val)
    setMessage(`${t('settings.threshold_set')} ${val} MB`)
  }

  async function handleTestNotification() {
    await api?.invoke('show-notification', 'AgentSC', t('settings.test_notification_desc'))
    setMessage(t('settings.test_sent'))
  }

  async function handleSaveAiConfig() {
    setAiSaving(true)
    setMessage('')
    try {
      const next = { ...aiConfig, apiKey: aiConfig.provider === 'ollama' ? '' : aiConfig.apiKey }
      const saved = await api?.invoke('set-ai-config', next)
      if (saved && typeof saved === 'object') {
        setAiConfig({ ...AI_DEFAULT_CONFIG, ...(saved as AiProviderConfig) })
      }
      setMessage(t('ai.config_saved'))
    } catch (err) {
      setMessage(t('ai.save_failed') + '：' + String(err))
    } finally {
      setAiSaving(false)
    }
  }

  async function handleAiIntervalChange(hours: number) {
    setAiIntervalHours(hours)
    setMessage('')
    try {
      const status = await api?.invoke('set-ai-insights-interval', hours)
      if (status && typeof status === 'object') {
        const st = status as { intervalHours?: number; nextRunAt?: number | null }
        if (typeof st.intervalHours === 'number') setAiIntervalHours(st.intervalHours)
        if (typeof st.nextRunAt === 'number') setAiNextRunAt(st.nextRunAt)
      }
      setMessage(t('ai.auto_set'))
    } catch (err) {
      setMessage(t('ai.save_failed') + '：' + String(err))
    }
  }

  /* ═══════════════════════════════════════════════════════════
     TAB 内容渲染
     ═══════════════════════════════════════════════════════════ */
  function renderTabContent() {
    switch (activeTab) {
      case 'appearance':
        return (
          <SectionCard
            icon={Palette}
            iconClass="bg-gradient-to-br from-violet-500/15 to-indigo-500/10 border-violet-500/15 text-violet-400"
            title={t('appearance.title')}
            desc={t('appearance.desc')}
          >
            {/* ── 主题模式：可视化卡片选择 ── */}
            <div className="mb-7">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary/70" />
                <span className="text-[12px] font-semibold uppercase tracking-wider text-foreground/75">{t('appearance.theme')}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-lg sm:grid-cols-3">
                {(['dark', 'light', 'system'] as const).map((m) => {
                  const isActive = mode === m
                  const isLight = m === 'light'
                  return (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={cn(
                        'group relative flex flex-col items-center gap-2.5 rounded-2xl border p-4 transition-all duration-250 cursor-pointer',
                        isActive
                          ? 'border-primary/35 bg-primary/[0.06] shadow-lg shadow-primary/8'
                          : 'border-border/60 bg-card/60 hover:border-border hover:bg-card',
                      )}
                    >
                      {/* 选中指示器光晕 */}
                      {isActive && (
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-primary/[0.04] to-transparent pointer-events-none" />
                      )}

                      {/* 预览窗口 */}
                      <div className={cn(
                        'relative h-16 w-full rounded-xl overflow-hidden border transition-all duration-200',
                        isActive
                          ? 'border-primary/25 shadow-sm'
                          : isLight ? 'border-black/[0.08]' : 'border-white/[0.08]',
                        m === 'light'
                          ? 'bg-[#f8fafc]'
                          : m === 'system'
                            ? 'bg-gradient-to-br from-[#0b0f19] to-[#f8fafc]'
                            : 'bg-[#0b0f19]',
                      )}>
                        {/* 窗口标题栏 */}
                        <div className={cn(
                          'flex items-center gap-1 px-2 py-1.5',
                          isLight ? 'bg-black/[0.04]' : 'bg-white/[0.06]',
                        )}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', isLight ? 'bg-red-400' : 'bg-red-400/70')} />
                          <span className={cn('h-1.5 w-1.5 rounded-full', isLight ? 'bg-yellow-400' : 'bg-yellow-400/70')} />
                          <span className={cn('h-1.5 w-1.5 rounded-full', isLight ? 'bg-green-400' : 'bg-green-400/70')} />
                          <div className={cn('ml-auto h-1.5 w-8 rounded-full', isLight ? 'bg-black/[0.06]' : 'bg-white/[0.08]')} />
                        </div>
                        {/* 内容区域示意 */}
                        <div className="flex gap-1 p-2">
                          <div className={cn('h-6 w-6 rounded-md', isLight ? 'bg-indigo-500/20' : 'bg-indigo-500/30')} />
                          <div className="flex-1 space-y-1 pt-0.5">
                            <div className={cn('h-1.5 w-3/4 rounded-full', isLight ? 'bg-black/[0.07]' : 'bg-white/[0.07]')} />
                            <div className={cn('h-1.5 w-1/2 rounded-full', isLight ? 'bg-black/[0.05]' : 'bg-white/[0.05]')} />
                          </div>
                        </div>
                        {/* 图标覆盖层 */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200',
                            isActive
                              ? 'bg-primary/20 text-primary scale-100 shadow-sm'
                              : isLight ? 'bg-black/[0.04] text-black/30 scale-90' : 'bg-white/[0.06] text-white/40 scale-90',
                          )}>
                            {m === 'dark' ? <Moon className="h-4 w-4" /> : m === 'light' ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                          </div>
                        </div>
                      </div>

                      {/* 标签 */}
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          'text-[12px] font-medium transition-colors',
                          isActive ? 'text-foreground' : 'text-muted-foreground/60 group-hover:text-muted-foreground',
                        )}>
                          {m === 'dark' ? t('theme.dark') : m === 'light' ? t('theme.light') : t('theme.system')}
                        </span>
                        {isActive && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 分隔线 */}
            <div className="mb-7 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            {/* ── 品牌配色：增强色板 ── */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Palette className="h-3.5 w-3.5 text-primary/70" />
                <span className="text-[12px] font-semibold uppercase tracking-wider text-foreground/75">{t('appearance.accent')}</span>
              </div>
              <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground/70">{t('appearance.accent_desc')}</p>

              <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
                {ACCENTS.map((a) => {
                  const selected = accent === a.id
                  const label = locale === 'en' ? a.labelEn : a.labelZh
                  return (
                    <button
                      key={a.id}
                      onClick={() => setAccent(a.id)}
                      title={label}
                      className={cn(
                        'group relative flex flex-col items-center gap-2 rounded-2xl border p-3 transition-all duration-200 cursor-pointer',
                        selected
                          ? 'border-primary/30 bg-primary/[0.05] shadow-lg shadow-primary/10'
                          : 'border-border/60 bg-card/60 hover:border-border hover:bg-card',
                      )}
                    >
                      {/* 色环 + 发光效果 */}
                      <div className="relative">
                        {selected && (
                          <>
                            <div
                              className="absolute -inset-1.5 rounded-full opacity-40 blur-md transition-opacity duration-300"
                              style={{ background: a.swatch }}
                            />
                            <div
                              className="absolute -inset-0.5 rounded-full opacity-20 blur-sm transition-opacity duration-300"
                              style={{ background: a.swatch }}
                            />
                          </>
                        )}
                        <span
                          className={cn(
                            'relative block h-9 w-9 rounded-full ring-1 ring-white/10 transition-transform duration-200',
                            selected ? 'scale-110 ring-white/20 shadow-md' : 'group-hover:scale-105',
                          )}
                          style={{ background: a.swatch }}
                        />
                      </div>

                      {/* 标签 */}
                      <span className={cn(
                        'text-[10.5px] font-medium transition-colors leading-tight text-center',
                        selected ? 'text-foreground' : 'text-muted-foreground/55 group-hover:text-muted-foreground/80',
                      )}>
                        {label}
                      </span>

                      {/* 选中勾 */}
                      {selected && (
                        <div className="absolute right-1.5 top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-background/90 border border-current text-primary shadow-sm">
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </SectionCard>
        )

      case 'general':
        return (
          <SectionCard
            icon={Monitor}
            iconClass="bg-gradient-to-br from-cyan-500/12 to-blue-500/8 border-info/10 text-info"
            title={t('settings.general')}
            desc={t('settings.general_desc')}
          >
            <div className="space-y-3">
              <SettingRow icon={Power} title={t('settings.auto_start')} description={t('settings.auto_start_desc')}>
                <Switch checked={autoStart} onCheckedChange={handleAutoStartChange} />
              </SettingRow>

              <SettingRow icon={Monitor} title={t('settings.minimize_tray')} description={t('settings.minimize_tray_desc')}>
                <Switch checked={minimizeToTray} onCheckedChange={handleMinimizeToTrayChange} />
              </SettingRow>

              <SettingRow icon={Zap} title={t('settings.gpu_acceleration')} description={t('settings.gpu_acceleration_desc')}>
                <div className="flex items-center gap-2.5">
                  <Switch checked={gpuAcceleration} onCheckedChange={handleGpuAccelerationChange} />
                  {gpuAcceleration !== gpuApplied && (
                    <Button size="sm" variant="secondary" onClick={handleRelaunch} className="h-9 text-xs rounded-lg px-3">
                      {t('settings.restart_now')}
                    </Button>
                  )}
                </div>
              </SettingRow>
            </div>
          </SectionCard>
        )

      case 'about':
        return (
          <>
            <SectionCard
              icon={HardDrive}
              iconClass="bg-gradient-to-br from-primary/15 to-info/10 border-primary/10 text-primary"
              title={t('settings.title')}
              desc={t('settings.subtitle')}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <StatCard label={t('settings.version')} value={`v${version}`} icon={HardDrive} />
                <StatCard label={t('settings.event_records')} value={stats.events.toLocaleString()} icon={Database} />
                <StatCard label={t('settings.cleaner_logs')} value={stats.cleanerLogs.toLocaleString()} icon={Database} />
              </div>
            </SectionCard>

            <SectionCard
              icon={Sparkles}
              iconClass="bg-gradient-to-br from-primary/15 to-info/10 border-primary/10 text-primary"
              title={t('settings.about')}
              desc={t('settings.about_desc')}
            >
              <div className="space-y-3">
                <SettingRow
                  icon={Globe}
                  title={t('settings.website')}
                  description={t('settings.website_desc')}
                >
                  <button
                    type="button"
                    onClick={handleOpenWebsite}
                    className="group/btn flex h-9 items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 text-xs text-primary transition-all hover:border-primary/40 hover:bg-primary/[0.14]"
                  >
                    <span className="tabular-nums">{WEBSITE_URL.replace(/^https?:\/\//, '')}</span>
                    <Globe className="h-3.5 w-3.5 transition-transform group-hover/btn:scale-110" />
                  </button>
                </SettingRow>

                <SettingRow
                  icon={User}
                  title={t('settings.developer')}
                  description={t('settings.developer_desc')}
                >
                  <span className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground/80">
                    奥奥
                  </span>
                </SettingRow>

                <SettingRow
                  icon={MessageCircle}
                  title={t('settings.qq')}
                  description={t('settings.qq_desc')}
                >
                  <button
                    type="button"
                    onClick={handleCopyQQ}
                    className="group/btn flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs tabular-nums text-foreground/80 transition-all hover:border-primary/25 hover:bg-accent hover:text-primary"
                  >
                    <span>{DEVELOPER_QQ}</span>
                    {copied
                      ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                      : <Copy className="h-3.5 w-3.5 transition-transform group-hover/btn:scale-110" />}
                  </button>
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              icon={FileText}
              iconClass="bg-gradient-to-br from-violet-500/12 to-primary/8 border-primary/10 text-primary"
              title={t('settings.legal')}
              desc={t('settings.legal_desc')}
            >
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setActiveDoc('tos')}
                  className="group/legal flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-all hover:border-primary/25 hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-foreground/85 group-hover/legal:text-primary">{t('settings.tos')}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/50">{t('settings.tos_desc')}</span>
                  </span>
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover/legal:scale-110" />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveDoc('privacy')}
                  className="group/legal flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-all hover:border-primary/25 hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-foreground/85 group-hover/legal:text-primary">{t('settings.privacy')}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/50">{t('settings.privacy_desc')}</span>
                  </span>
                  <Shield className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover/legal:scale-110" />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveDoc('disclaimer')}
                  className="group/legal flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-all hover:border-primary/25 hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-foreground/85 group-hover/legal:text-primary">{t('settings.disclaimer')}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/50">{t('settings.disclaimer_desc')}</span>
                  </span>
                  <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover/legal:scale-110" />
                </button>
              </div>
            </SectionCard>

            <LegalModal
              open={activeDoc !== null}
              title={activeDoc === 'tos' ? t('settings.tos') : activeDoc === 'privacy' ? t('settings.privacy') : activeDoc === 'disclaimer' ? t('settings.disclaimer') : ''}
              onClose={() => setActiveDoc(null)}
            >
              {activeDoc === 'tos' && TOS_CONTENT}
              {activeDoc === 'privacy' && PRIVACY_CONTENT}
              {activeDoc === 'disclaimer' && DISCLAIMER_CONTENT}
            </LegalModal>
          </>
        )

      case 'notifications':
        return (
          <SectionCard
            icon={Bell}
            iconClass="bg-gradient-to-br from-amber-500/12 to-orange-500/8 border-warning/10 text-warning"
            title={t('settings.notification')}
            desc={t('settings.notification_desc')}
          >
            <div className="space-y-3">
              <SettingRow
                icon={FileWarning}
                title={t('settings.large_file_threshold')}
                description={t('settings.large_file_threshold_desc')}
              >
                <div className="flex items-center gap-2.5">
                  <Input
                    type="number"
                    min={0}
                    max={99999}
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    className="h-9 w-24 text-xs rounded-xl"
                  />
                  <span className="text-[11px] text-muted-foreground/50 tabular-nums">MB</span>
                  <Button size="sm" variant="secondary" onClick={handleThresholdSave} className="h-9 text-xs rounded-lg px-3">
                    {t('common.save')}
                  </Button>
                </div>
              </SettingRow>

              <SettingRow icon={Bell} title={t('settings.test_notification')} description={t('settings.test_notification_desc')}>
                <Button size="sm" variant="secondary" onClick={handleTestNotification} className="h-9 text-xs rounded-lg px-3">
                  {t('settings.send_test')}
                </Button>
              </SettingRow>
            </div>
          </SectionCard>
        )

      case 'ai':
        return (
          <>
            <SectionCard
              icon={Clock}
              iconClass="bg-gradient-to-br from-emerald-500/12 to-teal-500/8 border-success/10 text-success"
              title={t('settings.auto_insights')}
              desc={t('settings.auto_insights_desc')}
            >
              <div className="space-y-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <Zap className="h-4 w-4 text-success/60" />
                    <label className="text-xs font-medium text-foreground/80">{t('ai.auto_interval')}</label>
                    <select
                      value={aiIntervalHours}
                      onChange={(e) => handleAiIntervalChange(Number(e.target.value))}
                      className="h-9 rounded-xl border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    >
                      {AI_INTERVAL_OPTIONS.map((h) => (
                        <option key={h} value={h}>
                          {h === 0 ? t('ai.auto_off') : `${t('ai.every')} ${h} ${t('ai.hours')}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[11px] text-muted-foreground/60">
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      {t('ai.last_generated')}：
                      <span className="font-medium text-foreground/70">
                        {aiLastGenerated ? new Date(aiLastGenerated).toLocaleString() : t('common.no_data')}
                      </span>
                    </span>
                    {aiIntervalHours > 0 && (
                      <span className="flex items-center gap-1.5">
                        <Zap className="h-3 w-3" />
                        {t('ai.next_run')}：
                        <span className="font-medium text-foreground/70">
                          {aiNextRunAt ? new Date(aiNextRunAt).toLocaleString() : '-'}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              icon={Brain}
              iconClass="bg-gradient-to-br from-violet-500/15 to-purple-500/10 border-violet-500/15 text-violet-400"
              title={t('settings.ai_config')}
              desc={t('settings.ai_config_desc')}
            >
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
                <div className="space-y-1.5 lg:col-span-1">
                  <label className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">{t('ai.provider')}</label>
                  <select
                    value={aiConfig.provider}
                    onChange={(e) => setAiConfig((prev) => ({ ...prev, provider: e.target.value as AiProviderConfig['provider'] }))}
                    className="h-9 w-full rounded-xl border border-border bg-card px-3 text-xs text-foreground outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  >
                    <option value="ollama">{t('ai.ollama')}</option>
                    <option value="openai">{t('ai.openai')}</option>
                  </select>
                </div>

                <div className="space-y-1.5 lg:col-span-1">
                  <label className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">{t('ai.endpoint')}</label>
                  <Input
                    value={aiConfig.endpoint}
                    onChange={(e) => setAiConfig((prev) => ({ ...prev, endpoint: e.target.value }))}
                    placeholder="http://localhost:11434"
                    className="rounded-xl text-xs h-9"
                  />
                </div>

                <div className="space-y-1.5 lg:col-span-1">
                  <label className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">{t('ai.model_name')}</label>
                  <Input
                    value={aiConfig.model}
                    onChange={(e) => setAiConfig((prev) => ({ ...prev, model: e.target.value }))}
                    placeholder="qwen2.5 / gpt-4o"
                    className="rounded-xl text-xs h-9"
                  />
                </div>

                <div className="space-y-1.5 lg:col-span-1">
                  <label className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">{t('ai.api_key')}</label>
                  <Input
                    type="password"
                    value={aiConfig.apiKey || ''}
                    onChange={(e) => setAiConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
                    placeholder={aiConfig.provider === 'ollama' ? t('ai.api_key_placeholder_ollama') : t('ai.api_key_placeholder_openai')}
                    disabled={aiConfig.provider === 'ollama'}
                    className="rounded-xl text-xs h-9"
                  />
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <Button variant="outline" onClick={handleSaveAiConfig} disabled={aiSaving} className="rounded-lg px-4 text-xs h-9">
                  {aiSaving ? t('ai.saving') : t('ai.save_config')}
                </Button>
              </div>
            </SectionCard>
          </>
        )

      case 'data':
        return (
          <SectionCard
            icon={Database}
            iconClass="bg-gradient-to-br from-red-500/12 to-pink-500/8 border-destructive/10 text-destructive"
            title={t('settings.data_management')}
          >
            <div className="space-y-3">
              <div className="glass group relative flex flex-col gap-3 rounded-2xl p-4 transition-all duration-200 hover:border-destructive/25 hover:bg-destructive/[0.03] md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 border border-destructive/10 text-destructive/70">
                    <Trash2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-foreground/90">{t('settings.clear_events')}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">{t('settings.clear_events_desc')}</div>
                  </div>
                </div>
                <Button variant="destructive" size="sm" disabled={clearing === 'events'} onClick={handleClearEvents} className="shrink-0 rounded-lg h-9 text-xs px-3">
                  {clearing === 'events' ? t('settings.clearing') : t('settings.clear_events_btn')}
                </Button>
              </div>

              <div className="glass group relative flex flex-col gap-3 rounded-2xl p-4 transition-all duration-200 hover:border-destructive/25 hover:bg-destructive/[0.03] md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 border border-destructive/10 text-destructive/70">
                    <Trash2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-foreground/90">{t('settings.clear_logs')}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">{t('settings.clear_logs_desc')}</div>
                  </div>
                </div>
                <Button variant="destructive" size="sm" disabled={clearing === 'logs'} onClick={handleClearLogs} className="shrink-0 rounded-lg h-9 text-xs px-3">
                  {clearing === 'logs' ? t('settings.clearing') : t('settings.clear_logs_btn')}
                </Button>
              </div>
            </div>
          </SectionCard>
        )

      default:
        return null
    }
  }

  /* ═══════════════════════════════════════════════════════════
     主渲染
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6">
      {/* ── 分类 TAB 导航：下划线指示器风格 ──
          mb-12 与外层 space-y-6 的 mt-6 取较大值，
          标签条下边框到首张卡片之间保持 48px 间距，不再贴在一起 */}
      <nav className="sticky top-0 z-10 -mx-8 -mt-8 mb-12 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="flex items-center gap-1 px-8">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-2 px-3.5 py-3.5 text-[12px] font-medium transition-all duration-200',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground/70 hover:text-muted-foreground',
                )}
              >
                <Icon className={cn('h-4 w-4 transition-colors duration-200', active ? 'text-primary' : '')} />
                {t(tab.labelKey)}
                {/* 下划线指示器 */}
                {active && (
                  <span className="absolute bottom-0 left-3 right-3 h-[2.5px] rounded-full bg-gradient-to-r from-primary to-info shadow-sm shadow-primary/40" />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* ── 全局操作反馈 toast ── */}
      {message && (
        <div className={cn(
          'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all duration-300 animate-in fade-in slide-in-from-bottom-2',
          message.includes('failed') || message.includes('失败')
            ? 'bg-destructive/8 text-destructive/90 border-destructive/20'
            : 'bg-emerald-500/8 text-emerald-400/90 border-emerald-500/15',
        )}>
          <Check className="h-3.5 w-3.5" />
          {message}
        </div>
      )}

      {renderTabContent()}
    </div>
  )
}
