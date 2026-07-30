// 时间同步：从网络时间源（HTTP Date 头，由 NTP 校准）获取权威时间，
// 并计算本机时钟偏差；可选地触发系统 NTP 校时（Windows w32tm）。

import https from 'node:https'
import { execFile } from 'node:child_process'

export interface AtomicReference {
  ok: boolean
  /** 估算的权威时间（Unix 毫秒，已按往返时延校正） */
  epoch?: number
  /** ISO 8601 字符串 */
  iso?: string
  /** 时间源标识 */
  source?: string
  /** 网络往返时延（毫秒） */
  rttMs?: number
  /** 错误信息 */
  error?: string
}

interface DateHeaderResult {
  date: string
  rtt: number
  source: string
}

// 仅需读取响应头，无需下载正文；这些主机返回的 Date 头由 NTP 校准，精度足够校时用。
const DATE_HEADER_ENDPOINTS: { url: string; source: string }[] = [
  { url: 'https://www.cloudflare.com', source: 'Cloudflare' },
  { url: 'https://www.google.com', source: 'Google' },
  { url: 'https://www.microsoft.com', source: 'Microsoft' },
  { url: 'https://www.baidu.com', source: 'Baidu' },
]

function fetchDateHeader(url: string, source: string, timeoutMs = 4000): Promise<DateHeaderResult> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const req = https.get(
      url,
      { timeout: timeoutMs, headers: { 'User-Agent': 'AgentSC-TimeSync/1.0' } },
      (res) => {
        const dateHeader = res.headers['date']
        // 不读取正文，直接丢弃
        res.resume()
        const rtt = Date.now() - t0
        if (!dateHeader) {
          req.destroy()
          return reject(new Error('no-date-header'))
        }
        resolve({ date: dateHeader, rtt, source })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.on('error', (e) => reject(e))
  })
}

/**
 * 获取原子钟（NTP 校准）参考时间。
 * 通过读取 HTTPS 响应的 Date 头，并按往返时延的一半校正，估算权威时间。
 */
export async function getAtomicReference(): Promise<AtomicReference> {
  for (const ep of DATE_HEADER_ENDPOINTS) {
    try {
      const { date, rtt, source } = await fetchDateHeader(ep.url, ep.source)
      const serverDateMs = Date.parse(date)
      if (Number.isNaN(serverDateMs)) continue
      // 服务器生成响应头的时间 ≈ 请求发出(t0) + 往返/2；用 rtt/2 校正本地时钟偏差
      const referenceEpoch = serverDateMs + rtt / 2
      return {
        ok: true,
        epoch: referenceEpoch,
        iso: new Date(referenceEpoch).toISOString(),
        source,
        rttMs: rtt,
      }
    } catch {
      // 尝试下一个时间源
      continue
    }
  }
  return { ok: false, error: 'all-time-sources-unreachable' }
}

export interface ResyncResult {
  ok: boolean
  output: string
  /** 当前系统是否支持自动校时 */
  supported: boolean
}

/**
 * 触发系统 NTP 校时。目前仅 Windows 支持（w32tm /resync）。
 * 需要管理员权限；若权限不足会失败并返回提示。
 */
export function resyncSystemClock(): Promise<ResyncResult> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, output: 'unsupported-os', supported: false })
      return
    }
    execFile('w32tm', ['/resync'], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, output: (stderr || err.message || '').trim(), supported: true })
        return
      }
      resolve({ ok: true, output: (stdout || '').trim(), supported: true })
    })
  })
}
