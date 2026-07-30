/**
 * packetCapture.ts — AgentSC 网络抓包分析引擎
 *
 * 基于 Node 原生 http/https/net/tls 实现的 MITM 代理，三种抓包模式共用同一引擎：
 *  - HTTP 抓包：本地 HTTP/HTTPS 代理（可一键设置 Windows 系统代理抓取全桌面流量）
 *  - ADB 抓包：adb reverse 把手机流量导到本机代理（需 Android 设备 + adb）
 *  - 锁定应用：桌面按进程 PID 过滤（精确）；ADB 按包名 + iptables(需 root) 过滤
 *
 * 能力：资源分类（图片/视频/接口/脚本…）、按域名/方法/状态/关键字过滤、下载资源嗅探与保存。
 */
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import * as http from 'node:http'
import * as https from 'node:https'
import * as net from 'node:net'
import * as tls from 'node:tls'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import forge from 'node-forge'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type CaptureCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'script'
  | 'style'
  | 'font'
  | 'document'
  | 'api'
  | 'archive'
  | 'other'

export interface CaptureSession {
  id: number
  ts: number
  method: string
  scheme: 'http' | 'https' | 'tunnel'
  host: string
  path: string
  url: string
  status: number
  reqSize: number
  resSize: number
  durationMs: number
  category: CaptureCategory
  contentType: string
  isDownload: boolean
  downloadName: string
  processName: string
  lockTarget: string
  error: string
  reqBody: string | null
  resBody: string | null
}

export interface CaptureStatus {
  running: boolean
  port: number
  mode: 'http' | 'adb'
  lockEnabled: boolean
  lockName: string
  lockPid: number
  systemProxy: boolean
  adbDevice: string
  adbPackage: string
  adbRooted: boolean
  savedProxy: { enable: number; server: string; override: string } | null
  total: number
  downloads: number
}

export interface AdbDevice {
  serial: string
  status: string
  model: string
}

const HOP_HEADERS = new Set([
  'connection',
  'proxy-connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
])

const SESSION_CAP = 6000
const BODY_CAP = 256 * 1024 // 仅对文本类响应/请求体做有限捕获（≤256KB）

function cleanHeaders(h: Record<string, any>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(h)) {
    if (v == null) continue
    if (HOP_HEADERS.has(k.toLowerCase())) continue
    out[k] = v as string | string[]
  }
  return out
}

