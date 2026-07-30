import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Sidebar, navItems } from './components/Sidebar'
import { Header } from './components/Header'
import Dashboard from './pages/Dashboard'
import Exclusions from './pages/Exclusions'
import Analysis from './pages/Analysis'
import Tracking from './pages/Tracking'
import Visualize from './pages/Visualize'
import ReportsInsights from './pages/ReportsInsights'
import Cleaner from './pages/Cleaner'
import AiCleanup, { type ScanResult, type RunDetail } from './pages/AiCleanup'
import Logs from './pages/Logs'
import SettingsPage from './pages/Settings'
import Ollama from './pages/Ollama'
import CliManager from './pages/CliManager'
import LanShare from './pages/LanShare'
import StartupManager from './pages/StartupManager'
import { CliConsoleDrawer } from './components/CliConsoleDrawer'
import { type CliRunState, stripAnsi, CLI_OUTPUT_CAP } from './lib/cliTypes'
import DevTools from './pages/DevTools'
import WslManager from './pages/WslManager'
import TaskManager from './pages/TaskManager'
import Uninstaller from './pages/Uninstaller'
import Hardware from './pages/Hardware'
import MouseKeyboard from './pages/MouseKeyboard'
import EventViewer from './pages/EventViewer'
import WinTaskScheduler from './pages/WinTaskScheduler'
import MyComputerIcons from './pages/MyComputerIcons'
import ContextMenu from './pages/ContextMenu'
import SpeedTest from './pages/SpeedTest'
import RegistryManager from './pages/RegistryManager'
import CertManager from './pages/CertManager'
import NetworkTracer from './pages/NetworkTracer'
import NetworkSecurity from './pages/NetworkSecurity'
import PacketCapture from './pages/PacketCapture'
import TimeSync from './pages/TimeSync'
import ToastContainer, { useToastNotifications } from './components/Toast'
import Splash from './components/Splash'
import { GlobalSearch } from './components/GlobalSearch'
import { useI18n } from './lib/i18n'

export interface WatcherStatus {
  active: boolean
  paths: string[]
  processTracker?: {
    active: boolean
    mode: 'etw' | 'snapshot' | 'idle'
    eventCount: number
    lastError?: string
  }
}

export interface ScanNode {
  name: string
  path: string
  size: number
  children?: ScanNode[]
}

export interface ReportData {
  startDay: string
  endDay: string
  generatedAt: number
  stats: {
    created_count: number
    deleted_count: number
    modified_count: number
    renamed_count: number
    created_bytes: number
    deleted_bytes: number
  }
  daily: Array<{
    day: string
    created_count: number
    deleted_count: number
    modified_count: number
    renamed_count: number
    created_bytes: number
    deleted_bytes: number
  }>
  topProcesses: { process_name: string; event_count: number }[]
  topCreated: Array<{ path: string; total_size: number; count: number }>
  topDeleted: Array<{ path: string; total_size: number; count: number }>
}

export type ReportType = 'day' | 'week' | 'month'

export interface AiInsightsResult {
  generatedAt: number
  source: 'ollama' | 'openai' | 'heuristic'
  model?: string
  summary: string
  anomalies: Array<{ title: string; description: string; severity: 'low' | 'medium' | 'high' }>
  suggestions: Array<{ title: string; description: string; action: string }>
  error?: string
}

