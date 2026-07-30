// 网络测速（主进程）
// - 延迟：ping 指定主机，解析平均往返时间
// - 下载：流式 GET，按时间窗口累计字节数计算 Mbps，到时主动断开
// - 上传：流式 POST 随机数据，按时间窗口累计字节数计算 Mbps
// 进度通过 onProgress 回调实时上报（由渲染端监听 speedtest:progress 事件）。
import https from 'node:https'
import http from 'node:http'
import { spawn } from 'node:child_process'

export interface SpeedProgress {
  phase: 'ping' | 'download' | 'upload'
  bytes?: number
  mbps?: number
  progress?: number // 0..1
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

export interface SpeedServer {
  id: string
  name: string
  ping: string
  down: string
  up?: string
  /** 该节点测速请求需要额外附加的 HTTP 头（如 Cloudflare 下载需要 Origin） */
  headers?: Record<string, string>
  /** 下载测速建议的并发连接数（单连接易受 TCP 慢启动影响，多连接更接近真实带宽） */
  connections?: number
}

export const SPEED_SERVERS: SpeedServer[] = [
  {
    id: 'cn',
    name: '国内通用 (npmmirror)',
    ping: '223.5.5.5',
    down: 'https://registry.npmmirror.com/-/binary/node/v18.20.4/node-v18.20.4-win-x64.zip',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Speed (全球)',
    ping: '1.1.1.1',
    down: 'https://speed.cloudflare.com/__down?bytes=250000000',
    up: 'https://speed.cloudflare.com/__up',
    headers: { Origin: 'https://speed.cloudflare.com' },
    connections: 4,
  },
  {
    id: 'hetzner',
    name: 'Hetzner (德国)',
    ping: 'speed.hetzner.de',
    down: 'https://speed.hetzner.de/1GB.bin',
  },
  {
    id: 'tele2',
    name: 'Tele2 (欧洲)',
    ping: 'speedtest.tele2.net',
    down: 'https://speedtest.tele2.net/100MB.zip',
  },
]

export function runPing(host: string): Promise<SpeedResult> {
  return new Promise((resolve) => {
    const cp = spawn('ping', ['-n', '4', host], { windowsHide: true })
    let out = ''
    cp.stdout.on('data', (d) => (out += d.toString()))
    cp.on('error', (e) => resolve({ ok: false, phase: 'ping', error: String(e) }))
    cp.on('close', () => {
      const m =
        out.match(/平均\s*=\s*(\d+(?:\.\d+)?)\s*ms/i) ||
        out.match(/Average\s*=\s*(\d+(?:\.\d+)?)\s*ms/i) ||
        out.match(/(\d+(?:\.\d+)?)\s*ms/i)
      const ms = m ? Number(m[1]) : NaN
      resolve({ ok: !Number.isNaN(ms), phase: 'ping', ms, error: Number.isNaN(ms) ? '无法解析延迟' : undefined })
    })
  })
}

function pickLib(url: string) {
  return url.startsWith('https') ? https : http
}

function finalize(bytes: number, start: number, phase: SpeedResult['phase']): SpeedResult {
  const elapsed = Date.now() - start
  return { ok: true, phase, bytes, durationMs: elapsed, mbps: (bytes * 8) / (elapsed / 1000) / 1e6 }
}

const MIN_VALID_BYTES = 64 * 1024 // 测速结果可信所需的最小有效载荷
const PROGRESS_INTERVAL_MS = 200

/** 单连接下载 worker（供并发测速使用） */
function downloadWorker(
  url: string,
  durationMs: number,
  headers: Record<string, string>,
  state: { bytes: number; done: boolean; errors: string[] },
): Promise<void> {
  return new Promise((resolve) => {
    const lib = pickLib(url)
    const req = lib.get(
      url,
      {
        headers: { 'Cache-Control': 'no-cache', Accept: '*/*', 'User-Agent': 'AgentSC-SpeedTest', ...headers },
        timeout: 8000,
      },
      (res) => {
        const code = res.statusCode || 0
        if (code < 200 || code >= 300) {
          res.resume()
          state.errors.push(`服务器返回 ${code}`)
          resolve()
          return
        }
        res.on('data', (chunk: Buffer) => {
          state.bytes += chunk.length
          const elapsed = Date.now() - start
          if (elapsed >= durationMs) {
            req.destroy()
            resolve()
          }
        })
        res.on('end', () => resolve())
        res.on('error', (e) => {
          state.errors.push(String(e))
          resolve()
        })
      },
    )
    const start = Date.now()
    req.on('error', (e) => {
      state.errors.push(String(e))
      resolve()
    })
    req.on('timeout', () => {
      req.destroy()
      state.errors.push('timeout')
      resolve()
    })
    setTimeout(() => {
      if (!state.done) {
        req.destroy()
        resolve()
      }
    }, durationMs + 3000)
  })
}

/** 多连接并发下载，结果更接近真实可用带宽 */
function runDownloadParallel(
  url: string,
  durationMs: number,
  onProgress: (p: SpeedProgress) => void,
  headers: Record<string, string>,
  connections: number,
): Promise<SpeedResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    const state = { bytes: 0, done: false, errors: [] as string[] }
    const progressTimer = setInterval(() => {
      if (state.done) return
      const elapsed = Date.now() - start
      onProgress({
        phase: 'download',
        bytes: state.bytes,
        mbps: (state.bytes * 8) / (elapsed / 1000) / 1e6,
        progress: Math.min(1, elapsed / durationMs),
        elapsedMs: elapsed,
      })
    }, PROGRESS_INTERVAL_MS)

    const finish = (res: SpeedResult) => {
      if (state.done) return
      state.done = true
      clearInterval(progressTimer)
      resolve(res)
    }

