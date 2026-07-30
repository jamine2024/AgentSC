// 系统工具（任务管理器 / 卸载器 / 硬件探测）页面与渲染端共用的类型定义。
// 形状需与 src/main 下对应模块返回的数据保持一致。

export interface CpuInfo {
  name: string
  manufacturer: string
  cores: number
  threads: number
  maxClockSpeed: number
  currentClockSpeed: number
  socket: string
  l2Cache: number
  l3Cache: number
  processorId: string
  status: string
}

export interface GpuInfo {
  name: string
  adapterRam: number
  driverVersion: string
  driverDate: string
  videoProcessor: string
  status: string
  resolution: string
  vramText: string
}

export interface MemoryModule {
  manufacturer: string
  capacity: number
  speed: number
  partNumber: string
  serialNumber: string
  bankLabel: string
  deviceLocator: string
  formFactor: string
  tag: string
}

export interface NetworkAdapter {
  name: string
  description: string
  status: string
  linkSpeed: string
  macAddress: string
  mediaType: string
  dnsServers: string[]
}

export interface SystemInfo {
  manufacturer: string
  model: string
  systemType: string
  totalPhysicalMemory: number
  domain: string
  userName: string
  hostName: string
  board: { manufacturer: string; product: string; serial: string; version: string }
  bios: { manufacturer: string; name: string; serial: string; version: string; releaseDate: string }
  os: {
    caption: string
    version: string
    buildNumber: string
    arch: string
    installDate: number
    lastBoot: number
    totalVisibleMem: number
    freePhysMem: number
  }
}

export interface TempSensor {
  name: string
  celsius: number
  source: TempSource
}

export type TempSource = 'thermal' | 'disk' | 'probe' | 'gpu'

// ── IP 追踪 / 网络动作路径（形状需与 src/main/networkTracer.ts 一致）──

export interface NetConnection {
  id: string
  protocol: 'TCP' | 'UDP'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
  processPath: string
  remoteHost?: string
  isExternal: boolean
  firstSeen: number
  lastSeen: number
}

export type NetAction = 'connect' | 'close' | 'listen'

export interface NetEvent {
  id: string
  ts: number
  action: NetAction
  protocol: 'TCP' | 'UDP'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
  processPath: string
  isExternal: boolean
}

export interface NetStatus {
  active: boolean
  intervalMs: number
  resolveHosts: boolean
  lastError?: string
  connCount: number
  extCount: number
  eventCount: number
  lastSampleAt?: number
  startedAt?: number
}

export interface CameraInfo {
  name: string
  manufacturer: string
  status: string
  pnpId: string
}

export interface AudioDevice {
  name: string
  manufacturer: string
  status: string
  deviceId: string
}

export interface DisplayInfo {
  deviceName: string
  width: number
  height: number
  refreshRate: number
  colorDepth: number
  monitorName: string
  monitorManufacturer: string
  monitorType: string
  status: string
}

export interface HardwareInfo {
  cpu: CpuInfo[]
  gpu: GpuInfo[]
  memory: MemoryModule[]
  memoryTotal: number
  network: NetworkAdapter[]
  system: SystemInfo
  camera: CameraInfo[]
  audio: AudioDevice[]
  display: DisplayInfo[]
  temps: TempSensor[]
  tempsSupported: boolean
}

export interface LiveMetric {
  cpu: number
  memUsed: number
  memTotal: number
  memPct: number
  temps: TempSensor[]
  tempsSupported: boolean
  timestamp: number
}

export interface HostsEntry {
  ip: string
  host: string
  comment: string
  raw: string
}

export interface HostsInfo {
  path: string
  exists: boolean
  content: string
  entries: HostsEntry[]
}

export interface ProcessInfo {
  id: number
  name: string
  cpu: number
  cpuTime: number
  memory: number
  company: string
  description: string
  title: string
  responding: boolean
  session: number
  path: string
  handles: number
  threads: number
  startTime: string | null
}