function extOf(urlPath: string): string {
  const q = urlPath.indexOf('?')
  const p = q >= 0 ? urlPath.slice(0, q) : urlPath
  const m = p.match(/\.([a-z0-9]{1,8})(?:[?#]|$)/i)
  return m ? m[1].toLowerCase() : ''
}

function classify(ct: string, urlPath: string): CaptureCategory {
  const c = (ct || '').toLowerCase().split(';')[0].trim()
  const ext = extOf(urlPath)
  if (c.startsWith('image/')) return 'image'
  if (c.startsWith('video/')) return 'video'
  if (c.startsWith('audio/')) return 'audio'
  if (c.includes('javascript') || ext === 'js' || ext === 'mjs' || c === 'application/x-javascript')
    return 'script'
  if (c === 'text/css' || ext === 'css') return 'style'
  if (c.startsWith('font/') || ['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font'
  if (
    c === 'application/json' ||
    c === 'application/xml' ||
    c === 'text/xml' ||
    c === 'application/x-www-form-urlencoded' ||
    c === 'application/graphql' ||
    c.startsWith('application/vnd.api')
  )
    return 'api'
  if (['html', 'htm', 'xhtml'].includes(ext) || c === 'text/html') return 'document'
  if (
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'md'].includes(ext) ||
    c.startsWith('application/msword') ||
    c.startsWith('application/vnd') ||
    c === 'text/plain'
  )
    return 'document'
  if (
    ['zip', 'apk', 'ipa', 'dmg', 'msi', 'exe', 'jar', 'tar', 'gz', 'tgz', '7z', 'rar', 'iso', 'bin', 'xapk', 'deb', 'rpm'].includes(
      ext,
    ) ||
    c === 'application/zip' ||
    c === 'application/vnd.android.package-archive' ||
    c === 'application/x-msdownload' ||
    c === 'application/x-msi' ||
    c === 'application/octet-stream' ||
    c === 'application/x-apple-diskimage'
  )
    return 'archive'
  return 'other'
}

function isDownloadCandidate(ct: string, urlPath: string, contentDisposition: string): boolean {
  if (contentDisposition && /attachment|inline/i.test(contentDisposition)) return true
  const c = (ct || '').toLowerCase().split(';')[0].trim()
  const ext = extOf(urlPath)
  const dlExt = [
    'apk', 'ipa', 'dmg', 'msi', 'exe', 'zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'iso', 'bin', 'xapk',
    'deb', 'rpm', 'jar', 'mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'mp3', 'wav', 'flac', 'aac',
    'ogg', 'm4a', 'pdf', 'crx', 'xpi',
  ]
  if (dlExt.includes(ext)) return true
  if (c === 'application/octet-stream') return true
  if (
    c.startsWith('application/zip') ||
    c === 'application/vnd.android.package-archive' ||
    c === 'application/x-msdownload' ||
    c === 'application/x-msi' ||
    c === 'application/x-apple-diskimage'
  )
    return true
  if (c.startsWith('video/') || c.startsWith('audio/')) return true
  return false
}

function downloadNameFrom(urlPath: string, contentDisposition: string): string {
  const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(contentDisposition)
  if (m && m[1]) return decodeURIComponent(m[1].trim())
  const q = urlPath.indexOf('?')
  const p = q >= 0 ? urlPath.slice(0, q) : urlPath
  const seg = p.split('/').pop() || ''
  return seg
}

class PacketCaptureEngine extends EventEmitter {
  private server: http.Server | null = null
  private running = false
  private port = 8888
  private mode: 'http' | 'adb' = 'http'
  private lockEnabled = false
  private lockPid = 0
  private lockName = ''
  private adbDevice = ''
  private adbPackage = ''
  private adbRooted = false
  private systemProxy = false
  private savedProxy: { enable: number; server: string; override: string } | null = null
  private caKeyPem = ''
  private caCertPem = ''
  private leafCache = new Map<string, tls.SecureContext>()
  private sessions: CaptureSession[] = []
  private seq = 0
  private pidNameCache = new Map<number, string>()
  private httpsAgent11 = new https.Agent({ keepAlive: false, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] })

  // ── 生命周期 ──────────────────────────────────────────────
  async start(port: number): Promise<void> {
    if (this.running) await this.stop()
    this.port = port
    this.ensureCa()
    this.server = http.createServer((req, res) => this.onHttpRequest(req, res))
    this.server.on('connect', (req, clientSocket, head) =>
      this.onConnect(req as any, clientSocket as net.Socket, head as Buffer),
    )
    this.server.on('error', (e) => {
      this.emit('error', String(e))
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => resolve())
      this.server!.once('error', (e) => reject(e))
    })
    this.running = true
    this.emit('status', this.status())
  }

  async stop(): Promise<void> {
    if (this.systemProxy) await this.setSystemProxy(false).catch(() => {})
    if (this.adbDevice) await this.adbTeardownNow().catch(() => {})
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.server = null
    }
    this.running = false
    this.emit('status', this.status())
  }

  // ── 配置 ──────────────────────────────────────────────────
  setMode(mode: 'http' | 'adb') {
    this.mode = mode
    this.emit('status', this.status())
  }
  setLock(enabled: boolean, pid = 0, name = '') {
    this.lockEnabled = enabled
    this.lockPid = pid
    this.lockName = name
    this.emit('status', this.status())
  }
  setAdbTarget(device: string, pkg: string) {
    this.adbDevice = device
    this.adbPackage = pkg
    this.emit('status', this.status())
  }

  status(): CaptureStatus {
    return {
      running: this.running,
      port: this.port,
      mode: this.mode,
      lockEnabled: this.lockEnabled,
      lockName: this.lockName,
      lockPid: this.lockPid,
      systemProxy: this.systemProxy,
      adbDevice: this.adbDevice,
      adbPackage: this.adbPackage,
      adbRooted: this.adbRooted,
      savedProxy: this.savedProxy,
      total: this.sessions.length,
      downloads: this.sessions.filter((s) => s.isDownload).length,
    }
  }

  getSessions(): CaptureSession[] {
    return this.sessions
  }

  clearSessions() {
    this.sessions = []
    this.emit('status', this.status())
  }

  // ── CA 证书 ───────────────────────────────────────────────
  private caDir(): string {
    const dir = path.join(app.getPath('userData'), 'packet-capture')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private ensureCa() {
    const dir = this.caDir()
    const keyPath = path.join(dir, 'ca.key.pem')
    const certPath = path.join(dir, 'ca.cert.pem')
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      this.caKeyPem = fs.readFileSync(keyPath, 'utf8')
      this.caCertPem = fs.readFileSync(certPath, 'utf8')
      return
    }
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 20)
    const attrs = [
      { name: 'commonName', value: 'AgentSC MITM CA' },
      { name: 'organizationName', value: 'AgentSC' },
      { name: 'organizationalUnitName', value: 'Packet Capture' },
    ]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    this.caKeyPem = forge.pki.privateKeyToPem(keys.privateKey)
    this.caCertPem = forge.pki.certificateToPem(cert)
    fs.writeFileSync(keyPath, this.caKeyPem, { mode: 0o600 })
    try {
      // 收紧 ACL：仅当前用户可读写，避免其他进程/用户读取 CA 私钥
      fs.chmodSync(keyPath, 0o600)
    } catch {
      /* 某些环境 chmod 不支持 ACL，忽略 */
    }
    fs.writeFileSync(certPath, this.caCertPem)
  }

  getCAPath(): string {
    return path.join(this.caDir(), 'ca.cert.pem')
  }

  async installCA(): Promise<{ ok: boolean; message: string }> {
    this.ensureCa()
    const certPath = this.getCAPath()
    try {
      await execFileAsync('certutil', ['-user', '-addstore', 'Root', certPath], { windowsHide: true })
      return { ok: true, message: 'CA 已安装到当前用户受信任根证书颁发机构。Firefox 需在设置中手动导入此文件。' }
    } catch (e: any) {
      try {
        await execFileAsync('certutil', ['-addstore', 'Root', certPath], { windowsHide: true })
        return { ok: true, message: 'CA 已安装到本地计算机受信任根证书（需管理员）。Firefox 需手动导入。' }
      } catch (e2: any) {
        return {
          ok: false,
          message: `自动安装失败：${e2?.message || e2}。请手动将 ${certPath} 导入系统/浏览器受信任根证书。`,
        }
      }
    }
  }

  private getLeafContext(host: string): tls.SecureContext {
    const cached = this.leafCache.get(host)
    if (cached) return cached
    const caCert = forge.pki.certificateFromPem(this.caCertPem)
    const caKey = forge.pki.privateKeyFromPem(this.caKeyPem)
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = Math.floor(Math.random() * 1e12).toString(16)
    cert.validity.notBefore = new Date(2018, 0, 1)
    cert.validity.notAfter = new Date(2035, 0, 1)
    cert.setSubject([{ name: 'commonName', value: host }])
    cert.setIssuer(caCert.subject.attributes)
    const exts: any[] = [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
    ]
    if (net.isIP(host)) exts.push({ name: 'subjectAltName', altNames: [{ type: 7, ip: host }] })
    else exts.push({ name: 'subjectAltName', altNames: [{ type: 2, value: host }] })
    cert.setExtensions(exts)
    cert.sign(caKey, forge.md.sha256.create())
    const ctx = tls.createSecureContext({
      key: forge.pki.privateKeyToPem(keys.privateKey),
      cert: forge.pki.certificateToPem(cert),
    })
    this.leafCache.set(host, ctx)
    if (this.leafCache.size > 200) {
      const first = this.leafCache.keys().next().value
      if (first) this.leafCache.delete(first)
    }
    return ctx
  }

  // ── 进程归属（锁定应用） ──────────────────────────────────
  private async ps(script: string): Promise<string> {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 8000,
    })
    return stdout
  }

  private async resolvePidByLocalPort(localPort: number): Promise<number | null> {
    try {
      const out = await this.ps(
        `(Get-NetTCPConnection -LocalPort ${localPort} -State Established | Select-Object -First 1).OwningProcess`,
      )
      const pid = parseInt((out || '').trim(), 10)
      return isNaN(pid) ? null : pid
    } catch {
      return null
    }
  }

  private async resolveProcessName(pid: number): Promise<string> {
    const cached = this.pidNameCache.get(pid)
    if (cached) return cached
    try {
      const out = await this.ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Name`)
      const name = (out || '').trim() || String(pid)
      this.pidNameCache.set(pid, name)
      return name
    } catch {
      return String(pid)
    }
  }

  private async checkLock(socket: net.Socket): Promise<{ allow: boolean; name: string }> {
    if (!this.lockEnabled || !this.lockPid) return { allow: true, name: '' }
    const localPort = socket.remotePort
    if (!localPort) return { allow: true, name: '' }
    const pid = await this.resolvePidByLocalPort(localPort)
    if (pid == null) return { allow: true, name: 'unknown' }
    if (pid !== this.lockPid) return { allow: false, name: await this.resolveProcessName(pid) }
    return { allow: true, name: this.lockName || (await this.resolveProcessName(pid)) }
  }

  // ── 会话记录 ──────────────────────────────────────────────
  private newSession(partial: Partial<CaptureSession>): CaptureSession {
    const s: CaptureSession = {
      id: ++this.seq,
      ts: Date.now(),
      method: partial.method || '',
      scheme: partial.scheme || 'https',
      host: partial.host || '',
      path: partial.path || '',
      url: partial.url || '',
      status: 0,
      reqSize: 0,
      resSize: 0,
      durationMs: 0,
      category: 'other',
      contentType: '',
      isDownload: false,
      downloadName: '',
      processName: partial.processName || '',
      lockTarget: this.lockEnabled ? this.lockName : '',
      error: '',
      reqBody: null,
      resBody: null,
    }
    return s
  }

  private pushSession(s: CaptureSession) {
    this.sessions.push(s)
    if (this.sessions.length > SESSION_CAP) this.sessions.shift()
    this.emit('session', s)
  }

  // ── HTTP 代理请求（明文） ─────────────────────────────────
  private async onHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const start = Date.now()
    let url: URL
    try {
      url = new URL(req.url || '')
    } catch {
      res.writeHead(400)
      res.end('bad request')
      return
    }
    const host = url.hostname
    const port = url.port ? Number(url.port) : 80
    const lock = await this.checkLock(req.socket)
    if (!lock.allow) {
      res.writeHead(403)
      res.end()
      return
    }
    const session = this.newSession({
      method: req.method || 'GET',
      scheme: 'http',
      host,
      path: url.pathname + url.search,
      url: req.url || '',
      processName: lock.name,
    })
    this.emit('session-start', session)

    const isText = this.isTextRequest(req.headers)
    const upstream = http.request(
      {
        host,
        port,
        method: req.method,
        path: url.pathname + url.search,
        headers: cleanHeaders(req.headers as any),
        timeout: 30000,
      },
      (upRes) => {
        if (res.destroyed || res.writableEnded) {
          upRes.resume()
          return
        }
        const ct = String(upRes.headers['content-type'] || '')
        const cd = String(upRes.headers['content-disposition'] || '')
        const isDl = isDownloadCandidate(ct, url.pathname + url.search, cd)
        const cat = classify(ct, url.pathname + url.search)
        this.finalizeSession(session, {
          status: upRes.statusCode || 0,
          contentType: ct,
          category: cat,
          isDownload: isDl,
          downloadName: isDl ? downloadNameFrom(url.pathname + url.search, cd) : '',
          durationMs: Date.now() - start,
        })
        res.writeHead(upRes.statusCode || 0, cleanHeaders(upRes.headers as any))
        this.pump(upRes, res, isText, (body) => {
          session.resBody = body
          session.resSize = (upRes as any)._capSize || session.resSize
          this.pushSession(session)
        })
      },
    )
    upstream.on('error', (e) => {
      session.error = String(e.message || e)
      this.finalizeSession(session, { status: 0, durationMs: Date.now() - start })
      if (!res.headersSent) res.writeHead(502)
      res.end()
      this.pushSession(session)
    })
    this.pump(req, upstream, isText, (body) => {
      session.reqBody = body
      session.reqSize = (req as any)._capSize || session.reqSize
    })
  }

  // ── HTTPS CONNECT（MITM 解密） ────────────────────────────
  private async onConnect(req: any, clientSocket: net.Socket, head: Buffer) {
    const target = (req.url || '').split(':')
    const host = target[0] || 'unknown'
    const port = Number(target[1]) || 443
    const lock = await this.checkLock(clientSocket)
    if (!lock.allow) {
      clientSocket.destroy()
      return
    }
    const procName = lock.name

    // 非 443：盲转发（不解密），仍记录连接
    if (port !== 443) {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      const session = this.newSession({
        method: 'CONNECT',
        scheme: 'tunnel',
        host: req.url || '',
        path: '',
        url: `tcp://${req.url || ''}`,
        processName: procName,
      })
      this.emit('session-start', session)
      const upstream = net.connect(port, host, () => {
        if (head && head.length) upstream.write(head)
        clientSocket.pipe(upstream)
        upstream.pipe(clientSocket)
      })
      upstream.on('error', () => clientSocket.destroy())
      clientSocket.on('error', () => upstream.destroy())
      upstream.on('close', () => {
        session.durationMs = 0
        this.pushSession(session)
      })
      return
    }

    // 443：MITM 解密
    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: AgentSC\r\n\r\n')
    if (head && head.length) clientSocket.unshift(head)

    const tlsServer = tls.createServer({
      SNICallback: (servername, cb) => {
        try {
          cb(null, this.getLeafContext(servername || host))
        } catch (e) {
          cb(e as Error)
        }
      },
    })
    tlsServer.on('error', () => {})
    tlsServer.on('secureConnection', (tlsSocket: tls.TLSSocket) => {
      const sniHost = (tlsSocket as any).servername || host
      tlsSocket.on('error', () => {})
      const httpServer = http.createServer((r, rs) => this.onHttpsRequest(r, rs, sniHost, procName))
      httpServer.emit('connection', tlsSocket)
      tlsSocket.on('close', () => {
        try {
          httpServer.close(() => {})
        } catch {
          /* ignore */
        }
      })
    })
    tlsServer.emit('connection', clientSocket)
  }

  private onHttpsRequest(req: http.IncomingMessage, res: http.ServerResponse, host: string, procName: string) {
    const start = Date.now()
    const urlPath = req.url || '/'
    const realHost = (req.headers.host || host).toString().split(':')[0]
    const session = this.newSession({
      method: req.method || 'GET',
      scheme: 'https',
      host: realHost,
      path: urlPath,
      url: `https://${realHost}${urlPath}`,
      processName: procName,
    })
    this.emit('session-start', session)

    const isText = this.isTextRequest(req.headers)
    const upstream = https.request(
      {
        host: realHost,
        port: 443,
        method: req.method,
        path: urlPath,
        headers: cleanHeaders(req.headers as any),
        timeout: 30000,
        agent: this.httpsAgent11,
      },
      (upRes) => {
        if (res.destroyed || res.writableEnded) {
          upRes.resume()
          return
        }
        const ct = String(upRes.headers['content-type'] || '')
        const cd = String(upRes.headers['content-disposition'] || '')
        const isDl = isDownloadCandidate(ct, urlPath, cd)
        const cat = classify(ct, urlPath)
        this.finalizeSession(session, {
          status: upRes.statusCode || 0,
          contentType: ct,
          category: cat,
          isDownload: isDl,
          downloadName: isDl ? downloadNameFrom(urlPath, cd) : '',
          durationMs: Date.now() - start,
        })
        res.writeHead(upRes.statusCode || 0, cleanHeaders(upRes.headers as any))
        this.pump(upRes, res, isText, (body) => {
          session.resBody = body
          session.resSize = (upRes as any)._capSize || session.resSize
          this.pushSession(session)
        })
      },
    )
    upstream.on('error', (e) => {
      session.error = String(e.message || e)
      this.finalizeSession(session, { status: 0, durationMs: Date.now() - start })
      if (!res.headersSent) res.writeHead(502)
      res.end()
      this.pushSession(session)
    })
    this.pump(req, upstream, isText, (body) => {
      session.reqBody = body
      session.reqSize = (req as any)._capSize || session.reqSize
    })
  }

  private isTextRequest(headers: any): boolean {
    const ct = String(headers['content-type'] || '').toLowerCase()
    if (!ct) return true
    return (
      ct.startsWith('text/') ||
      ct.includes('json') ||
      ct.includes('xml') ||
      ct.includes('javascript') ||
      ct.includes('x-www-form-urlencoded') ||
      ct.includes('graphql')
    )
  }

  private finalizeSession(session: CaptureSession, patch: Partial<CaptureSession>) {
    Object.assign(session, patch)
  }

  // 同时转发并统计字节、按需捕获文本正文（上限 BODY_CAP）
  private pump(
    src: Readable,
    dst: Writable,
    captureText: boolean,
    onBody: (body: string | null) => void,
  ) {
    let size = 0
    let captured = ''
    let capped = false
    src.on('data', (chunk: Buffer) => {
      dst.write(chunk)
      size += chunk.length
      if (captureText && !capped) {
        if (size <= BODY_CAP) captured += chunk.toString('utf8')
        else {
          captured += chunk.slice(0, BODY_CAP - (size - chunk.length)).toString('utf8')
          capped = true
        }
      }
    })
    src.on('end', () => {
      dst.end()
      ;(src as any)._capSize = size
      if (captureText) onBody(captured || null)
      else onBody(null)
    })
    src.on('error', () => {
      try {
        dst.destroy()
      } catch {
        /* ignore */
      }
    })
    dst.on('error', () => {
      try {
        src.destroy()
      } catch {
        /* ignore */
      }
    })
  }

  // ── 系统代理（Windows Internet Settings） ─────────────────
  async setSystemProxy(enable: boolean): Promise<{ ok: boolean; message: string }> {
    const key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const proxy = `127.0.0.1:${this.port}`
    try {
      if (enable) {
        const cur = await this.ps(
          `@(Get-ItemProperty -Path '${key}' -Name ProxyEnable,ProxyServer,ProxyOverride -ErrorAction SilentlyContinue | ForEach-Object { $_.ProxyEnable, $_.ProxyServer, $_.ProxyOverride }) -join '|'`,
        )
        const parts = (cur || '').trim().split('|')
        this.savedProxy = {
          enable: parts[0] !== undefined && parts[0] !== '' ? Number(parts[0]) : 0,
          server: parts[1] || '',
          override: parts[2] || '<local>',
        }
        const refresh = `
$code = '[DllImport("wininet.dll")] public static extern bool InternetSetOption(int hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'
$win = Add-Type -MemberDefinition $code -Name WinINet -Namespace W -PassThru
$win::InternetSetOption(0, 39, [IntPtr]::Zero, 0) | Out-Null
$win::InternetSetOption(0, 37, [IntPtr]::Zero, 0) | Out-Null`
        await this.ps(
          `Set-ItemProperty -Path '${key}' -Name ProxyEnable -Value 1; Set-ItemProperty -Path '${key}' -Name ProxyServer -Value '${proxy}'; Set-ItemProperty -Path '${key}' -Name ProxyOverride -Value '<local>'; ${refresh}`,
        )
        this.systemProxy = true
        this.emit('status', this.status())
        return { ok: true, message: `系统代理已设置为 ${proxy}（仅本工具流量经 localhost 回环，不影响本机直连）。` }
      } else {
        const saved = this.savedProxy
        if (saved) {
          const refresh = `
$code = '[DllImport("wininet.dll")] public static extern bool InternetSetOption(int hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'
$win = Add-Type -MemberDefinition $code -Name WinINet -Namespace W -PassThru
$win::InternetSetOption(0, 39, [IntPtr]::Zero, 0) | Out-Null
$win::InternetSetOption(0, 37, [IntPtr]::Zero, 0) | Out-Null`
          const script = `Set-ItemProperty -Path '${key}' -Name ProxyEnable -Value ${saved.enable}; Set-ItemProperty -Path '${key}' -Name ProxyServer -Value '${saved.server}'; Set-ItemProperty -Path '${key}' -Name ProxyOverride -Value '${saved.override}'; ${refresh}`
          await this.ps(script)
        } else {
          await this.ps(`Set-ItemProperty -Path '${key}' -Name ProxyEnable -Value 0; Set-ItemProperty -Path '${key}' -Name ProxyServer -Value ''`)
        }
        this.systemProxy = false
        this.savedProxy = null
        this.emit('status', this.status())
        return { ok: true, message: '已恢复系统代理设置。' }
      }
    } catch (e: any) {
      return { ok: false, message: `系统代理设置失败：${e?.message || e}` }
    }
  }

  // ── ADB ───────────────────────────────────────────────────
  private async adbExec(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('adb', args, { windowsHide: true, timeout: 20000 })
      return stdout
    } catch (e: any) {
      if (e?.code === 'ENOENT') throw new Error('未找到 adb，请安装 Android SDK 平台工具并加入 PATH。')
      throw new Error(e?.stderr ? `${e.stderr}` : String(e?.message || e))
    }
  }

  async adbDevices(): Promise<AdbDevice[]> {
    const out = await this.adbExec(['devices', '-l'])
    const lines = out.split('\n').slice(1)
    const devices: AdbDevice[] = []
    for (const line of lines) {
      const t = line.trim()
      if (!t || t.startsWith('*') || !/\b(device|unauthorized|offline)\b/.test(t)) continue
      const [serial, status] = t.split(/\s+/)
      const modelMatch = /model:(\S+)/.exec(t)
      devices.push({ serial, status, model: modelMatch ? modelMatch[1] : '' })
    }
    return devices
  }

  private async checkAdbRooted(device: string): Promise<boolean> {
    try {
      const out = await this.adbExec(['-s', device, 'shell', 'id'])
      return /uid=0\(root\)|uid 0/.test(out)
    } catch {
      return false
    }
  }

  private async adbPackageUid(device: string, pkg: string): Promise<number | null> {
    try {
      const out = await this.adbExec(['-s', device, 'shell', 'dumpsys', 'package', pkg, '|', 'grep', 'userId='])
      const m = /userId=(\d+)/.exec(out)
      return m ? Number(m[1]) : null
    } catch {
      return null
    }
  }

  async adbSetupNow(): Promise<{ ok: boolean; message: string }> {
    if (!this.adbDevice) return { ok: false, message: '请先选择设备。' }
    const device = this.adbDevice
    const port = this.port
    try {
      await this.adbExec(['-s', device, 'reverse', `tcp:${port}`, `tcp:${port}`])
      await this.adbExec(['-s', device, 'shell', 'settings', 'put', 'global', 'http_proxy', `127.0.0.1:${port}`])
      this.adbRooted = await this.checkAdbRooted(device)
      if (this.adbPackage && this.adbRooted) {
        const uid = await this.adbPackageUid(device, this.adbPackage)
        if (uid) {
          await this.adbExec([
            '-s', device, 'shell', 'su', '-c',
            `iptables -t nat -A OUTPUT -m owner --uid-owner ${uid} -p tcp --dport 80 -j REDIRECT --to-ports ${port}; ` +
              `iptables -t nat -A OUTPUT -m owner --uid-owner ${uid} -p tcp --dport 443 -j REDIRECT --to-ports ${port}`,
          ])
        }
      }
      this.emit('status', this.status())
      return {
        ok: true,
        message: `设备代理已开启（adb reverse + http_proxy）。${
          this.adbPackage
            ? this.adbRooted
              ? '已按包名锁定（iptables）。'
              : '此设备未 root，包名锁定不生效，将捕获全部设备流量。'
            : ''
        }`,
      }
    } catch (e: any) {
      return { ok: false, message: `ADB 设置失败：${e?.message || e}` }
    }
  }

  async adbTeardownNow(): Promise<{ ok: boolean; message: string }> {
    if (!this.adbDevice) return { ok: true, message: '无设备。' }
    const device = this.adbDevice
    const port = this.port
    try {
      await this.adbExec(['-s', device, 'reverse', '--remove', `tcp:${port}`]).catch(() => {})
      await this.adbExec(['-s', device, 'shell', 'settings', 'delete', 'global', 'http_proxy']).catch(() => {})
      await this.adbExec(['-s', device, 'shell', 'settings', 'delete', 'global', 'global_http_proxy_host']).catch(() => {})
      await this.adbExec(['-s', device, 'shell', 'settings', 'delete', 'global', 'global_http_proxy_port']).catch(() => {})
      if (this.adbPackage && this.adbRooted) {
        const uid = await this.adbPackageUid(device, this.adbPackage)
        if (uid) {
          await this.adbExec([
            '-s', device, 'shell', 'su', '-c',
            `iptables -t nat -D OUTPUT -m owner --uid-owner ${uid} -p tcp --dport 80 -j REDIRECT --to-ports ${port}; ` +
              `iptables -t nat -D OUTPUT -m owner --uid-owner ${uid} -p tcp --dport 443 -j REDIRECT --to-ports ${port}`,
          ]).catch(() => {})
        }
      }
      this.adbRooted = false
      this.emit('status', this.status())
      return { ok: true, message: '设备代理已关闭。' }
    } catch (e: any) {
      return { ok: false, message: `ADB 关闭失败：${e?.message || e}` }
    }
  }

  async adbPackages(): Promise<string[]> {
    if (!this.adbDevice) return []
    try {
      const out = await this.adbExec(['-s', this.adbDevice, 'shell', 'pm', 'list', 'packages'])
      return out
        .split('\n')
        .map((l) => /package:(\S+)/.exec(l)?.[1])
        .filter(Boolean) as string[]
    } catch {
      return []
    }
  }

  // ── 下载资源保存 ──────────────────────────────────────────
  async saveDownload(url: string, defaultName: string, savePath: string): Promise<{ ok: boolean; message: string }> {
    try {
      const parsed = new URL(url)
      const lib = parsed.protocol === 'http:' ? http : https
      await new Promise<void>((resolve, reject) => {
        const req = lib.get(url, { timeout: 60000 }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            this.saveDownload(new URL(res.headers.location, url).toString(), defaultName, savePath)
              .then(() => resolve())
              .catch(reject)
            return
          }
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`))
            res.resume()
            return
          }
          const out = fs.createWriteStream(savePath)
          res.pipe(out)
          out.on('finish', () => resolve())
          out.on('error', reject)
        })
        req.on('error', reject)
        req.setTimeout(60000, () => req.destroy(new Error('timeout')))
      })
      return { ok: true, message: `已保存到 ${savePath}` }
    } catch (e: any) {
      return { ok: false, message: `保存失败：${e?.message || e}` }
    }
  }

  // ── 导出 ──────────────────────────────────────────────────
  exportSessions(format: 'json' | 'csv' | 'txt'): string {
    const list = this.sessions
    if (format === 'json') return JSON.stringify(list, null, 2)
    if (format === 'csv') {
      const head = ['id', 'time', 'method', 'scheme', 'host', 'path', 'status', 'reqSize', 'resSize', 'duration', 'category', 'contentType', 'isDownload', 'processName', 'url']
      const rows = list.map((s) => [
        s.id,
        new Date(s.ts).toISOString(),
        s.method,
        s.scheme,
        s.host,
        s.path,
        s.status,
        s.reqSize,
        s.resSize,
        s.durationMs,
        s.category,
        s.contentType,
        s.isDownload,
        s.processName,
        s.url,
      ])
      const esc = (v: any) => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      return [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
    }
    // txt
    return list
      .map(
        (s) =>
          `[${new Date(s.ts).toLocaleString('zh-CN')}] ${s.method} ${s.scheme.toUpperCase()} ${s.status} ` +
          `${s.host}${s.path} (${s.category}, ${s.resSize}B)${s.isDownload ? ' [下载:' + s.downloadName + ']' : ''}`,
      )
      .join('\n')
  }
}

export const packetCapture = new PacketCaptureEngine()
