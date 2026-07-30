// 鼠标键盘管理模块：
//  1) 设备信息：通过 WMI（Win32_PointingDevice / Win32_Keyboard / Win32_Battery）探测
//     已连接的鼠标与键盘（名称、厂商、接口类型、状态、电池电量），无需管理员权限。
//  2) 使用统计：主进程加载全局键盘钩子（node-global-key-listener，可选依赖）统计按键次数、
//     常用按键与活跃时段。该依赖在打包环境 npm install 时编译，缺失则自动降级为占位数据。
//  3) 按键重映射：将规则写入当前用户注册表 Scancode Map（HKCU，无需管理员，重启/注销生效）。
import { execFile } from 'node:child_process'
import { db } from './db'

// ─────────────────────── 类型 ───────────────────────
export type InputInterface = 'USB' | '蓝牙' | 'HID' | '内置' | '其他'

export interface MouseDevice {
  name: string
  manufacturer: string
  deviceId: string
  pnpId: string
  status: string
  interfaceType: InputInterface
  description: string
  batteryPercent: number | null
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

export interface MouseKbStats {
  running: boolean
  startedAt: number | null
  totalKeys: number
  totalClicks: number
  keysByCode: Record<string, number>
  activeByHour: number[]
}

export interface RemapRule {
  id: string
  fromScancode: number
  toScancode: number
  fromLabel: string
  toLabel: string
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

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback
  return String(v)
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

// 从 PNPDeviceID 提取末尾 12 位十六进制（蓝牙 MAC），用于电量关联
function extractMac(pnp: string): string {
  const m = (pnp || '').toUpperCase().match(/([0-9A-F]{12})\b/)
  return m ? m[1] : ''
}

function detectInterface(pnp: string): InputInterface {
  const p = (pnp || '').toUpperCase()
  if (p.startsWith('USB\\')) return 'USB'
  if (p.startsWith('BTH') || p.includes('BLUETOOTH')) return '蓝牙'
  if (p.startsWith('HID\\')) return 'HID'
  if (p.startsWith('ROOT\\') || p.includes('ACPI')) return '内置'
  return '其他'
}

// ─────────────────────── 设备探测 ───────────────────────
const POINTING_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-CimInstance -ClassName Win32_PointingDevice -ErrorAction SilentlyContinue | Select-Object Name, Manufacturer, DeviceID, PNPDeviceID, Status, Description, InterfaceType, PointingType | ConvertTo-Json -Compress
`

const KEYBOARD_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-CimInstance -ClassName Win32_Keyboard -ErrorAction SilentlyContinue | Select-Object Name, Manufacturer, DeviceID, PNPDeviceID, Status, Description, Layout | ConvertTo-Json -Compress
`

const BATTERY_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object PNPDeviceID, EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress
`

export async function getMouseKeyboardInfo(): Promise<MouseKeyboardInfo> {
  const [pointingRaw, keyboardRaw, batteryRaw] = await Promise.all([
    runPowerShell(POINTING_SCRIPT).catch(() => '[]'),
    runPowerShell(KEYBOARD_SCRIPT).catch(() => '[]'),
    runPowerShell(BATTERY_SCRIPT).catch(() => '[]'),
  ])

  // 电量关联：以蓝牙 MAC 为键
  const batteryRows = parseJsonArray<any>(batteryRaw)
  const batteryByMac = new Map<string, number>()
  for (const b of batteryRows) {
    const pct = num(b.EstimatedChargeRemaining)
    const mac = extractMac(str(b.PNPDeviceID))
    if (mac && pct >= 0 && pct <= 100) batteryByMac.set(mac, pct)
  }

  const pointingRows = parseJsonArray<any>(pointingRaw)
  const mice: MouseDevice[] = pointingRows.map((r) => {
    const pnp = str(r.PNPDeviceID)
    const mac = extractMac(pnp)
    return {
      name: str(r.Name, '未知鼠标'),
      manufacturer: str(r.Manufacturer),
      deviceId: str(r.DeviceID),
      pnpId: pnp,
      status: str(r.Status, 'OK'),
      interfaceType: detectInterface(pnp),
      description: str(r.Description),
      batteryPercent: mac && batteryByMac.has(mac) ? batteryByMac.get(mac)! : null,
    }
  })

  const keyboardRows = parseJsonArray<any>(keyboardRaw)
  const keyboards: KeyboardDevice[] = keyboardRows.map((r) => {
    const pnp = str(r.PNPDeviceID)
    const mac = extractMac(pnp)
    return {
      name: str(r.Name, '未知键盘'),
      manufacturer: str(r.Manufacturer),
      deviceId: str(r.DeviceID),
      pnpId: pnp,
      status: str(r.Status, 'OK'),
      interfaceType: detectInterface(pnp),
      layout: str(r.Layout),
      description: str(r.Description),
      batteryPercent: mac && batteryByMac.has(mac) ? batteryByMac.get(mac)! : null,
    }
  })

  return { mice, keyboards, detectedAt: Date.now() }
}

// ─────────────────────── 使用统计（全局钩子）───────────────────────
let statsState: MouseKbStats = {
  running: false,
  startedAt: null,
  totalKeys: 0,
  totalClicks: 0,
  keysByCode: {},
  activeByHour: new Array(24).fill(0),
}

// 钩子实例（node-global-key-listener 为可选依赖）
let keyboardHook: { kill: () => void } | null = null

export function getMouseKbStats(): MouseKbStats {
  return {
    ...statsState,
    keysByCode: { ...statsState.keysByCode },
    activeByHour: [...statsState.activeByHour],
  }
}

export function resetMouseKbStats(): void {
  statsState = {
    running: false,
    startedAt: null,
    totalKeys: 0,
    totalClicks: 0,
    keysByCode: {},
    activeByHour: new Array(24).fill(0),
  }
}

// 启动全局键盘钩子统计。返回 true 表示成功加载钩子；false 表示可选依赖不可用（降级）。
export async function startMouseKbStats(): Promise<boolean> {
  if (keyboardHook) return true
  try {
    // @ts-ignore 可选依赖，打包环境 npm install 后可用；缺失时下方 catch 降级
    const mod = await import('node-global-key-listener')
    const Listener = (mod as any).GlobalKeyboardListener
    if (!Listener) return false
    const listener = new Listener()
    // addListener 为异步：内部会启动 WinKeyServer.exe 后台进程，失败会 reject。
    // 必须 await，否则启动失败被静默吞掉、running 却显示 true（计数永远不增长）。
    await listener.addListener((e: { name?: string; state?: string }) => {
      if (e && e.state === 'DOWN') {
        statsState.totalKeys++
        const name = e.name || 'UNKNOWN'
        statsState.keysByCode[name] = (statsState.keysByCode[name] || 0) + 1
        const h = new Date().getHours()
        if (h >= 0 && h < 24) statsState.activeByHour[h]++
      }
    })
    keyboardHook = listener
    statsState.running = true
    statsState.startedAt = statsState.startedAt ?? Date.now()
    return true
  } catch {
    statsState.running = false
    return false
  }
}

export function stopMouseKbStats(): void {
  try {
    keyboardHook?.kill()
  } catch {
    /* ignore */
  }
  keyboardHook = null
  statsState.running = false
}

// ─────────────────────── 按键重映射（注册表 Scancode Map）───────────────────────
// 常用键扫描码（Set 1 / PS/2 兼容）。label 为物理键名（语言中立）。
export const SCANCODES: Record<string, number> = {
  Esc: 0x01,
  F1: 0x3b,
  F2: 0x3c,
  F3: 0x3d,
  F4: 0x3e,
  F5: 0x3f,
  F6: 0x40,
  F7: 0x41,
  F8: 0x42,
  F9: 0x43,
  F10: 0x44,
  F11: 0x57,
  F12: 0x58,
  '`': 0x29,
  '1': 0x02,
  '2': 0x03,
  '3': 0x04,
  '4': 0x05,
  '5': 0x06,
  '6': 0x07,
  '7': 0x08,
  '8': 0x09,
  '9': 0x0a,
  '0': 0x0b,
  '-': 0x0c,
  '=': 0x0d,
  Backspace: 0x0e,
  Tab: 0x0f,
  Q: 0x10,
  W: 0x11,
  E: 0x12,
  R: 0x13,
  T: 0x14,
  Y: 0x15,
  U: 0x16,
  I: 0x17,
  O: 0x18,
  P: 0x19,
  '[': 0x1a,
  ']': 0x1b,
  '\\': 0x2b,
  A: 0x1e,
  S: 0x1f,
  D: 0x20,
  F: 0x21,
  G: 0x22,
  H: 0x23,
  J: 0x24,
  K: 0x25,
  L: 0x26,
  ';': 0x27,
  "'": 0x28,
  Enter: 0x1c,
  Z: 0x2c,
  X: 0x2d,
  C: 0x2e,
  V: 0x2f,
  B: 0x30,
  N: 0x31,
  M: 0x32,
  ',': 0x33,
  '.': 0x34,
  '/': 0x35,
  Space: 0x39,
  CapsLock: 0x3a,
  LShift: 0x2a,
  RShift: 0x36,
  LCtrl: 0x1d,
  LAlt: 0x38,
  LWin: 0x5b,
  RWin: 0x5c,
  PrtSc: 0x37,
  ScrollLock: 0x46,
  Pause: 0x45,
  Insert: 0x52,
  Home: 0x47,
  PageUp: 0x49,
  Delete: 0x53,
  End: 0x4f,
  PageDown: 0x51,
  Up: 0x48,
  Left: 0x4b,
  Down: 0x50,
  Right: 0x4d,
}

const REMAP_KEY = 'mousekb_remap_rules'

function loadRulesFromDb(): RemapRule[] {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(REMAP_KEY) as { value: string } | undefined
    if (!row) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as RemapRule[]) : []
  } catch {
    return []
  }
}

