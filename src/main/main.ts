// 提高 libuv 线程池大小，加速并行 I/O 操作（默认 4 线程）
process.env.UV_THREADPOOL_SIZE = '16'

import path from 'node:path'
import {
  app, BrowserWindow, ipcMain, dialog, Menu, MenuItemConstructorOptions, Tray, Notification, nativeImage, shell, globalShortcut,
} from 'electron'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import {
  initSchema,
  closeDb,
  db,
  getRecentEvents,
  getDailyStats,
  getTopProcesses,
  getDailyTrend,
  getTopCreatedPaths,
  getRangeStats,
  getDailyReportInRange,
  getTopProcessesInRange,
  getTopCreatedPathsInRange,
  getTopDeletedPathsInRange,
  getExclusionRules,
  addExclusionRule,
  updateExclusionRule,
  deleteExclusionRule,
  importExclusionRules,
  ExclusionRule,
  getCleanerRules,
  addCleanerRule,
  updateCleanerRule,
  deleteCleanerRule,
  getRecentCleanerLogs,
  CleanerRule,
  getEventCount,
  getCleanerLogCount,
  clearFileEvents,
  pruneFileEvents,
  pruneAppLogs,
  clearCleanerLogs,
  logToDb,
  getAppLogsPaginated,
  getAppLogCount,
  clearAppLogs,
  getDistinctLogModules,
  getCleanerLogsPaginated,
  insertScanHistory,
  getCleanerRuleById,
  getScanHistory,
  deleteScanHistory,
  clearScanHistory,
  getScheduledTasks,
  SCAN_HISTORY_LIMIT,
  getHardwareCache,
  saveHardwareCache,
  getRegistryOps,
  addRegistryOp,
  updateRegistryOp,
  deleteRegistryOp,
  getRegistryHistory,
  type RegistryStep,
} from './db'
import {
  isRegistrySupported,
  applyRegistryOp,
  rollbackRegistryOp,
  queryRegistryStep,
  openBackupDir,
  buildExampleOp,
} from './registry'
import {
  listCertStores,
  listCertificates,
  getCertificateDetail,
  exportCertificates,
  deleteCertificates,
  getCertSupport,
} from './cert'
import { buildScanReportTxt, type ScanReportPayload } from './scanReport'
import { startWatching, stopWatching, setMainWindow, getWatcherStatus } from './watcher'
import { getProcessTrackerStatus, startProcessTracking, stopProcessTracking } from './processTracker'
import {
  startNetworkTracer,
  stopNetworkTracer,
  getNetConnections,
  getNetEvents,
  getNetStatus,
  setNetInterval,
  setNetResolve,
  clearNetEvents,
  snapshotNetNow,
} from './networkTracer'
import { scanDirectory, abortScan } from './scanner'
import {
  reloadCleanerRules,
  runCleanerRule,
  executeCleanerTask,
  getCleanerScheduleStatus,
} from './cleaner'
import { generateAiInsights, buildHeuristicInsights, collectInsightInput, getAiConfig, setAiConfig, getLastInsights, ensureInitialAiInsights, AiProviderConfig } from './aiInsights'
import { scanAiCleanup, runAiCleanup } from './aiCleanup'
import {
  getOllamaStatus,
  listModels,
  showModel,
  deleteModel,
  startOllama,
  pullModel,
  chatModel,
  abortChat,
  setOllamaConfig,
  type ChatMessage,
} from './ollama'
import { generateExclusionRules } from './aiExclusions'
import { seedBuiltinRules } from './builtinRules'
import { getHardwareInfo, getLiveMetrics, readHosts } from './hardware'
import {
  getMouseKeyboardInfo,
  getMouseKbStats,
  startMouseKbStats,
  stopMouseKbStats,
  resetMouseKbStats,
  listRemapRules,
  addRemapRule,
  deleteRemapRule,
  applyRemapRules,
} from './mouseKeyboard'
import { extractFileIcons } from './fileIcons'
import { NetworkMonitor } from './networkMonitor'
import { listProcesses, killProcess, analyzeProcesses } from './taskManager'
import {
  detectCliTools,
  runCli,
  writeCli,
  killCli,
  clearCli,
  listCliRuns,
  openCliTerminal,
  uninstallCli,
} from './cliManager'
import {
  listLocalShares,
  createShare,
  removeShare,
  listComputers,
  listRemoteShares,
} from './lanShare'
import { listStartupItems, setStartupEnabled } from './startupManager'
import { fileSearchIndexer } from './filesearch/indexer'
import { listPrograms, uninstallProgram } from './uninstaller'
import { detectDevTools } from './devTools'
import {
  listDistros,
  readDir,
  openInExplorer,
  setDefaultDistro,
  terminateDistro,
  startDistro,
  exportDistro,
  importDistro,
} from './wslManager'
import {
  setSchedulerMainWindow,
  reloadAllScheduledTasks,
  createScheduledTask,
  updateScheduledTaskById,
  deleteScheduledTaskById,
  toggleScheduledTask,
  runScheduledTaskNow,
  SCHEDULER_PRESETS,
} from './scheduler'
import { queryEvents, getEventXml } from './eventViewer'
import {
  listWinTasks,
  runWinTask,
  setWinTaskEnabled,
  deleteWinTask,
  createWinTask,
  type WinTaskCreateOptions,
} from './winTaskScheduler'
import {
  listPcIcons,
  removePcIcon,
  restorePcIcon,
  listPcBackups,
  addCustomEntry,
  removeCustomEntry,
  listCustomEntries,
} from './myComputerIcons'
import {
  listContextMenu,
  setContextMenuEnabled,
  deleteContextMenu,
  restoreContextMenu,
  listContextMenuBackups,
} from './contextMenu'
import {
  runPing,
  runDownload,
  runUpload,
  SPEED_SERVERS,
  type SpeedProgress,
} from './speedTest'
import { packetCapture } from './packetCapture'
import { getAtomicReference, resyncSystemClock } from './timeSync'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'out/main')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'out/renderer')

process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let mainWindow: BrowserWindow | null
let tray: Tray | null = null
let isQuitting = false

// 网络安全监控引擎（流量 / ARP / DHCP），结果经 webContents 推送到渲染端
const netmon = new NetworkMonitor((channel: string, payload: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
})

// ======== AI 洞察定时自动生成 ========
let aiInsightsTimer: ReturnType<typeof setInterval> | null = null
let aiInsightsNextRun: number | null = null

function applyAiInsightsSchedule() {
  const hours = getSetting<number>('ai_insights_interval_hours', 0)
  if (aiInsightsTimer) {
    clearInterval(aiInsightsTimer)
    aiInsightsTimer = null
  }
  aiInsightsNextRun = null
  if (hours > 0) {
    const ms = hours * 3600 * 1000
    aiInsightsTimer = setInterval(() => {
      void runAiInsightsTick()
    }, ms)
    aiInsightsNextRun = Date.now() + ms
  }
}

async function runAiInsightsTick() {
  try {
    const result = await generateAiInsights(true, true)
    const hours = getSetting<number>('ai_insights_interval_hours', 0)
    aiInsightsNextRun = hours > 0 ? Date.now() + hours * 3600 * 1000 : null
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai-insights-updated', { result, nextRunAt: aiInsightsNextRun })
    }
    logToDb('info', 'aiInsights', '定时自动洞察完成', `source=${result.source}`)
  } catch (err) {
    logToDb('error', 'aiInsights', '定时自动洞察失败', String(err))
  }
}

// ======== 系统托盘 ========
function roundRectMask(x: number, y: number, size: number, radius: number): boolean {
  const inner = x >= radius && x <= size - 1 - radius && y >= radius && y <= size - 1 - radius
  if (inner) return true
  const ccx = x < size / 2 ? radius : size - 1 - radius
  const ccy = y < size / 2 ? radius : size - 1 - radius
  const dx = x - ccx
  const dy = y - ccy
  return dx * dx + dy * dy <= radius * radius
}

