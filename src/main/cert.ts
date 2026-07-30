import { spawn } from 'node:child_process'
import path from 'node:path'
import { dialog } from 'electron'

// 系统证书管理器依赖 Windows 的 cert: PowerShell provider，非 Windows 优雅降级。
export const isCertSupported = process.platform === 'win32'

const LOCATIONS = ['CurrentUser', 'LocalMachine'] as const
type CertLocation = (typeof LOCATIONS)[number]

export interface CertStore {
  location: string
  name: string
  count: number
}

export interface CertSummary {
  thumbprint: string
  subject: string
  issuer: string
  notBefore: string
  notAfter: string
  hasPrivateKey: boolean
  friendlyName: string
  serialNumber: string
  eku: string
  template: string
  location: string
  store: string
}

export interface CertDetail extends CertSummary {
  thumbprintSha256: string
  san: string
  version: number
  signatureAlgorithm: string
  publicKey: string
}

export interface CertRef {
  location: string
  store: string
  thumbprint: string
  friendlyName?: string
  subject?: string
}

interface PsResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

// 通过 powershell -EncodedCommand 执行脚本（UTF-16LE Base64，避免引号转义问题）。
function runPowerShell(script: string, timeout = 60000): Promise<PsResult> {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let child: ReturnType<typeof spawn> | null = null
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try {
          child?.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve({ ok: false, code: null, stdout, stderr: stderr + '\n[timeout]' })
      }
    }, timeout)
    try {
      const b64 = Buffer.from(script, 'utf16le').toString('base64')
      child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { windowsHide: true })
    } catch (e) {
      clearTimeout(timer)
      resolve({ ok: false, code: null, stdout, stderr: String(e) })
      return
    }
    child.stdout?.on('data', (d) => (stdout += d.toString('utf8')))
    child.stderr?.on('data', (d) => (stderr += d.toString('utf8')))
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ok: false, code: null, stdout, stderr: stderr + '\n' + e.message })
      }
    })
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ok: code === 0, code, stdout, stderr })
      }
    })
  })
}

// PowerShell 单引号字符串转义（' -> ''），防止 CertRef 字段中的引号破坏脚本。
function psStr(s: string): string {
  return `'${String(s ?? '').replace(/'/g, "''")}'`
}

function safeLocation(loc: unknown): CertLocation | null {
  return LOCATIONS.includes(loc as CertLocation) ? (loc as CertLocation) : null
}