    Promise.all(Array.from({ length: connections }, () => downloadWorker(url, durationMs, headers, state))).then(() => {
      if (state.bytes === 0) {
        finish({ ok: false, phase: 'download', error: state.errors[0] || '未收到任何数据' })
      } else if (state.bytes < MIN_VALID_BYTES) {
        finish({ ok: false, phase: 'download', error: '下载数据量过小，测速结果不可信' })
      } else {
        finish(finalize(state.bytes, start, 'download'))
      }
    })

    setTimeout(() => {
      if (!state.done) finish(finalize(state.bytes, start, 'download'))
    }, durationMs + 3000)
  })
}

export function runDownload(
  url: string,
  durationMs: number,
  onProgress: (p: SpeedProgress) => void,
  redirects = 0,
  headers: Record<string, string> = {},
  connections = 1,
): Promise<SpeedResult> {
  if (connections > 1) {
    return runDownloadParallel(url, durationMs, onProgress, headers, connections)
  }
  return new Promise((resolve) => {
    const start = Date.now()
    let bytes = 0
    let done = false
    const finish = (res: SpeedResult) => {
      if (done) return
      done = true
      resolve(res)
    }
    const lib = pickLib(url)
    const req = lib.get(
      url,
      {
        headers: { 'Cache-Control': 'no-cache', Accept: '*/*', 'User-Agent': 'AgentSC-SpeedTest', ...headers },
        timeout: 8000,
      },
      (res) => {
        // 跟随重定向（Cloudflare 等节点可能 301/302 到实际数据地址）
        const code = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < 5) {
          const next = new URL(res.headers.location, url).toString()
          res.resume()
          runDownload(next, durationMs, onProgress, redirects + 1, headers).then(finish)
          return
        }

        // 非成功响应直接视为失败，避免 403/1 字节被算成 0 Mbps
        if (code < 200 || code >= 300) {
          res.resume()
          finish({ ok: false, phase: 'download', error: `服务器返回 ${code}，请更换节点或检查网络` })
          return
        }

        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          const elapsed = Date.now() - start
          onProgress({
            phase: 'download',
            bytes,
            mbps: (bytes * 8) / (elapsed / 1000) / 1e6,
            progress: Math.min(1, elapsed / durationMs),
            elapsedMs: elapsed,
          })
          if (elapsed >= durationMs) {
            req.destroy()
            if (bytes < MIN_VALID_BYTES) {
              finish({ ok: false, phase: 'download', error: '下载数据量过小，测速结果不可信，请更换节点' })
            } else {
              finish(finalize(bytes, start, 'download'))
            }
          }
        })
        res.on('end', () => {
          if (bytes === 0) finish({ ok: false, phase: 'download', error: '未收到任何数据：服务器不可达或被网络拦截，请更换节点或填写自定义 URL' })
          else if (bytes < MIN_VALID_BYTES) finish({ ok: false, phase: 'download', error: '下载数据量过小，测速结果不可信，请更换节点' })
          else finish(finalize(bytes, start, 'download'))
        })
        res.on('error', (e) => finish({ ok: false, phase: 'download', error: String(e) }))
      },
    )
    req.on('error', (e) => finish({ ok: false, phase: 'download', error: String(e) }))
    req.on('timeout', () => {
      req.destroy()
      if (!done) {
        if (bytes === 0) finish({ ok: false, phase: 'download', error: '连接超时：未收到数据，请更换节点或填写自定义 URL' })
        else if (bytes < MIN_VALID_BYTES) finish({ ok: false, phase: 'download', error: '下载数据量过小，测速结果不可信，请更换节点' })
        else finish(finalize(bytes, start, 'download'))
      }
    })
    setTimeout(() => {
      if (!done) {
        req.destroy()
        if (bytes === 0) finish({ ok: false, phase: 'download', error: '测速超时：未收到数据，请更换节点或填写自定义 URL' })
        else if (bytes < MIN_VALID_BYTES) finish({ ok: false, phase: 'download', error: '下载数据量过小，测速结果不可信，请更换节点' })
        else finish(finalize(bytes, start, 'download'))
      }
    }, durationMs + 3000)
  })
}

export function runUpload(
  url: string,
  durationMs: number,
  onProgress: (p: SpeedProgress) => void,
  headers: Record<string, string> = {},
): Promise<SpeedResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    let bytes = 0
    let done = false
    const finish = (res: SpeedResult) => {
      if (done) return
      done = true
      resolve(res)
    }
    const lib = pickLib(url)
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-cache', ...headers },
      },
      (res) => {
        res.resume()
        res.on('end', () => {
          if (bytes < MIN_VALID_BYTES) finish({ ok: false, phase: 'upload', error: '上传数据量过小，测速结果不可信' })
          else finish(finalize(bytes, start, 'upload'))
        })
        res.on('error', (e) => finish({ ok: false, phase: 'upload', error: String(e) }))
      },
    )
    req.on('error', (e) => finish({ ok: false, phase: 'upload', error: String(e) }))
    const chunkSize = 65536
    const writeChunk = () => {
      if (done) return
      const elapsed = Date.now() - start
      if (elapsed >= durationMs) {
        req.end()
        finish(finalize(bytes, start, 'upload'))
        return
      }
      const buf = Buffer.alloc(chunkSize)
      bytes += chunkSize
      const ok = req.write(buf)
      onProgress({
        phase: 'upload',
        bytes,
        mbps: (bytes * 8) / (elapsed / 1000) / 1e6,
        progress: Math.min(1, elapsed / durationMs),
        elapsedMs: elapsed,
      })
      if (!ok) req.once('drain', writeChunk)
      else setImmediate(writeChunk)
    }
    writeChunk()
  })
}