function createTrayIcon(): Electron.NativeImage {
  // 品牌标记：圆角方块 + 对角渐变（靛蓝 → 紫 → 青）+ 白色眼睛
  const size = 32
  const radius = 7
  const cx = size / 2
  const cy = size / 2
  const buf = Buffer.alloc(size * size * 4, 0)

  // 对角渐变采样：左上(0) 靛蓝 → 中(0.5) 紫 → 右下(1) 青
  const stops: { t: number; c: [number, number, number] }[] = [
    { t: 0, c: [99, 102, 241] },
    { t: 0.5, c: [139, 92, 246] },
    { t: 1, c: [34, 211, 238] },
  ]
  const gradColor = (x: number, y: number): [number, number, number] => {
    const t = (x + y) / (size * 2)
    let a = stops[0].c
    let b = stops[stops.length - 1].c
    let f = 1
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].t && t <= stops[i + 1].t) {
        f = (t - stops[i].t) / (stops[i + 1].t - stops[i].t)
        a = stops[i].c
        b = stops[i + 1].c
        break
      }
    }
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ]
  }

  const eyeRx = 9
  const eyeRy = 5
  const pupilR = 3

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      if (!roundRectMask(x, y, size, radius)) {
        buf[idx + 3] = 0
        continue
      }
      const [r, g, b] = gradColor(x, y)

      const ex = (x - cx) / eyeRx
      const ey = (y - cy) / eyeRy
      const eyeDist = ex * ex + ey * ey
      const pdist = Math.hypot(x - cx, y - cy)

      if (eyeDist <= 1) {
        // 眼睛外形：白色（边缘柔化）
        const edge = eyeDist > 0.82 ? 1 - (eyeDist - 0.82) / 0.18 : 1
        buf[idx] = 255
        buf[idx + 1] = 255
        buf[idx + 2] = 255
        buf[idx + 3] = Math.round(235 * edge)
      } else if (pdist <= pupilR) {
        // 瞳孔：深色
        buf[idx] = 15
        buf[idx + 1] = 23
        buf[idx + 2] = 42
        buf[idx + 3] = 235
      } else {
        buf[idx] = r
        buf[idx + 1] = g
        buf[idx + 2] = b
        buf[idx + 3] = 255
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

// ======== 托盘菜单（原生 Menu） ========
// 使用 Electron 原生 Menu 作为托盘右键菜单：系统级、稳定可靠，
// 不会出现自定义 HTML 窗口那种"被主窗口抢焦点秒关 / 调不出来"的问题。
function navigateFromTray(page: string) {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('navigate', page)
  }
}

function buildTrayMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    { label: '看板', click: () => navigateFromTray('dashboard') },
    { label: '分析', click: () => navigateFromTray('analysis') },
    { label: '清理', click: () => navigateFromTray('cleaner') },
    { label: '设置', click: () => navigateFromTray('settings') },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: getAutoStartSetting(),
      click: (menuItem) => {
        setAutoStartSetting(menuItem.checked)
        mainWindow?.webContents.send('auto-start-changed', menuItem.checked)
      },
    },
    {
      label: '关闭到托盘',
      type: 'checkbox',
      checked: getSetting<boolean>('minimize_to_tray', true),
      click: (menuItem) => {
        setSetting('minimize_to_tray', menuItem.checked)
        mainWindow?.webContents.send('minimize-tray-changed', menuItem.checked)
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]
  return Menu.buildFromTemplate(template)
}

// 设置/自启变化时重建菜单，使 checkbox 状态与界面保持一致
function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu())
}

function createTray() {
  if (tray) return
  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('AgentSC')

  // 原生右键菜单：Windows 右键 / macOS Ctrl+Click 均会触发，系统级稳定可靠
  tray.setContextMenu(buildTrayMenu())

  // 左键单击：显示主窗口
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ======== 开机自启 ========
function getAutoStartSetting(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

function setAutoStartSetting(enabled: boolean) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
  })
}

// ======== 通知 ========
function sendNotification(title: string, body: string) {
  // Windows 通知中心
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body })
    notif.show()
    notif.on('click', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  }
  // 同时推送到渲染进程（右下角卡片提醒）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('toast-notification', { title, body, timestamp: Date.now() })
  }
}

// ======== 大文件阈值 ========
function getLargeFileThreshold(): number {
  return getSetting<number>('large_file_threshold_mb', 100) // 默认 100MB
}

function getMinimizeToTraySetting(): boolean {
  return getSetting<boolean>('minimize_to_tray', true)
}

