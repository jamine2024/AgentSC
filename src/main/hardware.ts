// 硬件探测模块：通过 PowerShell / WMI 查询本机核心硬件参数（CPU / GPU / 内存条 /
// 主板 / BIOS / 系统 / 网络 / DNS），读取 HOSTS 文件，并提供实时指标采样
// （CPU 占用率、内存占用、温度）。温度依赖 root/WMI MSAcpi_ThermalZoneTemperature，
// 很多消费级设备不暴露该数据，因此采用"尽力而为 + 优雅降级"策略。
import fs from 'node:fs'
import { execFile } from 'node:child_process'

// ───────────────────────────── 类型 ─────────────────────────────
export interface CpuInfo {
  name: string
  manufacturer: string
  cores: number
  threads: number
  maxClockSpeed: number // MHz
  currentClockSpeed: number // MHz
  socket: string
  l2Cache: number // KB
  l3Cache: number // KB
  processorId: string
  status: string
}

export interface GpuInfo {
  name: string
  adapterRam: number // bytes，可能为 0
  driverVersion: string
  driverDate: string
  videoProcessor: string
  status: string
  resolution: string
  vramText: string
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
  refreshRate: number // Hz
  colorDepth: number // bits
  monitorName: string
  monitorManufacturer: string
  monitorType: string
  status: string
}

export interface MemoryModule {
  manufacturer: string
  capacity: number // bytes
  speed: number // MHz
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
  source: TempSource // thermal=ACPI 热区 / disk=磁盘 / probe=主板探针 / gpu=显卡
}

export type TempSource = 'thermal' | 'disk' | 'probe' | 'gpu'

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
  cpu: number // 0-100 平均
  memUsed: number // bytes
  memTotal: number // bytes
  memPct: number // 0-100
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

// ─────────────────────── PowerShell 执行辅助 ───────────────────────
function runPowerShell(script: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ' + script],
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 32, timeout: timeoutMs },
      (err, stdout) => {
        if (err) {
          // 超时 / 非零退出码都可能进 err；优先返回已采集的 stdout 以便尽力解析
          if (stdout && stdout.trim()) resolve(stdout)
          else reject(err)
          return
        }
        resolve(stdout)
      },
    )
  })
}

function parseJsonArray<T>(s: string): T[] {
  const trimmed = (s || '').trim()
  if (!trimmed) return []
  try {
    const data = JSON.parse(trimmed)
    return (Array.isArray(data) ? data : [data]) as T[]
  } catch {
    return []
  }
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback
  return String(v)
}

// ─────────────────────── 各子项查询脚本 ───────────────────────

const CPU_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-CimInstance -ClassName Win32_Processor | Select-Object Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, CurrentClockSpeed, SocketDesignation, ProcessorId, L2CacheSize, L3CacheSize, Status | ConvertTo-Json -Compress
`

const GPU_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-CimInstance -ClassName Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion, DriverDate, VideoProcessor, Status, CurrentHorizontalResolution, CurrentVerticalResolution | ConvertTo-Json -Compress
`

const MEM_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-CimInstance -ClassName Win32_PhysicalMemory | Select-Object Manufacturer, Capacity, Speed, PartNumber, SerialNumber, BankLabel, DeviceLocator, FormFactor, Tag | ConvertTo-Json -Compress
`

const NET_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, LinkSpeed, MacAddress, MediaType, InterfaceIndex | ConvertTo-Json -Compress
`

const DNS_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | Select-Object InterfaceAlias, ServerAddresses | ConvertTo-Json -Compress
`

const SYSTEM_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
$cs = Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object Manufacturer, Model, SystemType, TotalPhysicalMemory, Domain, UserName, Name;
$board = Get-CimInstance -ClassName Win32_BaseBoard | Select-Object Manufacturer, Product, SerialNumber, Version;
$bios = Get-CimInstance -ClassName Win32_BIOS | Select-Object Manufacturer, Name, SerialNumber, SMBIOSBIOSVersion, ReleaseDate;
$os = Get-CimInstance -ClassName Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture, InstallDate, LastBootUpTime, TotalVisibleMemorySize, FreePhysicalMemory;
[PSCustomObject]@{ cs=$cs; board=$board; bios=$bios; os=$os } | ConvertTo-Json -Compress -Depth 4
`

const CAMERA_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.PNPClass -in @('Camera','Image') -and ($_.Name -notmatch 'Scanner') } | Select-Object Name, Manufacturer, Status, PNPDeviceID | ConvertTo-Json -Compress
`

const AUDIO_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-CimInstance -ClassName Win32_SoundDevice -ErrorAction SilentlyContinue | Select-Object Name, Manufacturer, Status, DeviceID | ConvertTo-Json -Compress
`