export class AppErrorBoundary extends Component<{ children: ReactNode }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-black text-white p-8">
          <div className="text-4xl">⚠</div>
          <h1 className="text-xl font-bold">应用运行时错误</h1>
          <pre className="max-w-lg text-sm text-red-400/80 whitespace-pre-wrap text-center">{this.state.error.message}</pre>
          <pre className="max-w-lg text-xs text-white/40 whitespace-pre-wrap text-center">{this.state.error.stack?.split('\n').slice(1, 4).join('\n')}</pre>
          <button
            className="mt-4 rounded-lg bg-white/10 px-6 py-2 text-sm hover:bg-white/20 transition-colors"
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const api = window.electronAPI
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState('dashboard')

  // 启动引导：Splash 覆盖层状态（首次进入看板前显示，数据就绪后淡出）
  const [showSplash, setShowSplash] = useState(true)
  const [splashVisible, setSplashVisible] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const bootStartRef = useRef(Date.now())
  const readyFiredRef = useRef(false)
  const [version, setVersion] = useState('0.1.0')
  const [heartbeat, setHeartbeat] = useState(0)
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus>({ active: false, paths: [] })

  // 全局扫描状态（跨标签页保持）
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanNode | null>(null)
  const [scanError, setScanError] = useState('')
  const [scanSelectedPath, setScanSelectedPath] = useState('')

  // 全局报告状态（跨标签页保持）
  const [report, setReport] = useState<ReportData | null>(null)
  const [reportType, setReportType] = useState<ReportType>('day')
  const [reportDateValue, setReportDateValue] = useState(() => {
    const d = new Date()
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  })
  const [reportMonthValue, setReportMonthValue] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  // 全局 AI 洞察状态（跨标签页保持）
  const [aiResult, setAiResult] = useState<AiInsightsResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // 全局 AI 清理状态（跨标签页保持）。原先这些状态在 AiCleanup 组件内部，
  // 切到别的 tab 时组件被卸载，状态与正在进行的 IPC 结果一并丢失，导致切回后
  // 看起来"没有执行"。提升到 App 后，卸载的 AiCleanup 通过 props 回写结果，
  // 重新挂载时也能从全局状态恢复进度与结果。
  const [aiCleanTarget, setAiCleanTarget] = useState('')
  const [aiCleanLargeMb, setAiCleanLargeMb] = useState(500)
  const [aiCleanOldDays, setAiCleanOldDays] = useState(180)
  const [aiCleanScanning, setAiCleanScanning] = useState(false)
  const [aiCleanRunning, setAiCleanRunning] = useState(false)
  const [aiCleanResult, setAiCleanResult] = useState<ScanResult | null>(null)
  const [aiCleanSelected, setAiCleanSelected] = useState<Set<string>>(new Set())
  const [aiCleanMessage, setAiCleanMessage] = useState('')
  const [aiCleanFailed, setAiCleanFailed] = useState<RunDetail[]>([])

  // 全局 CLI 运行态（跨标签页保持）。原先运行态在 CliManager 组件内部，
  // 切到别的 tab 时组件被卸载，监听器丢失、输出被丢弃，后台进程变成孤儿进程，
  // 切回后"看不到也接不回"。提升到 App 后，监听器在 App 挂载期间常驻，
  // 切 tab 不影响后台进程，输出实时累计，控制台抽屉也始终挂载。
  const [cliRuns, setCliRuns] = useState<CliRunState[]>([])
  const [cliConsoleOpen, setCliConsoleOpen] = useState(false)
  const [cliActiveRunId, setCliActiveRunId] = useState<string | null>(null)

  // 右下角 Toast 通知
  const { toasts, dismissToast } = useToastNotifications()

  useEffect(() => {
    // 启动引导：看板首屏数据就绪后收起 Splash
    // 1) 监听 dashboard:ready；2) 保证最短展示时长，避免一闪而过；3) 兜底超时防卡死
    const finishBoot = () => {
      if (readyFiredRef.current) return
      readyFiredRef.current = true
      const elapsed = Date.now() - bootStartRef.current
      const wait = Math.max(0, 900 - elapsed)
      setTimeout(() => {
        setSplashVisible(false)
        setTimeout(() => setShowSplash(false), 600)
      }, wait)
    }
    const onReady = () => finishBoot()
    window.addEventListener('dashboard:ready', onReady)
    const bootFallback = setTimeout(finishBoot, 4000)

    api?.invoke('get-app-version').then((v) => {
      if (typeof v === 'string') setVersion(v)
    })

    // 进入应用即加载最近一次 AI 洞察结果，避免 AI 洞察页总是空白
    api?.invoke('get-ai-insights-status').then((s) => {
      if (s && typeof s === 'object') {
        const st = s as { lastResult?: AiInsightsResult }
        if (st.lastResult) setAiResult(st.lastResult)
      }
    }).catch(() => {})

    // 后台定时洞察完成后，实时刷新全局结果（App 是该频道的唯一监听者）
    const onAiUpdated = (payload: unknown) => {
      if (payload && typeof payload === 'object') {
        const p = payload as { result?: AiInsightsResult }
        if (p.result) setAiResult(p.result)
      }
    }
    api?.on('ai-insights-updated', onAiUpdated)

    // Listen for navigation events from child components (e.g. dashboard AI card)
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (typeof detail === 'string') setActiveTab(detail)
    }
    window.addEventListener('navigate', onNavigate)
    return () => {
      window.removeEventListener('navigate', onNavigate)
      window.removeEventListener('dashboard:ready', onReady)
      clearTimeout(bootFallback)
      api?.removeAllListeners('ai-insights-updated')
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    const onOpen = () => setSearchOpen(true)
    api?.on('open-global-search', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      api?.removeAllListeners('open-global-search')
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setHeartbeat((h) => (h + 1) % 100), 1000)
    return () => clearInterval(t)
  }, [])

  // 全局轮询监控状态，确保切换页面时状态不丢失
  useEffect(() => {
    const fetch = () => {
      api?.invoke('get-watcher-status').then((s) => {
        if (s && typeof s === 'object') setWatcherStatus(s as WatcherStatus)
      })
    }
    fetch()
    const t = setInterval(fetch, 5000)
    return () => clearInterval(t)
  }, [])

  // 全局 CLI 流式监听（在 App 挂载期间常驻，切 tab 不会卸载，故后台进程持续可见）
  useEffect(() => {
    const onData = (p: unknown) => {
      const d = p as { id: string; data: string }
      setCliRuns((prev) => {
        const idx = prev.findIndex((r) => r.id === d.id)
        if (idx === -1) return prev
        const run = prev[idx]
        let output = run.output + stripAnsi(d.data)
        if (output.length > CLI_OUTPUT_CAP) output = output.slice(output.length - CLI_OUTPUT_CAP)
        const next = prev.slice()
        next[idx] = { ...run, output }
        return next
      })
    }
    const onExit = (p: unknown) => {
      const e = p as { id: string; code: number | null }
      setCliRuns((prev) => {
        const idx = prev.findIndex((r) => r.id === e.id)
        if (idx === -1) return prev
        const run = prev[idx]
        let output = run.output + `\n\x1b[90m[进程退出 · code ${e.code ?? '?'}] \x1b[0m\n`
        if (output.length > CLI_OUTPUT_CAP) output = output.slice(output.length - CLI_OUTPUT_CAP)
        const next = prev.slice()
        next[idx] = { ...run, running: false, finished: true, exitCode: e.code ?? null, output }
        return next
      })
    }
    api?.on('cli:data', onData)
    api?.on('cli:exit', onExit)
    // 渲染端重连：从主进程恢复仍在运行/刚结束的进程与缓冲输出
    api?.invoke('cli:status')
      .then((list) => {
        const arr = (list as Array<{
          id: string
          command: string
          cwd: string
          running: boolean
          finished: boolean
          exitCode: number | null
          startTime: number
          buffer: string
        }>) || []
        setCliRuns((prev) => {
          const existing = new Set(prev.map((r) => r.id))
          const merged = [...prev]
          for (const s of arr) {
            if (existing.has(s.id)) continue
            let output = stripAnsi(s.buffer)
            if (output.length > CLI_OUTPUT_CAP) output = output.slice(output.length - CLI_OUTPUT_CAP)
            merged.push({
              id: s.id,
              toolId: '',
              toolName: s.command,
              command: s.command,
              args: [],
              cwd: s.cwd,
              output,
              running: s.running,
              finished: s.finished,
              exitCode: s.exitCode,
              startTime: s.startTime,
              input: '--help',
            })
          }
          return merged
        })
      })
      .catch(() => {})
    return () => {
      api?.removeAllListeners('cli:data')
      api?.removeAllListeners('cli:exit')
    }
  }, [])

  // ── CLI 运行控制回调（提升后跨标签页保持） ──
  function cliOpenTool(tool: { id: string; name: string; command: string }) {
    // 复用同一工具未结束的运行，避免重复打开
    const existing = cliRuns.find((r) => r.toolId === tool.id && !r.finished)
    if (existing) {
      setCliActiveRunId(existing.id)
      setCliConsoleOpen(true)
      return
    }
    const id = `run-${tool.id}-${Date.now()}`
    const run: CliRunState = {
      id,
      toolId: tool.id,
      toolName: tool.name,
      command: tool.command,
      args: ['--help'],
      cwd: '',
      output: '',
      running: false,
      finished: false,
      exitCode: null,
      startTime: Date.now(),
      input: '--help',
    }
    setCliRuns((prev) => [...prev, run])
    setCliActiveRunId(id)
    setCliConsoleOpen(true)
  }

  function cliRunStart(id: string, args: string[]) {
    setCliRuns((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const cmdLine = `${r.command} ${args.join(' ')}`.trim()
        let output = r.output + `\n\x1b[36m$ ${cmdLine}\x1b[0m\n`
        if (output.length > CLI_OUTPUT_CAP) output = output.slice(output.length - CLI_OUTPUT_CAP)
        return { ...r, args, running: true, finished: false, exitCode: null, output }
      }),
    )
    const run = cliRuns.find((r) => r.id === id)
    if (!run) return
    api
      ?.invoke('cli:run', id, run.command, args, run.cwd || undefined)
      .then((res) => {
        if (res && typeof res === 'object' && (res as { ok?: boolean }).ok === false) {
          setCliRuns((prev) => prev.map((r) => (r.id === id ? { ...r, running: false } : r)))
        }
      })
      .catch(() => {
        setCliRuns((prev) => prev.map((r) => (r.id === id ? { ...r, running: false } : r)))
      })
  }

  function cliSendStdin(id: string, data: string) {
    api?.send('cli:write', id, data)
  }

  function cliKillRun(id: string) {
    void api?.invoke('cli:kill', id)
  }

  // 关闭任务（标签页 X）：显式终止并清理；区别于关闭控制台面板（不杀进程）
  function cliClearRun(id: string) {
    void api?.invoke('cli:clear', id)
    const remaining = cliRuns.filter((r) => r.id !== id)
    setCliRuns(remaining)
    setCliActiveRunId((cur) => (cur === id ? (remaining.length ? remaining[remaining.length - 1].id : null) : cur))
  }

  function cliClearOutput(id: string) {
    setCliRuns((prev) => prev.map((r) => (r.id === id ? { ...r, output: '' } : r)))
  }

  function cliSetInput(id: string, value: string) {
    setCliRuns((prev) => prev.map((r) => (r.id === id ? { ...r, input: value } : r)))
  }

  function cliSetCwd(id: string, cwd: string) {
    setCliRuns((prev) => prev.map((r) => (r.id === id ? { ...r, cwd } : r)))
  }

  function cliCloseConsole() {
    // 仅收起面板，不终止任何后台进程
    setCliConsoleOpen(false)
  }

  function renderContent() {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />
      case 'tracking':
        return <Tracking watcherStatus={watcherStatus} onWatcherStatusChange={setWatcherStatus} />
      case 'visualize':
        return <Visualize watcherStatus={watcherStatus} />
      case 'exclusions':
        return <Exclusions />
      case 'analysis':
        return <Analysis
          scanning={scanning}
          scanResult={scanResult}
          scanError={scanError}
          scanSelectedPath={scanSelectedPath}
          onScanningChange={setScanning}
          onScanResultChange={setScanResult}
          onScanErrorChange={setScanError}
          onScanSelectedPathChange={setScanSelectedPath}
        />
      case 'reports':
      case 'ai':
        return <ReportsInsights
          report={report}
          reportType={reportType}
          reportDateValue={reportDateValue}
          reportMonthValue={reportMonthValue}
          reportLoading={reportLoading}
          reportError={reportError}
          onReportChange={setReport}
          onReportTypeChange={setReportType}
          onReportDateValueChange={setReportDateValue}
          onReportMonthValueChange={setReportMonthValue}
          onReportLoadingChange={setReportLoading}
          onReportErrorChange={setReportError}
          aiResult={aiResult}
          aiLoading={aiLoading}
          onAiResultChange={setAiResult}
          onAiLoadingChange={setAiLoading}
        />
      case 'cleaner':
        return <Cleaner />
      case 'ai-cleanup':
        return (
          <AiCleanup
            target={aiCleanTarget}
            largeThreshold={aiCleanLargeMb}
            oldDays={aiCleanOldDays}
            maxItems={30}
            scanning={aiCleanScanning}
            running={aiCleanRunning}
            result={aiCleanResult}
            selected={aiCleanSelected}
            message={aiCleanMessage}
            failedDetails={aiCleanFailed}
            onTargetChange={setAiCleanTarget}
            onLargeThresholdChange={setAiCleanLargeMb}
            onOldDaysChange={setAiCleanOldDays}
            onScanningChange={setAiCleanScanning}
            onRunningChange={setAiCleanRunning}
            onResultChange={setAiCleanResult}
            onSelectedChange={setAiCleanSelected}
            onMessageChange={setAiCleanMessage}
            onFailedChange={setAiCleanFailed}
          />
        )
      case 'task-manager':
        return <TaskManager />
      case 'uninstaller':
        return <Uninstaller />
      case 'hardware':
        return <Hardware />
      case 'mousekb':
        return <MouseKeyboard />
      case 'logs':
        return <Logs />
      case 'eventviewer':
        return <EventViewer />
      case 'wintask':
        return <WinTaskScheduler />
      case 'pcicons':
        return <MyComputerIcons />
      case 'ctxmenu':
        return <ContextMenu />
      case 'speedtest':
        return <SpeedTest />
      case 'registry':
        return <RegistryManager />
      case 'cert':
        return <CertManager />
      case 'startup':
        return <StartupManager />
      case 'network':
        return <NetworkTracer />
      case 'packet_capture':
        return <PacketCapture />
      case 'timesync':
        return <TimeSync />
      case 'ollama':
        return <Ollama />
      case 'cli':
        return (
          <CliManager
            runs={cliRuns}
            consoleOpen={cliConsoleOpen}
            activeRunId={cliActiveRunId}
            onOpenTool={cliOpenTool}
            onOpenConsole={() => setCliConsoleOpen(true)}
            onSetActiveRun={setCliActiveRunId}
            onKillRun={cliKillRun}
            onClearRun={cliClearRun}
            onClearOutput={cliClearOutput}
          />
        )
      case 'devtools':
        return <DevTools />
      case 'lanshare':
        return <LanShare />
      case 'wsl':
        return <WslManager />
      case 'netsec':
        return <NetworkSecurity />
      case 'settings':
        return <SettingsPage />
      default:
        return (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5">
              {(() => {
                const Icon = navItems.find((n) => n.id === activeTab)?.icon || Sparkles
                return <Icon className="h-8 w-8" />
              })()}
            </div>
            <p className="text-sm font-medium">{navItems.find((n) => n.id === activeTab) ? t(navItems.find((n) => n.id === activeTab)!.labelKey) + ' - ' + t('common.loading') : ''}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('common.no_data')}</p>
          </div>
        )
    }
  }

  return (
    <div className="grid-bg flex h-full w-full overflow-hidden text-foreground">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} version={version} />

      <main className="flex flex-1 flex-col overflow-hidden">
        <Header
          activeTab={activeTab}
          heartbeat={heartbeat}
          watcherStatus={watcherStatus}
          cliRunningCount={cliRuns.filter((r) => r.running).length}
          onOpenCliConsole={() => setCliConsoleOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <div className="flex-1 overflow-auto p-8">{renderContent()}</div>
      </main>

      <ToastContainer toasts={toasts} dismissToast={dismissToast} />

      {/* 全局 CLI 可视化控制台（常驻挂载，切 tab 不卸载，后台进程持续可见） */}
      <CliConsoleDrawer
        open={cliConsoleOpen}
        runs={cliRuns}
        activeRunId={cliActiveRunId}
        onSetActiveRun={setCliActiveRunId}
        onRunStart={cliRunStart}
        onSendStdin={cliSendStdin}
        onKill={cliKillRun}
        onClearRun={cliClearRun}
        onClearOutput={cliClearOutput}
        onSetInput={cliSetInput}
        onSetCwd={cliSetCwd}
        onCloseConsole={cliCloseConsole}
      />

      {showSplash && <Splash visible={splashVisible} />}

      {/* 全局文件搜索（Ctrl/Cmd+K 唤起） */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