function createWindow() {
  // 移除默认菜单栏
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    show: false,
    icon: path.join(MAIN_DIST, '../..', 'build/icon.png'),
    webPreferences: {
      preload: path.join(MAIN_DIST, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  setMainWindow(mainWindow)
  setSchedulerMainWindow(mainWindow)

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // 开发模式下默认不自动打开 DevTools 面板：内置 Chromium 版本不支持 Autofill CDP
    // 域，会持续打印 'Autofill.enable failed' 告警；且 devtools_http_handler 绑定调试
    // 端口易与上一次未退出的 dev 进程冲突（bind 0x2740 / WSAEADDRINUSE）。
    // 需要调试时显式开启：OPEN_DEVTOOLS=1 npm run dev
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // 加载失败时（如构建产物损坏），显示错误页并展示窗口
  mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
    logToDb('error', 'window', '页面加载失败', `${code}: ${desc}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`data:text/html;charset=utf-8,<h1>页面加载失败 (${code})</h1><p>${encodeURIComponent(desc)}</p><p>请尝试重启应用或重新安装。`)
      mainWindow.show()
    }
  })

  // 捕获渲染进程控制台错误，写入 DB 日志
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      logToDb(level >= 3 ? 'error' : 'warn', 'renderer', `${message}`, `${sourceId}:${line}`)
    }
  })

  // 捕获渲染进程未捕获异常
  mainWindow.webContents.on('unresponsive', () => {
    logToDb('error', 'renderer', '渲染进程无响应', '页面可能已崩溃')
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 兜底：5 秒后如果窗口还没显示，强制显示（防止 ready-to-show 永不触发）
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 5_000)

  // 关闭窗口时，根据当前托盘设置决定行为
  mainWindow.on('close', (event) => {
    if (!isQuitting && getMinimizeToTraySetting()) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 声明 isQuitting - 使用模块级变量
app.on('window-all-closed', () => {
  // 停止监控 & 关闭 DB
  stopWatching()
  stopProcessTracking()
  closeDb()
  // 在 Windows/Linux 上，所有窗口关闭后强制退出进程
  // 不检查托盘设置：用户从托盘"退出"时 isQuitting=true 已确保窗口可关；
  // 窗口全部关完还不退出 → 就是进程残留 bug
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // before-quit 在 app.quit() 开始时触发，比 will-quit 早
  // 这里确保 isQuitting 标记已设置（以防其他途径触发 quit）
  isQuitting = true
})

app.on('will-quit', () => {
  // 清理所有会阻止进程退出的资源
  globalShortcut.unregisterAll()
  stopWatching()
  stopProcessTracking()
  stopNetworkTracer()
  closeDb()
})

// GPU 硬件加速界面渲染：必须在 app.ready 之前决定，运行时无法动态切换，需重启生效。
// 默认开启（不调用 disableHardwareAcceleration 即使用 GPU 加速）。
{
  const gpuOn = getSetting<boolean>('gpu_acceleration', true)
  if (!gpuOn) {
    app.disableHardwareAcceleration()
  }
}

app.whenReady().then(() => {
  initSchema()
  createWindow()
  createTray()

  // 全局搜索快捷键：Ctrl/Cmd+K 唤起命令面板
  try {
    globalShortcut.register('CommandOrControl+K', () => {
      if (mainWindow) mainWindow.webContents.send('open-global-search')
    })
  } catch {
    /* ignore */
  }

  // 调试快捷键：F12 / Ctrl+Shift+I 打开 DevTools（开发与生产均可用）
  try {
    globalShortcut.register('F12', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.toggleDevTools()
      }
    })
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.toggleDevTools()
      }
    })
  } catch {
    /* ignore */
  }

  // 数据库滚动清理：防止 file_events / app_logs 表无界膨胀，长时运行后拖高内存与磁盘占用。
  const runDbPruning = () => {
    try {
      pruneFileEvents(30)
      pruneAppLogs(30)
    } catch {
      /* ignore */
    }
  }
  runDbPruning() // 启动时先清理一次
  const dbPruneTimer = setInterval(runDbPruning, 24 * 60 * 60 * 1000) // 每 24h
  ;(dbPruneTimer as any).unref?.()

  // 启动后异步初始化监控与清理规则。延后到窗口首屏渲染后一段时间再启动，
  // 避免 chokidar 建立 watch / ETW / PowerShell 初始化在主界面首屏期间占用主进程导致卡死。
  // 分阶段：
  //   T0 = ready-to-show 后 6s：watcher（chokidar 事件源）；chokidar 注册 handle 是主进程开销最大的一环。
  //   T1 = ready-to-show 后 15s：processTracker（powershell fork + Get-Process 全列），慢且与 chokidar 抢。
  //   T2 = ready-to-show 后 6s：清理规则 / 订阅同步 / 初始洞察 / AI 间隔——纯 DB + 网络操作，CPU 轻。
  // 这样首启完成后用户肉眼可见"主界面先出来，过几秒监控灯慢慢亮"，首启不再被 IO 阻塞。
  const launchBgTasks = () => {
    // T2 这一坨可以跟 T0 同批（T0 结束时一起做）
  const t2 = () => Promise.resolve()
    .then(() => seedBuiltinRules())
    .then(() => reloadCleanerRules())
    .then(() => ensureInitialAiInsights())
    .then(() => applyAiInsightsSchedule())
    .then(() => reloadAllScheduledTasks())
    .then(() => fileSearchIndexer.init())
    .catch((err) => logToDb('error', 'startup', '启动后初始化失败', String(err)))

    // T0（watcher 启动）
    Promise.resolve()
      .then(() => autoStartWatching())
      .then(() => t2())
      .catch((err) => logToDb('error', 'startup', 'T0 阶段启动失败', String(err)))
  }
  const launchProcessTracker = () => {
    // 仅当用户当前确实启用了监控且有可监控路径时，才延后启动 processTracker。
    // 否则直接跳过，省得白白 fork powershell。
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'watcher_config'").get() as { value: string } | undefined
      const cfg = row ? JSON.parse(row.value) : null
      if (!cfg || !cfg.enabled || !Array.isArray(cfg.paths) || cfg.paths.length === 0) {
        return
      }
    } catch {
      return
    }
    Promise.resolve()
      .then(() => { startProcessTracking() })
      .catch((err) => logToDb('error', 'startup', 'processTracker 启动失败', String(err)))
  }
    if (mainWindow) {
      mainWindow.once('ready-to-show', () => {
        // 6s：Splash 完全收起、首屏数据已绘，再开 watcher
        setTimeout(launchBgTasks, 6_000)
        // 15s：脱离首屏后再开 processTracker（PowerShell fork）
        setTimeout(launchProcessTracker, 15_000)
        // 9s：网络追踪（PowerShell 拉取连接表，开销轻）持续采集动作路径
        setTimeout(() => {
          try {
            startNetworkTracer(4000)
          } catch (err) {
            logToDb('error', 'startup', '网络追踪启动失败', String(err))
          }
        }, 9_000)
      })
    } else {
      setTimeout(launchBgTasks, 6_000)
      setTimeout(launchProcessTracker, 15_000)
      setTimeout(() => {
        try {
          startNetworkTracer(4000)
        } catch (err) {
          logToDb('error', 'startup', '网络追踪启动失败', String(err))
        }
      }, 9_000)
    }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

// PowerShell 派生查询结果缓存。Get-CimInstance 启动 powershell.exe 通常 200-800ms，
// Dashboard 进入新会话 / 用户切换到 Reports 等页面时反复调用，每次都 fork 一次
// 进程。在主进程被 chokidar 占用的事件循环上感觉非常卡。统一加 5 分钟 TTL 缓存。
const PS_CACHE_TTL_MS = 5 * 60 * 1000
interface CacheEntry<T> { at: number; result: T }
const localDrivesCache = new Map<symbol, CacheEntry<string[]>>()
const diskInfoCache = new Map<symbol, CacheEntry<{ letter: string; label: string; total: number; used: number }[]>>()

function withCache<T>(store: Map<symbol, CacheEntry<T>>, key: symbol, loader: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const cached = store.get(key)
  if (cached && now - cached.at < PS_CACHE_TTL_MS) {
    return Promise.resolve(cached.result)
  }
  return loader().then((result) => {
    store.set(key, { at: now, result })
    return result
  })
}

function getLocalDrives(): Promise<string[]> {
  const key = Symbol('local-drives')
  return withCache(localDrivesCache, key, () => new Promise<string[]>((resolve) => {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      Get-CimInstance -ClassName Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } |
      Select-Object -ExpandProperty DeviceID
    `
    execFile('powershell', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ' + ps], { encoding: 'utf-8' }, (err, stdout) => {
      if (err) {
        resolve(['C:\\'])
        return
      }
      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[A-Z]:$/.test(line))
        .map((letter) => `${letter}\\`)
      resolve(lines.length > 0 ? lines : ['C:\\'])
    })
  }))
}

function getSetting<T>(key: string, fallback: T): T {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return fallback
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

function setSetting(key: string, value: unknown) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  stmt.run(key, JSON.stringify(value))
}

async function autoStartWatching() {
  // DB 中已有 watcher_config（任意内容，含 enabled=false）→ 用户此前主动设过，
  // 严格尊重，保持原状。
  // DB 中完全没有这个 key → 新装用户首次启动。为防止软件"安装起来就卡死"，默认
  // 不开监控、不给路径，让用户在「追踪路径」页面里手动选择要监控的目录后再开。
  // 这样 chokidar / processTracker / PowerShell 在新装首次启动时不会同时轰主进程。
  const existing = db
    .prepare("SELECT value FROM settings WHERE key = 'watcher_config'")
    .get() as { value: string } | undefined
  let config: { paths: string[]; enabled: boolean }
  if (existing) {
    config = JSON.parse(existing.value) as { paths: string[]; enabled: boolean }
  } else {
    config = { paths: [], enabled: false }
    setSetting('watcher_config', config)
  }
  if (!config.enabled || config.paths.length === 0) {
    logToDb('info', 'watcher', '监控未启用或无路径，跳过自动启动', JSON.stringify(config))
    return
  }
  await startWatching(config)
  logToDb('info', 'watcher', `监控启动，路径: ${config.paths.join(', ')}`)
}

// IPC handlers
ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null
  ensureWindowForeground()
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('get-drives', () => getLocalDrives())