function safeStore(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (!t || /['"]/.test(t)) return null
  return t
}

function safeThumb(t: unknown): string | null {
  if (typeof t !== 'string') return null
  return /^[0-9A-Fa-f]{32,}$/.test(t.trim()) ? t.trim().toUpperCase() : null
}

function safeFormat(f: unknown): 'cer' | 'pfx' {
  return f === 'pfx' ? 'pfx' : 'cer'
}

function parseJsonArray(stdout: string): any[] {
  const s = (stdout || '').trim()
  if (!s) return []
  try {
    const parsed = JSON.parse(s)
    if (Array.isArray(parsed)) return parsed
    return [parsed]
  } catch {
    return []
  }
}

// ── 列出所有证书存储位置与存储名（含各存储证书数量） ──
export async function listCertStores(): Promise<{ ok: boolean; notSupported?: boolean; error?: string; stores: CertStore[] }> {
  if (!isCertSupported) return { ok: false, notSupported: true, error: '仅支持 Windows 系统', stores: [] }
  const script = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$result = @()
foreach ($loc in @('CurrentUser','LocalMachine')) {
  try {
    $stores = Get-ChildItem "cert:\\$loc" -ErrorAction Stop
    foreach ($s in $stores) {
      $cnt = 0
      try { $cnt = @(Get-ChildItem $s.PSPath -ErrorAction SilentlyContinue).Count } catch {}
      $result += [pscustomobject]@{ location = $loc; name = $s.Name; count = $cnt }
    }
  } catch {}
}
if ($result.Count -eq 0) { '[]' } else { $result | ConvertTo-Json -Compress -Depth 2 }
`
  const res = await runPowerShell(script, 45000)
  if (!res.ok) return { ok: false, error: (res.stderr || res.stdout || `退出码 ${res.code}`).trim(), stores: [] }
  const raw = parseJsonArray(res.stdout)
  const stores: CertStore[] = raw.map((r) => ({
    location: String(r.location || ''),
    name: String(r.name || ''),
    count: Number(r.count || 0),
  }))
  return { ok: true, stores }
}

// ── 列出指定存储下的证书（摘要字段） ──
export async function listCertificates(
  location: string,
  store: string,
): Promise<{ ok: boolean; notSupported?: boolean; error?: string; certificates: CertSummary[] }> {
  if (!isCertSupported) return { ok: false, notSupported: true, error: '仅支持 Windows 系统', certificates: [] }
  const loc = safeLocation(location)
  const st = safeStore(store)
  if (!loc || !st) return { ok: false, error: '参数无效', certificates: [] }
  const script = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$loc = ${psStr(loc)}
$store = ${psStr(st)}
$path = "cert:\\$loc\\$store"
$certs = @()
try { $certs = @(Get-ChildItem $path -ErrorAction SilentlyContinue) } catch {}
$out = @()
foreach ($c in $certs) {
  $eku = ''
  try { $eku = (($c.EnhancedKeyUsageList | ForEach-Object { $_.FriendlyName }) -join ', ') } catch {}
  $tpl = ''
  try { $tpl = (($c.Extensions | Where-Object { $_.Oid.FriendlyName -eq 'Certificate Template Information' } | ForEach-Object { $_.Format(0) }) -join '; ') } catch {}
  $out += [pscustomobject]@{
    thumbprint = $c.Thumbprint
    subject = $c.Subject
    issuer = $c.Issuer
    notBefore = $c.NotBefore.ToString('yyyy-MM-dd HH:mm:ss')
    notAfter = $c.NotAfter.ToString('yyyy-MM-dd HH:mm:ss')
    hasPrivateKey = $c.HasPrivateKey
    friendlyName = $c.FriendlyName
    serialNumber = $c.SerialNumber
    eku = $eku
    template = $tpl
  }
}
if ($out.Count -eq 0) { '[]' } else { $out | ConvertTo-Json -Compress -Depth 2 }
`
  const res = await runPowerShell(script, 45000)
  if (!res.ok) return { ok: false, error: (res.stderr || res.stdout || `退出码 ${res.code}`).trim(), certificates: [] }
  const raw = parseJsonArray(res.stdout)
  const certificates: CertSummary[] = raw.map((r) => ({
    thumbprint: String(r.thumbprint || ''),
    subject: String(r.subject || ''),
    issuer: String(r.issuer || ''),
    notBefore: String(r.notBefore || ''),
    notAfter: String(r.notAfter || ''),
    hasPrivateKey: !!r.hasPrivateKey,
    friendlyName: String(r.friendlyName || ''),
    serialNumber: String(r.serialNumber || ''),
    eku: String(r.eku || ''),
    template: String(r.template || ''),
    location: loc,
    store: st,
  }))
  return { ok: true, certificates }
}

// ── 读取单张证书完整详情 ──
export async function getCertificateDetail(
  location: string,
  store: string,
  thumbprint: string,
): Promise<{ ok: boolean; notSupported?: boolean; error?: string; cert?: CertDetail }> {
  if (!isCertSupported) return { ok: false, notSupported: true, error: '仅支持 Windows 系统' }
  const loc = safeLocation(location)
  const st = safeStore(store)
  const th = safeThumb(thumbprint)
  if (!loc || !st || !th) return { ok: false, error: '参数无效' }
  const script = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$loc = ${psStr(loc)}
$store = ${psStr(st)}
$thumb = ${psStr(th)}
$path = "cert:\\$loc\\$store"
$c = $null
try { $c = Get-Item "$path\\$thumb" -ErrorAction SilentlyContinue } catch {}
if (-not $c) { @{ ok = $false; error = 'Certificate not found' } | ConvertTo-Json -Compress; exit }
$san = ''
try { $san = (($c.Extensions | Where-Object { $_.Oid.FriendlyName -eq 'Subject Alternative Name' } | ForEach-Object { $_.Format(0) }) -join [Environment]::NewLine) } catch {}
$eku = ''
try { $eku = (($c.EnhancedKeyUsageList | ForEach-Object { $_.FriendlyName }) -join ', ') } catch {}
$sha256 = ''
try { $sha256 = $c.GetCertHashString('SHA256') } catch {}
$pub = ''
try { $pub = $c.PublicKey.Oid.FriendlyName } catch {}
$signature = ''
try { $signature = $c.SignatureAlgorithm.FriendlyName } catch {}
$detail = [pscustomobject]@{
  ok = $true
  thumbprint = $c.Thumbprint
  thumbprintSha256 = $sha256
  subject = $c.Subject
  issuer = $c.Issuer
  notBefore = $c.NotBefore.ToString('yyyy-MM-dd HH:mm:ss')
  notAfter = $c.NotAfter.ToString('yyyy-MM-dd HH:mm:ss')
  hasPrivateKey = $c.HasPrivateKey
  friendlyName = $c.FriendlyName
  serialNumber = $c.SerialNumber
  eku = $eku
  san = $san
  version = $c.Version
  signatureAlgorithm = $signature
  publicKey = $pub
}
$detail | ConvertTo-Json -Compress -Depth 3
`
  const res = await runPowerShell(script, 30000)
  if (!res.ok) return { ok: false, error: (res.stderr || res.stdout || `退出码 ${res.code}`).trim() }
  const raw = parseJsonArray(res.stdout)
  const r = Array.isArray(raw) ? raw[0] : raw
  if (!r || r.ok === false) return { ok: false, error: String(r?.error || '读取失败') }
  const cert: CertDetail = {
    thumbprint: String(r.thumbprint || ''),
    thumbprintSha256: String(r.thumbprintSha256 || ''),
    subject: String(r.subject || ''),
    issuer: String(r.issuer || ''),
    notBefore: String(r.notBefore || ''),
    notAfter: String(r.notAfter || ''),
    hasPrivateKey: !!r.hasPrivateKey,
    friendlyName: String(r.friendlyName || ''),
    serialNumber: String(r.serialNumber || ''),
    eku: String(r.eku || ''),
    san: String(r.san || ''),
    template: '',
    version: Number(r.version || 0),
    signatureAlgorithm: String(r.signatureAlgorithm || ''),
    publicKey: String(r.publicKey || ''),
    location: loc,
    store: st,
  }
  return { ok: true, cert }
}

// 根据证书引用生成安全的默认文件名（去除文件系统非法字符）。
function makeFileName(ref: CertRef): string {
  const base = (ref.friendlyName || ref.subject || '').trim()
  let cn = base
  const m = base.match(/CN=([^,]+)/i)
  if (m) cn = m[1].trim()
  const clean = cn.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 40).replace(/_+$/, '')
  return clean || ref.thumbprint.slice(0, 8)
}

// 单张证书导出到指定文件。
async function exportOne(ref: CertRef, format: 'cer' | 'pfx', filePath: string, password?: string): Promise<{ ok: boolean; error?: string }> {
  const loc = safeLocation(ref.location)
  const st = safeStore(ref.store)
  const th = safeThumb(ref.thumbprint)
  if (!loc || !st || !th) return { ok: false, error: '参数无效' }
  const fp = psStr(filePath)
  const pw = psStr(password || '')
  const script = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$loc = ${psStr(loc)}
$store = ${psStr(st)}
$thumb = ${psStr(th)}
$filePath = ${fp}
$format = ${psStr(format)}
$c = $null
try { $c = Get-Item "cert:\\$loc\\$store\\$thumb" -ErrorAction SilentlyContinue } catch {}
if (-not $c) { @{ ok = $false; error = 'Certificate not found' } | ConvertTo-Json -Compress; exit }
try {
  if ($format -eq 'pfx') {
    $sec = ConvertTo-SecureString -String ${pw} -Force -AsPlainText
    Export-PfxCertificate -Cert $c -FilePath $filePath -Password $sec -Force | Out-Null
  } else {
    Export-Certificate -Cert $c -FilePath $filePath -Type CERT -Force | Out-Null
  }
  @{ ok = $true; filePath = $filePath } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`
  const res = await runPowerShell(script, 30000)
  if (!res.ok) return { ok: false, error: (res.stderr || res.stdout || `退出码 ${res.code}`).trim() }
  const raw = parseJsonArray(res.stdout)
  const r = Array.isArray(raw) ? raw[0] : raw
  return { ok: !!r?.ok, error: r?.ok ? undefined : String(r?.error || '导出失败') }
}

export interface ExportResult {
  ok: boolean
  notSupported?: boolean
  canceled?: boolean
  error?: string
  filePath?: string
  dir?: string
  results?: Array<{ thumbprint: string; ok: boolean; error?: string; filePath: string }>
}

// 导出证书：单张时弹保存对话框；多张时弹目录对话框批量导出。
export async function exportCertificates(
  items: CertRef[],
  format: 'cer' | 'pfx',
  password?: string,
): Promise<ExportResult> {
  if (!isCertSupported) return { ok: false, notSupported: true, error: '仅支持 Windows 系统' }
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: '无证书可导出' }
  const fmt = safeFormat(format)
  try {
    if (items.length === 1) {
      const it = items[0]
      const defName = makeFileName(it) + '.' + fmt
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '导出证书',
        defaultPath: defName,
        filters: [{ name: fmt === 'pfx' ? 'PFX 证书 (*.pfx)' : 'CER 证书 (*.cer)', extensions: [fmt] }],
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      const r = await exportOne(it, fmt, filePath, password)
      return { ok: r.ok, filePath, error: r.error }
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择导出目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true }
    const dir = filePaths[0]
    const results: ExportResult['results'] = []
    for (const it of items) {
      const fp = path.join(dir, makeFileName(it) + '.' + fmt)
      const r = await exportOne(it, fmt, fp, password)
      results.push({ thumbprint: it.thumbprint, ok: r.ok, error: r.error, filePath: fp })
    }
    return { ok: true, dir, results }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export interface DeleteResult {
  ok: boolean
  notSupported?: boolean
  error?: string
  results: Array<{ thumbprint: string; ok: boolean; error?: string }>
}

// 批量删除证书（可选同时删除关联私钥）。
export async function deleteCertificates(items: CertRef[], deleteKey: boolean): Promise<DeleteResult> {
  if (!isCertSupported) return { ok: false, notSupported: true, error: '仅支持 Windows 系统', results: [] }
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: '无证书可删除', results: [] }
  const results: DeleteResult['results'] = []
  for (const ref of items) {
    const loc = safeLocation(ref.location)
    const st = safeStore(ref.store)
    const th = safeThumb(ref.thumbprint)
    if (!loc || !st || !th) {
      results.push({ thumbprint: ref.thumbprint, ok: false, error: '参数无效' })
      continue
    }
    const dk = deleteKey ? '$true' : '$false'
    const script = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$loc = ${psStr(loc)}
$store = ${psStr(st)}
$thumb = ${psStr(th)}
$dk = ${dk}
try {
  if ($dk) { Remove-Item "cert:\\$loc\\$store\\$thumb" -DeleteKey -Force -ErrorAction Stop }
  else { Remove-Item "cert:\\$loc\\$store\\$thumb" -Force -ErrorAction Stop }
  @{ ok = $true } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`
    const res = await runPowerShell(script, 20000)
    if (res.ok) {
      const raw = parseJsonArray(res.stdout)
      const r = Array.isArray(raw) ? raw[0] : raw
      results.push({ thumbprint: th, ok: !!r?.ok, error: r?.ok ? undefined : String(r?.error || '删除失败') })
    } else {
      results.push({ thumbprint: th, ok: false, error: (res.stderr || res.stdout || `退出码 ${res.code}`).trim() })
    }
  }
  const failed = results.filter((r) => !r.ok).length
  return { ok: failed === 0, results }
}

// 供主进程在健康检查 / 初始化时复用，无需额外逻辑。
export function getCertSupport(): { ok: boolean; supported: boolean } {
  return { ok: true, supported: isCertSupported }
}