const DISPLAY_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
$cfg = Get-CimInstance -ClassName Win32_DisplayConfiguration -ErrorAction SilentlyContinue | Select-Object DeviceName, PelsWidth, PelsHeight, BitsPerPel, DisplayFrequency, SettingID;
$mon = Get-CimInstance -ClassName Win32_DesktopMonitor -ErrorAction SilentlyContinue | Select-Object Name, MonitorManufacturer, MonitorType, Availability, Status, DeviceID;
[PSCustomObject]@{ cfg=$cfg; mon=$mon } | ConvertTo-Json -Compress -Depth 4
`

// 多来源温度采集：ACPI 热区 / 物理磁盘 / 主板温度探针 / NVIDIA 显卡。
// 采用"尽力而为 + 优雅降级"，任一批令异常都不影响其他来源。
const TEMP_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
$out = @();
try {
  Get-CimInstance -Namespace root/WMI -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CurrentTemperature) {
      $out += [PSCustomObject]@{
        name = $_.InstanceName
        celsius = [math]::Round(($_.CurrentTemperature / 10 - 273.15), 1)
        source = 'thermal'
      }
    }
  }
} catch {}
try {
  Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
    if ($null -ne $_.Temperature) {
      $out += [PSCustomObject]@{
        name = "磁盘: $($_.FriendlyName)"
        celsius = [math]::Round($_.Temperature, 1)
        source = 'disk'
      }
    }
  }
} catch {}
try {
  Get-CimInstance -ClassName Win32_TemperatureProbe -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CurrentReading -and $_.CurrentReading -ne 0) {
      $out += [PSCustomObject]@{
        name = $_.Name
        celsius = [math]::Round(($_.CurrentReading / 10 - 273.15), 1)
        source = 'probe'
      }
    }
  }
} catch {}
try {
  $g = & nvidia-smi --query-gpu=name,temperature.gpu --format=csv,noheader 2>$null
  if ($g) {
    $g | ForEach-Object {
      $parts = ($_ -split ',')
      if ($parts.Length -eq 2) {
        $out += [PSCustomObject]@{
          name = "GPU: $($parts[0].Trim())"
          celsius = [double]($parts[1].Trim())
          source = 'gpu'
        }
      }
    }
  }
} catch {}
if ($out.Count -eq 0) { '[]' } else { $out | ConvertTo-Json -Compress }
`

// ───────────────────────────── 实现 ─────────────────────────────