ipcMain.handle('get-disk-info', async () => {
  const key = Symbol('disk-info')
  return withCache(diskInfoCache, key, () => new Promise<{ letter: string; label: string; total: number; used: number }[]>((resolve) => {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      Get-CimInstance -ClassName Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } |
      Select-Object DeviceID, Size, FreeSpace, VolumeName |
      ConvertTo-Json -Compress
    `
    execFile('powershell', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ' + ps], { encoding: 'utf-8' }, (err, stdout) => {
      if (err) {
        resolve([])
        return
      }
      try {
        const data = JSON.parse(stdout)
        const arr = Array.isArray(data) ? data : [data]
        resolve(
          arr.map((d: any) => {
            const total = d.Size || 0
            const free = d.FreeSpace || 0
            return {
              letter: `${d.DeviceID}\\`,
              label: d.VolumeName || '本地磁盘',
              total,
              used: total - free,
            }
          }),
        )
      } catch {
        resolve([])
      }
    })
  }))
})

ipcMain.handle('get-recent-events', async (_event, limit = 50) => {
  return getRecentEvents(limit)
})

ipcMain.handle('get-daily-stats', async (_event, day?: string) => {
  const target = day || new Date().toISOString().slice(0, 10)
  return getDailyStats(target)
})

ipcMain.handle('get-top-processes', async (_event, day?: string) => {
  const target = day || new Date().toISOString().slice(0, 10)
  return getTopProcesses(target)
})

ipcMain.handle('get-daily-trend', async (_event, days = 7) => {
  return getDailyTrend(days)
})

ipcMain.handle('get-top-created-paths', async (_event, day?: string, limit = 10) => {
  const target = day || new Date().toISOString().slice(0, 10)
  return getTopCreatedPaths(target, limit)
})

ipcMain.handle('generate-report', async (_event, startDay: string, endDay: string) => {
  const stats = getRangeStats(startDay, endDay)
  const daily = getDailyReportInRange(startDay, endDay)
  const topProcesses = getTopProcessesInRange(startDay, endDay, 10)
  const topCreated = getTopCreatedPathsInRange(startDay, endDay, 10)
  const topDeleted = getTopDeletedPathsInRange(startDay, endDay, 10)
  return {
    startDay,
    endDay,
    generatedAt: Date.now(),
    stats,
    daily,
    topProcesses,
    topCreated,
    topDeleted,
  }
})

ipcMain.handle('get-exclusion-rules', () => getExclusionRules())

ipcMain.handle('add-exclusion-rule', async (_event, rule: ExclusionRule) => {
  const r = addExclusionRule(rule)
  return r
})

ipcMain.handle('update-exclusion-rule', async (_event, { id, rule }: { id: number; rule: Partial<ExclusionRule> }) => {
  const r = updateExclusionRule(id, rule)
  return r
})

ipcMain.handle('delete-exclusion-rule', async (_event, id: number) => {
  const r = deleteExclusionRule(id)
  return r
})

// AI 自然语言 -> 排除规则：根据描述让 AI 编写候选通配符规则，返回给用户确认。
ipcMain.handle('generate-exclusion-rules', async (_event, userPrompt: string) => {
  return generateExclusionRules(String(userPrompt || '').trim())
})

// 批量落地排除规则（由 AI 对话确认后调用），无文件对话框，复用 importExclusionRules 去重。
ipcMain.handle('add-exclusion-rules-batch', async (_event, rules: Array<{ pattern: string; reason?: string }>) => {
  const list = Array.isArray(rules) ? rules : []
  const summary = importExclusionRules(list)
  return summary
})

// 导出排除规则为 JSON 文件（仿 export-events）
ipcMain.handle('export-exclusion-rules', async () => {
  if (!mainWindow) return { canceled: true, filePath: null, error: 'main-window-unavailable' }
  ensureWindowForeground()
  const rules = getExclusionRules()
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('downloads'), 'agentsc-exclusions.json'),
    filters: [
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePath) return { canceled: true, filePath: null }
  fs.writeFileSync(result.filePath, JSON.stringify(rules, null, 2), 'utf-8')
  return { canceled: false, filePath: result.filePath }
})

// 从 JSON 文件导入排除规则（批量写入，去重容错）
ipcMain.handle('import-exclusion-rules', async () => {
  if (!mainWindow) return { canceled: true, filePath: null, error: 'main-window-unavailable' }
  ensureWindowForeground()
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true, filePath: null }
  const filePath = result.filePaths[0]
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    // 接受数组，或 { rules: [...] } 包装
    const rules = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rules) ? parsed.rules : null
    if (!rules || !rules.every((r: unknown) => r && typeof (r as { pattern?: unknown }).pattern === 'string')) {
      return { canceled: false, filePath, error: 'invalid-format' }
    }
    const summary = importExclusionRules(rules)
    return { canceled: false, filePath, error: null, ...summary }
  } catch (err) {
    return { canceled: false, filePath, error: String(err) }
  }
})

ipcMain.handle('get-watcher-config', () =>
  getSetting<{ paths: string[]; enabled: boolean }>('watcher_config', {
    paths: ['E:\\X9\\OPC项目\\AgentSC'],
    enabled: true,
  }),
)

ipcMain.handle('get-watcher-status', () => getWatcherStatus())

ipcMain.handle('get-process-tracker-status', () => getProcessTrackerStatus())

// ── IP 追踪 / 网络动作路径 ──
ipcMain.handle('network:status', () => getNetStatus())
ipcMain.handle('network:connections', () => getNetConnections())
ipcMain.handle('network:events', (_event, limit = 200) => getNetEvents(limit))
ipcMain.handle('network:start', (_event, interval?: number) => {
  startNetworkTracer(typeof interval === 'number' ? interval : undefined)
  return getNetStatus()
})
ipcMain.handle('network:stop', () => {
  stopNetworkTracer()
  return getNetStatus()
})
ipcMain.handle('network:set-interval', (_event, ms: number) => {
  setNetInterval(ms)
  return getNetStatus()
})
ipcMain.handle('network:set-resolve', (_event, on: boolean) => {
  setNetResolve(on)
  return getNetStatus()
})
ipcMain.handle('network:clear-events', () => {
  clearNetEvents()
  return true
})
ipcMain.handle('network:snapshot', () => {
  void snapshotNetNow()
  return getNetStatus()
})

ipcMain.handle('set-watching', async (_event, config: { paths: string[]; enabled: boolean }) => {
  setSetting('watcher_config', config)
  await startWatching(config)
  return getWatcherStatus()
})

ipcMain.handle('scan-directory', async (event, targetPath: string, maxDepth?: number) => {
  const result = await scanDirectory(targetPath, maxDepth ?? 3, (progress) => {
    // 实时推送扫描进度到渲染进程
    event.sender.send('scan-progress', progress)
  })
  // 扫描完成后通知
  event.sender.send('scan-progress', { phase: 'done', currentPath: targetPath, itemsScanned: 0, currentSize: 0, topDirs: [] })
  return result
})

ipcMain.handle('abort-scan', () => {
  abortScan()
})

// ===== 占用分析历史记录 =====
ipcMain.handle('save-scan-history', async (
  _event,
  entry: { target_path: string; total_size: number; items_scanned: number; max_depth: number; result_json: string },
) => {
  const r = insertScanHistory(entry)
  return r
})

ipcMain.handle('get-scan-history', async (_event, limit?: number) => {
  return getScanHistory(limit ?? SCAN_HISTORY_LIMIT)
})

ipcMain.handle('delete-scan-history', async (_event, id: number) => {
  const r = deleteScanHistory(id)
  return r
})

ipcMain.handle('clear-scan-history', async () => {
  const r = clearScanHistory()
  return r
})

// 导出占用分析为 TXT 报告（纯文本，无需浏览器渲染）
ipcMain.handle('export-scan-txt', async (_event, payload: ScanReportPayload) => {
  if (!mainWindow) return { canceled: true, filePath: null, error: 'main-window-unavailable' }
  ensureWindowForeground()
  try {
    const txt = buildScanReportTxt(payload)
    const d = new Date(payload.created_at)
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `占用分析_${stamp}.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true, filePath: null }
    fs.writeFileSync(result.filePath, txt, 'utf-8')
    return { canceled: false, filePath: result.filePath }
  } catch (err) {
    return { canceled: true, filePath: null, error: String(err) }
  }
})

ipcMain.handle('export-events', async (_event, events: unknown[], defaultName = 'agentsc-events.json') => {
  if (!mainWindow) return { canceled: true, filePath: null }
  ensureWindowForeground()
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: null }
  }
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(events, null, 2), 'utf-8')
    return { canceled: false, filePath: result.filePath }
  } catch (err) {
    throw err
  }
})

ipcMain.handle('get-cleaner-rules', () => getCleanerRules())

ipcMain.handle('add-cleaner-rule', async (_event, rule: CleanerRule) => {
  // 仅允许添加「自定义目录」类型规则；系统清理类型由内置规则 / 一键清理覆盖
  if (rule.type !== 'custom') {
    return { ok: false, error: 'only-custom-allowed' }
  }
  const result = addCleanerRule(rule)
  reloadCleanerRules()
  return result
})

ipcMain.handle('update-cleaner-rule', async (_event, { id, rule }: { id: number; rule: Partial<CleanerRule> }) => {
  const result = updateCleanerRule(id, rule)
  reloadCleanerRules()
  return result
})