function saveRulesToDb(rules: RemapRule[]): void {
  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(REMAP_KEY, JSON.stringify(rules))
  } catch {
    /* ignore */
  }
}

export function listRemapRules(): RemapRule[] {
  return loadRulesFromDb()
}

export function addRemapRule(fromLabel: string, toLabel: string): { ok: boolean; error?: string; rule?: RemapRule } {
  const fromScancode = SCANCODES[fromLabel]
  const toScancode = SCANCODES[toLabel]
  if (fromScancode === undefined || toScancode === undefined) {
    return { ok: false, error: 'invalid-key' }
  }
  const rules = loadRulesFromDb()
  if (rules.some((r) => r.fromScancode === fromScancode)) {
    return { ok: false, error: 'duplicate-from' }
  }
  const rule: RemapRule = {
    id: `remap-${fromScancode}-${Date.now()}`,
    fromScancode,
    toScancode,
    fromLabel,
    toLabel,
  }
  rules.push(rule)
  saveRulesToDb(rules)
  return { ok: true, rule }
}

export function deleteRemapRule(id: string): { ok: boolean } {
  const rules = loadRulesFromDb().filter((r) => r.id !== id)
  saveRulesToDb(rules)
  return { ok: true }
}

// 将规则写入 HKCU\Keyboard Layout\Scancode Map；空规则则删除该值。
export async function applyRemapRules(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const rules = loadRulesFromDb()
  if (rules.length === 0) {
    // 删除现有映射（不存在也不报错）
    await new Promise<void>((resolve) => {
      execFile('reg', ['delete', 'HKCU\\Keyboard Layout', '/v', 'Scancode Map', '/f'], { encoding: 'utf-8' }, () => resolve())
    })
    return { ok: true, message: 'cleared' }
  }
  const bytes: number[] = []
  // 头部：版本(4) + 标志(4) = 全 0
  bytes.push(0, 0, 0, 0, 0, 0, 0, 0)
  // 数量（4 字节，小端）
  const n = rules.length
  bytes.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff)
  // 每条：to(2) + from(2)
  for (const r of rules) {
    bytes.push(r.toScancode & 0xff, (r.toScancode >> 8) & 0xff, r.fromScancode & 0xff, (r.fromScancode >> 8) & 0xff)
  }
  // 终止符（4 字节全 0）
  bytes.push(0, 0, 0, 0)
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return new Promise((resolve) => {
    execFile('reg', ['add', 'HKCU\\Keyboard Layout', '/v', 'Scancode Map', '/t', 'REG_BINARY', '/f', '/d', hex], { encoding: 'utf-8' }, (err) => {
      if (err) resolve({ ok: false, error: String(err) })
      else resolve({ ok: true, message: 'applied' })
    })
  })
}