export async function getHardwareInfo(): Promise<HardwareInfo> {
  const [cpuRaw, gpuRaw, memRaw, netRaw, dnsRaw, sysRaw, tempRaw, camRaw, audioRaw, dispRaw] = await Promise.all([
    runPowerShell(CPU_SCRIPT).catch(() => ''),
    runPowerShell(GPU_SCRIPT).catch(() => ''),
    runPowerShell(MEM_SCRIPT).catch(() => ''),
    runPowerShell(NET_SCRIPT).catch(() => '[]'),
    runPowerShell(DNS_SCRIPT).catch(() => '[]'),
    runPowerShell(SYSTEM_SCRIPT).catch(() => '{}'),
    runPowerShell(TEMP_SCRIPT).catch(() => '[]'),
    runPowerShell(CAMERA_SCRIPT).catch(() => '[]'),
    runPowerShell(AUDIO_SCRIPT).catch(() => '[]'),
    runPowerShell(DISPLAY_SCRIPT).catch(() => '{}'),
  ])

  const cpuRows = parseJsonArray<any>(cpuRaw)
  const cpu: CpuInfo[] = cpuRows.map((r) => ({
    name: str(r.Name, '未知处理器'),
    manufacturer: str(r.Manufacturer),
    cores: num(r.NumberOfCores),
    threads: num(r.NumberOfLogicalProcessors),
    maxClockSpeed: num(r.MaxClockSpeed),
    currentClockSpeed: num(r.CurrentClockSpeed),
    socket: str(r.SocketDesignation),
    l2Cache: num(r.L2CacheSize),
    l3Cache: num(r.L3CacheSize),
    processorId: str(r.ProcessorId),
    status: str(r.Status, 'OK'),
  }))

  const gpuRows = parseJsonArray<any>(gpuRaw)
  const gpu: GpuInfo[] = gpuRows.map((r) => {
    const ram = num(r.AdapterRAM)
    const w = num(r.CurrentHorizontalResolution)
    const h = num(r.CurrentVerticalResolution)
    return {
      name: str(r.Name, '未知显卡'),
      adapterRam: ram,
      driverVersion: str(r.DriverVersion),
      driverDate: str(r.DriverDate),
      videoProcessor: str(r.VideoProcessor),
      status: str(r.Status, 'OK'),
      resolution: w && h ? `${w} × ${h}` : '',
      vramText: ram > 0 ? `${(ram / 1073741824).toFixed(2)} GB` : '共享显存',
    }
  })

  const memRows = parseJsonArray<any>(memRaw)
  const memory: MemoryModule[] = memRows.map((r) => ({
    manufacturer: normalizeMemoryBrand(str(r.Manufacturer)),
    capacity: num(r.Capacity),
    speed: num(r.Speed),
    partNumber: str(r.PartNumber),
    serialNumber: str(r.SerialNumber),
    bankLabel: str(r.BankLabel),
    deviceLocator: str(r.DeviceLocator),
    formFactor: str(r.FormFactor),
    tag: str(r.Tag),
  }))
  const memoryTotal = memory.reduce((sum, m) => sum + m.capacity, 0)

  const dnsRows = parseJsonArray<{ InterfaceAlias: string; ServerAddresses: string[] | string }>(dnsRaw)
  const dnsMap = new Map<string, string[]>()
  for (const d of dnsRows) {
    const servers = Array.isArray(d.ServerAddresses)
      ? d.ServerAddresses
      : String(d.ServerAddresses || '').split(/[,\s]+/).filter(Boolean)
    if (servers.length) dnsMap.set(String(d.InterfaceAlias), servers)
  }

  const netRows = parseJsonArray<any>(netRaw)
  const network: NetworkAdapter[] = netRows.map((r) => ({
    name: str(r.Name),
    description: str(r.InterfaceDescription),
    status: str(r.Status),
    linkSpeed: str(r.LinkSpeed),
    macAddress: str(r.MacAddress),
    mediaType: str(r.MediaType),
    dnsServers: dnsMap.get(str(r.Name)) || [],
  }))

  const sys = parseJsonArray<any>(sysRaw)[0] || {}
  const cs = sys.cs || {}
  const board = sys.board || {}
  const bios = sys.bios || {}
  const os = sys.os || {}
  const system: SystemInfo = {
    manufacturer: str(cs.Manufacturer),
    model: str(cs.Model),
    systemType: str(cs.SystemType),
    totalPhysicalMemory: num(cs.TotalPhysicalMemory),
    domain: str(cs.Domain),
    userName: str(cs.UserName),
    hostName: str(cs.Name),
    board: {
      manufacturer: str(board.Manufacturer),
      product: str(board.Product),
      serial: str(board.SerialNumber),
      version: str(board.Version),
    },
    bios: {
      manufacturer: str(bios.Manufacturer),
      name: str(bios.Name),
      serial: str(bios.SerialNumber),
      version: str(bios.SMBIOSBIOSVersion),
      releaseDate: String(parseWmiDate(str(bios.ReleaseDate))),
    },
    os: {
      caption: str(os.Caption),
      version: str(os.Version),
      buildNumber: str(os.BuildNumber),
      arch: str(os.OSArchitecture),
      installDate: parseWmiDate(str(os.InstallDate)),
      lastBoot: parseWmiDate(str(os.LastBootUpTime)),
      totalVisibleMem: num(os.TotalVisibleMemorySize) * 1024,
      freePhysMem: num(os.FreePhysicalMemory) * 1024,
    },
  }

  const temps = parseJsonArray<any>(tempRaw)
    .map((t) => ({
      name: str(t.name),
      celsius: num(t.celsius),
      source: (['thermal', 'disk', 'probe', 'gpu'].includes(t.source) ? t.source : 'thermal') as TempSource,
    }))
    .filter((t) => Number.isFinite(t.celsius) && t.celsius >= -20 && t.celsius <= 150)
  const tempsSupported = temps.length > 0

  const camRows = parseJsonArray<any>(camRaw)
  const camera: CameraInfo[] = camRows.map((r) => ({
    name: str(r.Name, '未知摄像头'),
    manufacturer: str(r.Manufacturer),
    status: str(r.Status, 'OK'),
    pnpId: str(r.PNPDeviceID),
  }))

  const audioRows = parseJsonArray<any>(audioRaw)
  const audio: AudioDevice[] = audioRows.map((r) => ({
    name: str(r.Name, '未知音频设备'),
    manufacturer: str(r.Manufacturer),
    status: str(r.Status, 'OK'),
    deviceId: str(r.DeviceID),
  }))

  const disp = parseJsonArray<any>(dispRaw)[0] || {}
  const cfgRows = Array.isArray(disp.cfg) ? disp.cfg : disp.cfg ? [disp.cfg] : []
  const monRows = Array.isArray(disp.mon) ? disp.mon : disp.mon ? [disp.mon] : []
  const display: DisplayInfo[] = cfgRows.map((c: any, i: number) => {
    const m = monRows[i] || {}
    return {
      deviceName: str(c.DeviceName),
      width: num(c.PelsWidth),
      height: num(c.PelsHeight),
      refreshRate: num(c.DisplayFrequency),
      colorDepth: num(c.BitsPerPel),
      monitorName: str(m.Name),
      monitorManufacturer: str(m.MonitorManufacturer),
      monitorType: str(m.MonitorType),
      status: str(m.Status, str(c.Status, 'OK')),
    }
  })

  return { cpu, gpu, memory, memoryTotal, network, system, camera, audio, display, temps, tempsSupported }
}