ipcMain.handle('delete-cleaner-rule', async (_event, id: number) => {
  const rule = getCleanerRuleById(id)
  // 内置规则（随包携带）不允许删除，避免其从列表消失后下次启动又被复活
  if (rule && typeof rule.external_id === 'string' && rule.external_id.startsWith('builtin::')) {
    return { ok: false, error: 'builtin-rule' }
  }
  const result = deleteCleanerRule(id)
  reloadCleanerRules()
  return result
})

ipcMain.handle('run-cleaner-rule', async (_event, rule: CleanerRule) => {
  // 自定义目录清理：禁止把系统关键目录作为清理目标（管理员权限下清空 = 灾难）
  if (rule && rule.type === 'custom' && isSystemProtectedPath((rule.target || '') as string)) {
    return { ok: false, error: 'protected-path', message: '禁止清理系统关键目录' }
  }
  return runCleanerRule(rule)
})

ipcMain.handle('run-cleaner-task', async (_event, type: CleanerRule['type'], target?: string) => {
  return executeCleanerTask(type, target)
})

// ── AI 智能磁盘清理 ──
ipcMain.handle('scan-ai-cleanup', async (_event, target?: string, options?: { largeThresholdMb?: number; oldDays?: number; maxItems?: number }) => {
  return scanAiCleanup(target, options)
})

ipcMain.handle('run-ai-cleanup', async (_event, payload: { items: Parameters<typeof runAiCleanup>[0]['items'] }) => {
  return runAiCleanup(payload)
})

ipcMain.handle('get-cleaner-logs', async (_event, limit = 50) => {
  return getRecentCleanerLogs(limit)
})

ipcMain.handle('get-cleaner-logs-paginated', async (_event, page: number, pageSize: number) => {
  return getCleanerLogsPaginated(page, pageSize || 20)
})

ipcMain.handle('get-app-logs', async (_event, page: number, pageSize: number, filter?: { level?: string; module?: string }) => {
  return getAppLogsPaginated(page, pageSize || 20, filter)
})

ipcMain.handle('get-app-log-modules', async () => {
  return getDistinctLogModules()
})

ipcMain.handle('get-cleaner-schedule-status', () => getCleanerScheduleStatus())

ipcMain.handle('get-ai-insights', async (_event, force?: boolean) => {
  // Pass through the `force` flag from the renderer (e.g. AiInsights "Generate"
  // button sends true to bypass the short-lived cache and force a fresh analysis).
  return generateAiInsights(force ?? false)
})

// 查询自动洞察状态：间隔、最近一次结果、下次运行时间
ipcMain.handle('get-ai-insights-status', () => {
  const hours = getSetting<number>('ai_insights_interval_hours', 0)
  return {
    intervalHours: hours,
    lastResult: getLastInsights(),
    nextRunAt: aiInsightsNextRun,
  }
})

// 设置自动洞察间隔（小时，0=关闭），并立即生成一次让页面有数据
ipcMain.handle('set-ai-insights-interval', async (_event, hours: number) => {
  const h = Math.max(0, Math.min(24, Math.floor(hours || 0)))
  setSetting('ai_insights_interval_hours', h)
  applyAiInsightsSchedule()
  if (h > 0) {
    void runAiInsightsTick()
  }
  return {
    intervalHours: h,
    lastResult: getLastInsights(),
    nextRunAt: aiInsightsNextRun,
  }
})
// 轻量启发式分析，供看板使用（不联网）。加 5 分钟内存缓存，避免看板每分钟
// 重新聚合 DB 而周期性阻塞主进程（事件表大时 collectInsightInput 同步扫表较慢）。
// 60s 是"分钟级"刷新密度；5 分钟是"会话内基本不变"的粒度。
const QUICK_SUMMARY_TTL_MS = 5 * 60 * 1000
let quickSummaryCache: { at: number; result: ReturnType<typeof buildHeuristicInsights> } | null = null
ipcMain.handle('get-ai-quick-summary', () => {
  const now = Date.now()
  if (quickSummaryCache && now - quickSummaryCache.at < QUICK_SUMMARY_TTL_MS) {
    return quickSummaryCache.result
  }
  const input = collectInsightInput(7)
  const result = buildHeuristicInsights(input)
  quickSummaryCache = { at: now, result }
  return result
})

ipcMain.handle('get-ai-config', () => getAiConfig())

ipcMain.handle('set-ai-config', async (_event, config: Partial<AiProviderConfig>) => {
  return setAiConfig(config)
})

ipcMain.handle('get-storage-stats', () => ({
  events: getEventCount(),
  cleanerLogs: getCleanerLogCount(),
  appLogs: getAppLogCount(),
}))

ipcMain.handle('clear-file-events', () => clearFileEvents())

ipcMain.handle('clear-cleaner-logs', () => clearCleanerLogs())

ipcMain.handle('clear-app-logs', () => {
  const r = clearAppLogs()
  return r
})

// ======== 开机自启 ========
ipcMain.handle('get-auto-start', () => getAutoStartSetting())

ipcMain.handle('set-auto-start', async (_event, enabled: boolean) => {
  setAutoStartSetting(enabled)
  mainWindow?.webContents.send('auto-start-changed', enabled)
  refreshTrayMenu()
})