export interface ProcessAnalysisAnomaly {
  title: string
  description: string
  severity: 'low' | 'medium' | 'high'
}

export interface ProcessAnalysisSuggestion {
  title: string
  description: string
  action: string
}

export interface ProcessAnalysisResult {
  summary: string
  anomalies: ProcessAnalysisAnomaly[]
  suggestions: ProcessAnalysisSuggestion[]
  source: string
  generatedAt: number
}

export interface ProgramInfo {
  name: string
  version: string
  publisher: string
  installDate: string
  estimatedSize: number
  uninstallString: string
  quietUninstallString: string
  installLocation: string
  displayIcon: string
  registryKey: string
}

// ── Windows 任务计划程序（任务注册表管理）──
export interface WinTask {
  name: string
  folder: string
  taskName: string
  nextRun: string
  status: string
  lastRun: string
  lastResult: string
  author: string
  command: string
  enabled: boolean
}

export interface WinTaskCreateOptions {
  name: string
  command: string
  scheduleType: 'MINUTE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'ONLOGON' | 'ONSTART' | 'ONCE'
  modifier?: string
  startTime?: string
  day?: string
  force?: boolean
}

// ── 我的电脑图标管理 ──
export type PcIconCategory = 'cloud' | 'folder' | 'system' | 'other'

export interface PcIcon {
  parent: 'NameSpace' | 'DelegateFolders'
  guid: string
  name: string
  category: PcIconCategory
  known: boolean
  description: string
}

export interface PcIconBackup {
  parent: 'NameSpace' | 'DelegateFolders'
  guid: string
  name: string
  removedAt: string
}

// ── 我的电脑：自定义快捷入口（用户自行增删，真实注入「此电脑」）──
export type CustomEntryType = 'folder' | 'exe' | 'url' | 'file'

export interface CustomEntry {
  guid: string
  name: string
  type: CustomEntryType
  target: string
  iconPath?: string
  lnkPath?: string
  createdAt: string
}

// ── 右键菜单管理 ──
export type CtxMenuType = 'shell' | 'handler'

export interface ContextMenuEntry {
  root: string
  name: string
  type: CtxMenuType
  label: string
  command: string
  disabled: boolean
  regPath: string
}

export interface ContextMenuBackup {
  root: string
  name: string
  regPath: string
  file: string
  removedAt: string
}

// ── 网络测速 ──
export interface SpeedServer {
  id: string
  name: string
  ping: string
  down: string
  up?: string
}

export interface SpeedProgress {
  phase: 'ping' | 'download' | 'upload'
  bytes?: number
  mbps?: number
  progress?: number
  elapsedMs?: number
  ms?: number
}

export interface SpeedResult {
  ok: boolean
  phase: 'ping' | 'download' | 'upload'
  mbps?: number
  bytes?: number
  durationMs?: number
  ms?: number
  error?: string
}

// ── 鼠标键盘管理 ──
export type InputInterface = 'USB' | '蓝牙' | 'HID' | '内置' | '其他'

export interface MouseDevice {
  name: string
  manufacturer: string
  deviceId: string
  pnpId: string
  status: string
  interfaceType: InputInterface
  description: string
  batteryPercent: number | null // 0-100 或 null（不可得）
}

export interface KeyboardDevice {
  name: string
  manufacturer: string
  deviceId: string
  pnpId: string
  status: string
  interfaceType: InputInterface
  layout: string
  description: string
  batteryPercent: number | null
}

export interface MouseKeyboardInfo {
  mice: MouseDevice[]
  keyboards: KeyboardDevice[]
  detectedAt: number
}

// 使用统计（主进程全局钩子采集）
export interface MouseKbStats {
  running: boolean
  startedAt: number | null
  totalKeys: number
  totalClicks: number
  keysByCode: Record<string, number>
  activeByHour: number[] // 长度 24
}

// 按键重映射规则
export interface RemapRule {
  id: string
  fromScancode: number
  toScancode: number
  fromLabel: string
  toLabel: string
}