// 温度实时采样缓存（避免每次轮询都 fork powershell）
let tempCache: { at: number; temps: TempSensor[]; supported: boolean } | null = null
const TEMP_CACHE_TTL = 5000

let liveCache: { at: number; data: LiveMetric } | null = null
const LIVE_CACHE_TTL = 2000

export async function getLiveMetrics(): Promise<LiveMetric> {
  const now = Date.now()
  if (liveCache && now - liveCache.at < LIVE_CACHE_TTL) return liveCache.data

  const [cpuRaw, memRaw, tempRaw] = await Promise.all([
    runPowerShell(
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; (Get-CimInstance -ClassName Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average`,
    ).catch(() => ''),
    runPowerShell(
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance -ClassName Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory | ConvertTo-Json -Compress`,
    ).catch(() => ''),
    runPowerShell(TEMP_SCRIPT).catch(() => '[]'),
  ])

  const cpu = (() => {
    const v = parseFloat((cpuRaw || '').trim())
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0
  })()

  const mem = parseJsonArray<any>(memRaw)[0] || {}
  const memTotal = num(mem.TotalVisibleMemorySize) * 1024
  const memFree = num(mem.FreePhysicalMemory) * 1024
  const memUsed = Math.max(0, memTotal - memFree)
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0

  let temps: TempSensor[] = []
  let tempsSupported = false
  if (tempCache && now - tempCache.at < TEMP_CACHE_TTL) {
    temps = tempCache.temps
    tempsSupported = tempCache.supported
  } else {
    temps = parseJsonArray<any>(tempRaw)
      .map((t) => ({
        name: str(t.name),
        celsius: num(t.celsius),
        source: (['thermal', 'disk', 'probe', 'gpu'].includes(t.source) ? t.source : 'thermal') as TempSource,
      }))
      .filter((t) => Number.isFinite(t.celsius) && t.celsius >= -20 && t.celsius <= 150)
    tempsSupported = temps.length > 0
    tempCache = { at: now, temps, supported: tempsSupported }
  }

  const result: LiveMetric = { cpu, memUsed, memTotal, memPct, temps, tempsSupported, timestamp: now }
  liveCache = { at: now, data: result }
  return result
}

export function readHosts(): HostsInfo {
  const p = 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  try {
    if (!fs.existsSync(p)) {
      return { path: p, exists: false, content: '', entries: [] }
    }
    const content = fs.readFileSync(p, 'utf-8')
    const entries: HostsEntry[] = []
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const commentIdx = trimmed.indexOf('#')
      const body = (commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed).trim()
      const parts = body.split(/\s+/)
      if (parts.length < 2) continue
      entries.push({
        ip: parts[0],
        host: parts.slice(1).join(' '),
        comment: commentIdx >= 0 ? trimmed.slice(commentIdx + 1).trim() : '',
        raw: line,
      })
    }
    return { path: p, exists: true, content, entries }
  } catch (err) {
    return { path: p, exists: false, content: '', entries: [], ...{ error: String(err) } } as HostsInfo
  }
}

// ───────────────────────────── 工具 ─────────────────────────────

function normalizeMemoryBrand(m: string): string {
  const s = (m || '').trim().toUpperCase()
  if (!s || s === 'UNKNOWN' || s === '000000000000') return '未知品牌'
  const map: Record<string, string> = {
    'SAMSUNG': '三星 (Samsung)',
    'SK HYNIX': '海力士 (SK Hynix)',
    HYNIX: '海力士 (SK Hynix)',
    'KINGSTON': '金士顿 (Kingston)',
    'CRUCIAL': '英睿达 (Crucial)',
    MICRON: '美光 (Micron)',
    'CORSAIR': '海盗船 (Corsair)',
    'G.SKILL': '芝奇 (G.Skill)',
    'ADATA': '威刚 (ADATA)',
    'TEAMGROUP': '十铨 (TeamGroup)',
    'KINGSTON TECHNOLOGY': '金士顿 (Kingston)',
    'SMART MODULAR': '世迈 (SMART)',
    RAMAXEL: '记忆科技 (Ramaxel)',
    'MICRON TECHNOLOGY': '美光 (Micron)',
  }
  for (const key of Object.keys(map)) {
    if (s.includes(key)) return map[key]
  }
  return m.trim()
}

function parseWmiDate(s: string): number {
  // WMI 日期形如 20230101000000.000000+000
  const m = (s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
  if (!m) return 0
  const [, y, mo, d, h, mi, se] = m
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}`)
  return Number.isNaN(dt.getTime()) ? 0 : dt.getTime()
}