// ======== 打开外部链接（关于页官网等） ========
ipcMain.handle('open-external', async (_event, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: 'invalid-url' }
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// ======== 托盘设置 ========
ipcMain.handle('get-minimize-to-tray', () => getMinimizeToTraySetting())

ipcMain.handle('set-minimize-to-tray', async (_event, enabled: boolean) => {
  setSetting('minimize_to_tray', enabled)
  mainWindow?.webContents.send('minimize-tray-changed', enabled)
  refreshTrayMenu()
})

// ======== GPU 加速界面渲染 ========
ipcMain.handle('get-gpu-acceleration', () => getSetting<boolean>('gpu_acceleration', true))

ipcMain.handle('set-gpu-acceleration', async (_event, enabled: boolean) => {
  setSetting('gpu_acceleration', enabled)
  return getSetting<boolean>('gpu_acceleration', true)
})

// 应用并重启（GPU 设置需重启才能生效）
ipcMain.handle('relaunch-app', () => {
  isQuitting = true
  app.relaunch()
  app.quit()
})

// ======== 大文件阈值 ========
ipcMain.handle('get-large-file-threshold', () => getLargeFileThreshold())

ipcMain.handle('set-large-file-threshold', async (_event, mb: number) => {
  setSetting('large_file_threshold_mb', mb)
})

// ======== 发送通知（供渲染进程调用） ========
ipcMain.handle('show-notification', async (_event, title: string, body: string) => {
  sendNotification(title, body)
})

// ======== 右键菜单：打开文件所在文件夹 ========
ipcMain.handle('open-file-location', async (_event, filePath: string) => {
  try {
    const dir = path.dirname(filePath)
    await shell.openPath(dir)
    return true
  } catch {
    return false
  }
})

// ======== 直接打开文件/目录（用于卸载器「打开安装目录」） ========
ipcMain.handle('open-path', async (_event, target: string) => {
  try {
    if (!target) return false
    await shell.openPath(target)
    return true
  } catch {
    return false
  }
})

// ======== 提取文件/进程图标（任务管理器进程 exe、卸载器程序 displayIcon） ========
ipcMain.handle('get-file-icons', async (_event, paths: string[]) => extractFileIcons(paths))

// ======== Ollama 大模型管理器 ========
ipcMain.handle('ollama-status', async () => getOllamaStatus())

ipcMain.handle('ollama-list', async () => listModels())

ipcMain.handle('ollama-show', async (_event, name: string) => showModel(name))

ipcMain.handle('ollama-delete', async (_event, name: string) => deleteModel(name))

ipcMain.handle('ollama-start', async () => startOllama())

ipcMain.handle('ollama-pull', async (event, name: string) =>
  pullModel(name, (p) => {
    event.sender.send('ollama-pull-progress', p)
  }),
)

ipcMain.handle('ollama-chat', async (event, model: string, messages: ChatMessage[]) =>
  chatModel(model, messages, (delta) => {
    event.sender.send('ollama-chat-token', delta)
  }),
)

ipcMain.handle('ollama-chat-stop', async () => {
  abortChat()
  return { ok: true }
})

ipcMain.handle('ollama-set-config', async (_event, cfg: { host?: string; apiKey?: string }) => {
  setOllamaConfig(cfg || {})
  return { ok: true }
})

// ───────────────────────────────────────────────────────────
// CLI 工具管理器
// ───────────────────────────────────────────────────────────
ipcMain.handle('cli:list', async (_event, force?: boolean) => detectCliTools(force === true))

ipcMain.handle('cli:run', async (event, id: string, command: string, args: string[], cwd?: string) => {
  return runCli(id, command, args || [], event.sender, cwd)
})

ipcMain.on('cli:write', (_event, id: string, data: string) => {
  writeCli(id, data)
})

ipcMain.handle('cli:kill', async (_event, id: string) => {
  killCli(id)
  return { ok: true }
})

ipcMain.handle('cli:clear', async (_event, id: string) => {
  clearCli(id)
  return { ok: true }
})

// ───────────────────────────────────────────────────────────
// 注册表修改管理器
// ───────────────────────────────────────────────────────────
ipcMain.handle('registry:list', async () => getRegistryOps())

ipcMain.handle('registry:add', async (_event, input: { name: string; description?: string; enabled?: boolean; steps: RegistryStep[] }) => {
  if (!input || !input.name || !Array.isArray(input.steps)) return { ok: false, error: '参数无效' }
  const id = addRegistryOp(input)
  return { ok: true, id }
})

ipcMain.handle('registry:update', async (_event, id: number, patch: Partial<{ name: string; description: string; enabled: boolean; steps: RegistryStep[] }>) => {
  if (typeof id !== 'number') return { ok: false, error: '参数无效' }
  updateRegistryOp(id, patch || {})
  return { ok: true }
})

ipcMain.handle('registry:delete', async (_event, id: number) => {
  if (typeof id !== 'number') return { ok: false, error: '参数无效' }
  deleteRegistryOp(id)
  return { ok: true }
})

ipcMain.handle('registry:apply', async (_event, id: number) => {
  if (typeof id !== 'number') return { ok: false, error: '参数无效' }
  return applyRegistryOp(id)
})

ipcMain.handle('registry:rollback', async (_event, id: number) => {
  if (typeof id !== 'number') return { ok: false, error: '参数无效' }
  return rollbackRegistryOp(id)
})

ipcMain.handle('registry:history', async (_event, limit?: number) => getRegistryHistory(limit || 200))

ipcMain.handle('registry:query', async (_event, step: RegistryStep) => {
  if (!step || !step.hive || !step.key) return { ok: false, error: '参数无效' }
  return queryRegistryStep(step)
})

ipcMain.handle('registry:open-backup-dir', async () => openBackupDir())

ipcMain.handle('registry:supported', async () => ({ ok: true, supported: isRegistrySupported }))

ipcMain.handle('registry:example', async () => buildExampleOp())

// 系统证书管理器
ipcMain.handle('cert:stores', async () => listCertStores())
ipcMain.handle('cert:list', async (_event, location: string, store: string) => listCertificates(location, store))
ipcMain.handle('cert:detail', async (_event, location: string, store: string, thumbprint: string) =>
  getCertificateDetail(location, store, thumbprint),
)
ipcMain.handle('cert:export', async (_event, payload: { items: any[]; format: 'cer' | 'pfx'; password?: string }) => {
  if (!payload || !Array.isArray(payload.items)) return { ok: false, error: '参数无效' }
  return exportCertificates(payload.items, payload.format || 'cer', payload.password)
})
ipcMain.handle('cert:delete', async (_event, payload: { items: any[]; deleteKey: boolean }) => {
  if (!payload || !Array.isArray(payload.items)) return { ok: false, error: '参数无效', results: [] }
  return deleteCertificates(payload.items, !!payload.deleteKey)
})
ipcMain.handle('cert:supported', async () => getCertSupport())

ipcMain.handle('cli:status', async () => listCliRuns())

ipcMain.handle('cli:open-terminal', async (_event, command: string, name?: string) => openCliTerminal(command, name))

ipcMain.handle('cli:uninstall', async (_event, command: string) => {
  if (!command || typeof command !== 'string') return { ok: false, error: '无效的命令' }
  const r = uninstallCli(command)
  return r
})

// ───────────────────────────────────────────────────────────
// 系统启动项管理
// ───────────────────────────────────────────────────────────
ipcMain.handle('startup:list', async () => listStartupItems())

ipcMain.handle('startup:set-enabled', async (_event, id: string, enabled: boolean) => {
  if (typeof id !== 'string' || typeof enabled !== 'boolean') return { ok: false, error: '参数无效' }
  return setStartupEnabled(id, enabled)
})

// ───────────────────────────────────────────────────────────
// 开发工具管理器
// ───────────────────────────────────────────────────────────
ipcMain.handle('devtools:list', async (_event, force?: boolean) => detectDevTools(force === true))

// ═══════════════════════════════════════════════════════════════
// WSL 文件管理器
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('wsl:list', async () => listDistros())

ipcMain.handle('wsl:readdir', async (_event, distName: string, linuxPath: string) =>
  readDir(String(distName), String(linuxPath || '/')),
)

ipcMain.handle('wsl:open', async (_event, distName: string, linuxPath: string) =>
  openInExplorer(String(distName), String(linuxPath || '/')),
)

ipcMain.handle('wsl:set-default', async (_event, name: string) => setDefaultDistro(String(name)))

ipcMain.handle('wsl:terminate', async (_event, name: string) => terminateDistro(String(name)))

ipcMain.handle('wsl:start', async (_event, name: string) => startDistro(String(name)))

ipcMain.handle('wsl:export', async (_event, name: string) => {
  if (!mainWindow) return { ok: false, error: 'main-window-unavailable' }
  ensureWindowForeground()
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `wsl-${String(name)}-export.tar`,
    filters: [
      { name: 'TAR 文件', extensions: ['tar'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  return exportDistro(String(name), result.filePath)
})

ipcMain.handle('wsl:import', async () => {
  if (!mainWindow) return { ok: false, error: 'main-window-unavailable' }
  ensureWindowForeground()
  const tar = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'TAR 文件', extensions: ['tar'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (tar.canceled || tar.filePaths.length === 0) return { ok: false, canceled: true }
  const dir = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  if (dir.canceled || dir.filePaths.length === 0) return { ok: false, canceled: true }
  return importDistro(tar.filePaths[0], dir.filePaths[0])
})

// ======== 网络抓包分析 ========
ipcMain.handle('packet-capture:start', async (_event, port: number) => {
  try {
    await packetCapture.start(port)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) }
  }
})
ipcMain.handle('packet-capture:stop', async () => {
  await packetCapture.stop()
  return { ok: true }
})
ipcMain.handle('packet-capture:status', () => packetCapture.status())
ipcMain.handle('packet-capture:list', () => packetCapture.getSessions())
ipcMain.handle('packet-capture:clear', () => {
  packetCapture.clearSessions()
  return { ok: true }
})
ipcMain.handle('packet-capture:set-mode', (_event, mode: 'http' | 'adb') => {
  packetCapture.setMode(mode)
  return { ok: true }
})
ipcMain.handle('packet-capture:set-lock', (_event, enabled: boolean, pid: number, name: string) => {
  packetCapture.setLock(enabled, pid, name)
  return { ok: true }
})
ipcMain.handle('packet-capture:set-adb-target', (_event, device: string, pkg: string) => {
  packetCapture.setAdbTarget(device, pkg)
  return { ok: true }
})
ipcMain.handle('packet-capture:ca-path', () => packetCapture.getCAPath())
ipcMain.handle('packet-capture:install-ca', () => packetCapture.installCA())
ipcMain.handle('packet-capture:system-proxy', (_event, enable: boolean) => packetCapture.setSystemProxy(enable))
ipcMain.handle('packet-capture:adb-devices', () => packetCapture.adbDevices())
ipcMain.handle('packet-capture:adb-setup', () => packetCapture.adbSetupNow())
ipcMain.handle('packet-capture:adb-teardown', () => packetCapture.adbTeardownNow())
ipcMain.handle('packet-capture:adb-packages', () => packetCapture.adbPackages())
ipcMain.handle('packet-capture:save-download', async (_event, url: string, name: string) => {
  if (!mainWindow) return { ok: false, error: 'main-window-unavailable' }
  ensureWindowForeground()
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: name || 'download',
    filters: [{ name: '所有文件', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  return packetCapture.saveDownload(url, name, result.filePath)
})
ipcMain.handle('packet-capture:export', async (_event, format: 'json' | 'csv' | 'txt') => {
  if (!mainWindow) return { ok: false, error: 'main-window-unavailable' }
  ensureWindowForeground()
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `agentsc-capture.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  fs.writeFileSync(result.filePath, packetCapture.exportSessions(format))
  return { ok: true, filePath: result.filePath }
})

// 抓包引擎事件 → 渲染层
packetCapture.on('session', (s) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('packet-capture:event', s)
})
packetCapture.on('session-start', (s) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('packet-capture:event-start', s)
})
packetCapture.on('status', (st) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('packet-capture:status', st)
})
packetCapture.on('error', (e) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('packet-capture:error', e)
})

// ======== 硬件探测 ========
ipcMain.handle('get-hardware-info', async () => {
  try {
    return await getHardwareInfo()
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('get-live-metrics', async () => {
  try {
    return await getLiveMetrics()
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('read-hosts', async () => {
  try {
    return readHosts()
  } catch (err) {
    return { error: String(err) }
  }
})

// 读取硬件探测快照缓存：进页面秒开，无需重新跑 PowerShell 探测。
ipcMain.handle('get-hardware-snapshot', () => {
  try {
    return getHardwareCache()
  } catch (err) {
    return { error: String(err) }
  }
})

// 重新探测硬件并写入数据库快照（供"刷新"按钮或首次无缓存时调用）。
ipcMain.handle('refresh-hardware-snapshot', async () => {
  try {
    const info = await getHardwareInfo()
    const hosts = readHosts()
    saveHardwareCache(info, hosts)
    return { info, hosts, updatedAt: Date.now() }
  } catch (err) {
    return { error: String(err) }
  }
})

// ───────────────────────────────────────────────────────────
// 鼠标键盘管理
// ───────────────────────────────────────────────────────────
ipcMain.handle('mouse-kb:info', async () => {
  try {
    return await getMouseKeyboardInfo()
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('mouse-kb:stats:start', async () => startMouseKbStats())
ipcMain.handle('mouse-kb:stats:stop', async () => {
  stopMouseKbStats()
  return { ok: true }
})
ipcMain.handle('mouse-kb:stats:get', async () => getMouseKbStats())
ipcMain.handle('mouse-kb:stats:reset', async () => {
  resetMouseKbStats()
  return { ok: true }
})

ipcMain.handle('mouse-kb:remap:list', async () => listRemapRules())
ipcMain.handle('mouse-kb:remap:add', async (_event, fromLabel: string, toLabel: string) => addRemapRule(fromLabel, toLabel))
ipcMain.handle('mouse-kb:remap:delete', async (_event, id: string) => deleteRemapRule(id))
ipcMain.handle('mouse-kb:remap:apply', async () => applyRemapRules())

// ======== 系统任务管理器 ========
ipcMain.handle('list-processes', async () => {
  try {
    return await listProcesses()
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('kill-process', async (_event, pid: number) => {
  return killProcess(pid)
})

ipcMain.handle('analyze-processes', async (_event, procs: unknown[], memTotal: number, locale: 'zh-CN' | 'en') => {
  try {
    return analyzeProcesses(procs as never[], memTotal, locale)
  } catch (err) {
    return { error: String(err) }
  }
})

// ======== 系统软件卸载器 ========
ipcMain.handle('list-programs', async () => {
  try {
    return await listPrograms()
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('uninstall-program', async (_event, payload: { uninstallString: string; quiet?: boolean; quietUninstallString?: string }) => {
  return uninstallProgram(payload)
})

// ======== 系统事件查看器 ========
ipcMain.handle('eventviewer:query', async (_event, opts: Parameters<typeof queryEvents>[0]) => {
  try {
    return await queryEvents(opts)
  } catch (err) {
    return { events: [], error: String(err) }
  }
})

ipcMain.handle('eventviewer:xml', async (_event, logName: string, recordId: number) => {
  try {
    return await getEventXml(logName, recordId)
  } catch (err) {
    return { error: String(err) }
  }
})

// ======== 系统定时任务 ========

ipcMain.handle('scheduler:list', () => getScheduledTasks())

ipcMain.handle('scheduler:presets', () => SCHEDULER_PRESETS)

ipcMain.handle('scheduler:create', async (_event, task: any) => {
  const id = createScheduledTask(task)
  mainWindow?.webContents.send('scheduler:updated')
  return { id }
})

ipcMain.handle('scheduler:update', async (_event, id: number, patch: any) => {
  updateScheduledTaskById(id, patch)
  mainWindow?.webContents.send('scheduler:updated')
  return { ok: true }
})

ipcMain.handle('scheduler:delete', async (_event, id: number) => {
  deleteScheduledTaskById(id)
  mainWindow?.webContents.send('scheduler:updated')
  return { ok: true }
})

ipcMain.handle('scheduler:toggle', async (_event, id: number, enabled: boolean) => {
  toggleScheduledTask(id, enabled)
  mainWindow?.webContents.send('scheduler:updated')
  return { ok: true }
})

ipcMain.handle('scheduler:run-now', async (_event, id: number) => {
  return runScheduledTaskNow(id)
})

// ═══════════════════════════════════════════════════════════════
// Windows 任务计划程序（任务注册表管理）
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('wintask:list', async () => {
  try {
    return await listWinTasks()
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('wintask:run', async (_event, name: string) => runWinTask(name))
ipcMain.handle('wintask:set-enabled', async (_event, name: string, enabled: boolean) => setWinTaskEnabled(name, enabled))
ipcMain.handle('wintask:delete', async (_event, name: string) => deleteWinTask(name))
ipcMain.handle('wintask:create', async (_event, opts: WinTaskCreateOptions) => createWinTask(opts))

// ═══════════════════════════════════════════════════════════════
// 「我的电脑」图标管理（清理网盘类图标）
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('pcicons:list', async () => {
  try {
    return await listPcIcons()
  } catch (err) {
    return { error: String(err) }
  }
})
ipcMain.handle('pcicons:remove', async (_event, payload: { parent: 'NameSpace' | 'DelegateFolders'; guid: string }) => removePcIcon(payload))
ipcMain.handle('pcicons:restore', async (_event, payload: { parent: 'NameSpace' | 'DelegateFolders'; guid: string }) => restorePcIcon(payload))
ipcMain.handle('pcicons:backups', async () => listPcBackups())

// 自定义快捷入口（用户自行增删，真实注入「此电脑」）
ipcMain.handle('pcicons:custom:list', async () => {
  try {
    return await listCustomEntries()
  } catch (err) {
    return { error: String(err) }
  }
})
ipcMain.handle('pcicons:custom:add', async (_event, payload: { name: string; type: 'folder' | 'exe' | 'url' | 'file'; target: string; iconPath?: string }) =>
  addCustomEntry(payload),
)
ipcMain.handle('pcicons:custom:remove', async (_event, guid: string) => removeCustomEntry(guid))

// 弹系统对话框前确保主窗口处于前台并可交互：
// dialog.showOpenDialog 以 mainWindow 为父窗口时是「模态」的，会禁用主窗口交互；
// 若主窗口不在最前（被其它窗口遮挡 / 最小化后恢复 / 焦点异常），原生对话框会藏到主窗口之后，
// 用户既看不到对话框、又因模态无法操作主窗口 —— 表现为「点浏览就卡死」。
function ensureWindowForeground() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
    mainWindow.moveTop()
  } catch {
    /* 某些平台 moveTop/focus 在窗口尚未 ready 时会抛错，忽略即可 */
  }
}

// 拒绝清理系统关键目录：渲染进程可直接调用 run-cleaner-rule 传入任意 target，
// 若命中系统目录会以管理员权限清空它。归一到绝对路径后校验 top-level 系统目录。
const SYS_PROTECTED_RE = [
  /^[a-z]:\\windows(\\|$)/i,
  /^[a-z]:\\program files(\s*\(x86\))?(\\|$)/i,
  /^[a-z]:\\programdata(\\|$)/i,
  /^[a-z]:\\users(\\|$)/i,
]
function isSystemProtectedPath(target: string): boolean {
  const t = (target || '').trim()
  if (!t) return false
  let abs = t
  try {
    abs = path.resolve(t)
  } catch {
    /* ignore */
  }
  const norm = abs.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  if (norm.length <= 3) return true // 盘根，如 C:\
  for (const re of SYS_PROTECTED_RE) {
    if (re.test(norm)) return true
  }
  return false
}

// 选择文件夹 / 文件（用于自定义入口的目标与图标）
ipcMain.handle(
  'pcicons:pick',
  async (_event, kind: 'folder' | 'file', fileExtensions?: string[], defaultPath?: string) => {
    if (!mainWindow) return { canceled: true, error: 'main-window-unavailable' }
    ensureWindowForeground()
    const t0 = performance.now()
    try {
      // 指定合理的默认打开位置，避免 Windows 文件对话框从桌面/上次位置开始扫描，
      // 那两类位置若包含大量文件或网络/云盘快捷方式，会显著拖慢对话框弹出。
      let startPath: string | undefined
      if (defaultPath) {
        try {
          const dir = fs.statSync(defaultPath).isDirectory() ? defaultPath : path.dirname(defaultPath)
          if (fs.existsSync(dir)) startPath = dir
        } catch {
          /* 路径无效时忽略 */
        }
      }
      if (!startPath) {
        startPath =
          kind === 'folder'
            ? app.getPath('home')
            : process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || app.getPath('home')
      }

      let result: Electron.OpenDialogReturnValue
      if (kind === 'folder') {
        result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
          defaultPath: startPath,
        })
      } else {
        const filters =
          fileExtensions && fileExtensions.length
            ? [{ name: '筛选', extensions: fileExtensions }]
            : [{ name: '所有文件', extensions: ['*'] }]
        result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile'],
          filters,
          defaultPath: startPath,
        })
      }
      if (result.canceled || result.filePaths.length === 0) return { canceled: true }
      return { canceled: false, path: result.filePaths[0] }
    } catch (err) {
      return { canceled: true, error: String(err) }
    } finally {
      console.log(`[pcicons:pick] kind=${kind} duration=${(performance.now() - t0).toFixed(1)}ms`)
    }
  },
)

// ═══════════════════════════════════════════════════════════════
// 右键菜单管理
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('ctxmenu:list', async () => {
  try {
    return await listContextMenu()
  } catch (err) {
    return { error: String(err) }
  }
})
ipcMain.handle('ctxmenu:set-enabled', async (_event, payload: { root: string; name: string; disable: boolean }) => setContextMenuEnabled(payload as never))
ipcMain.handle('ctxmenu:delete', async (_event, payload: { root: string; name: string }) => deleteContextMenu(payload as never))
ipcMain.handle('ctxmenu:restore', async (_event, payload: { root: string; name: string }) => restoreContextMenu(payload as never))
ipcMain.handle('ctxmenu:backups', async () => listContextMenuBackups())

// ═══════════════════════════════════════════════════════════════
// 网络测速
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('speedtest:servers', async () => SPEED_SERVERS)

ipcMain.handle('speedtest:ping', async (_event, host: string) => runPing(host))

ipcMain.handle('speedtest:download', async (event, url: string, durationMs: number) => {
  const server = SPEED_SERVERS.find((s) => s.down === url)
  return runDownload(
    url,
    durationMs,
    (p: SpeedProgress) => event.sender.send('speedtest:progress', p),
    0,
    server?.headers,
    server?.connections ?? 1,
  )
})

ipcMain.handle('speedtest:upload', async (event, url: string, durationMs: number) => {
  const server = SPEED_SERVERS.find((s) => s.up === url)
  return runUpload(url, durationMs, (p: SpeedProgress) => event.sender.send('speedtest:progress', p), server?.headers)
})

// ═══════════════════════════════════════════════════════════════
// 时间同步（原子钟校时 / 系统 NTP 校时）
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('time:reference', async () => getAtomicReference())
ipcMain.handle('time:resync', async () => resyncSystemClock())

// ═══════════════════════════════════════════════════════════════
// 局域网共享文件夹管理（仅 Windows）
// ═════════════════════════════════════════════════════════════
ipcMain.handle('lanshare:local-shares', async () => {
  try {
    return await listLocalShares()
  } catch (e) {
    return { error: String(e) }
  }
})

ipcMain.handle('lanshare:create', async (_event, input) => {
  try {
    return await createShare(input)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('lanshare:remove', async (_event, name: string) => {
  try {
    return await removeShare(name)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('lanshare:computers', async () => {
  try {
    return await listComputers()
  } catch (e) {
    return { error: String(e) }
  }
})

ipcMain.handle('lanshare:remote-shares', async (_event, computer: string) => {
  try {
    return await listRemoteShares(computer)
  } catch (e) {
    return { error: String(e) }
  }
})

// ═══════════════════════════════════════════════════════════════
// 全局文件搜索（全盘文件名 / FTS5 trigram / 后台建索引）
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('search:query', async (_event, q: string, topK = 40) => {
  try {
    return fileSearchIndexer.query(String(q || ''), topK)
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('search:build', async () => {
  try {
    await fileSearchIndexer.rebuild()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// ═══════════════════════════════════════════════════════════════
// 网络安全监控（流量监控 / ARP 检测拦截 / DHCP 检测）
// ═══════════════════════════════════════════════════════════════
ipcMain.handle('netmon:start', () => {
  netmon.start()
  return netmon.getStatus()
})
ipcMain.handle('netmon:stop', () => {
  netmon.stop()
  return netmon.getStatus()
})
ipcMain.handle('netmon:status', () => netmon.getStatus())
ipcMain.handle('netmon:reset-arp-baseline', async () => {
  await netmon.resetArpBaseline()
  return netmon.getStatus()
})
ipcMain.handle('netmon:pin-gateway', async () => {
  await netmon.pinGateway()
  return netmon.getStatus()
})
ipcMain.handle('netmon:unpin-gateway', () => {
  netmon.unpinGateway()
  return netmon.getStatus()
})
ipcMain.handle('netmon:block-ip', (_event, ip: string) => {
  netmon.blockIp(String(ip))
  return netmon.getStatus()
})
ipcMain.handle('netmon:unblock-ip', (_event, ip: string) => {
  netmon.unblockIp(String(ip))
  return netmon.getStatus()
})
ipcMain.handle('netmon:set-auto-protect', (_event, v: boolean) => {
  netmon.setAutoProtect(Boolean(v))
  return netmon.getStatus()
})
ipcMain.handle('netmon:dhcp-allowlist', () => netmon.getDhcpAllowlist())
ipcMain.handle('netmon:dhcp-add', (_event, ip: string) => {
  netmon.addDhcpAllowlist(String(ip))
  return netmon.getStatus()
})
ipcMain.handle('netmon:dhcp-remove', (_event, ip: string) => {
  netmon.removeDhcpAllowlist(String(ip))
  return netmon.getStatus()
})
ipcMain.handle('netmon:events', () => netmon.getEvents())
ipcMain.handle('netmon:clear-events', () => {
  netmon.clearEvents()
  return netmon.getStatus()
})

ipcMain.handle('search:status', async () => fileSearchIndexer.getStatus())
