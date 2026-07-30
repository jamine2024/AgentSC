// 文件/进程图标提取：调用 Windows PowerShell 的 System.Drawing 从 exe/dll/ico
// 提取 32x32 PNG 的 base64 data URI，返回 { 原路径: dataUri }。结果按路径缓存在
// 模块级 Map，重复请求直接命中缓存，避免每次刷新重复 fork powershell。
// 渲染端用于：任务管理器（进程 exe 图标）、卸载器（程序 displayIcon）。
import { execFile } from 'node:child_process'

const iconCache = new Map<string, string>()

// 缓存容量上限：每个图标约 2-5KB base64，无限制会在长时运行 + 大量不同进程路径下
// 持续增长到数十 MB，并随 IPC 回传放大结构化克隆开销。超出后淘汰最旧条目（FIFO）。
const ICON_CACHE_MAX = 500

function cacheIcon(key: string, value: string): void {
  // 先删除再 set，保证命中/更新后该 key 移到末尾（最新）
  if (iconCache.has(key)) iconCache.delete(key)
  iconCache.set(key, value)
  // 超出上限时淘汰最旧（Map 迭代顺序即插入/更新顺序，首项最旧）
  while (iconCache.size > ICON_CACHE_MAX) {
    const oldest = iconCache.keys().next().value
    if (oldest === undefined) break
    iconCache.delete(oldest)
  }
}

function runPowerShell(script: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ' + script],
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 64, timeout: timeoutMs },
      (err: Error | null, stdout: string) => {
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

export async function extractFileIcons(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set((paths || []).filter((p) => p && p.trim())))
  const result: Record<string, string> = {}
  const toExtract: string[] = []
  for (const p of unique) {
    const cached = iconCache.get(p)
    if (cached) result[p] = cached
    else toExtract.push(p)
  }
  if (toExtract.length === 0) return result

  const payload = Buffer.from(JSON.stringify(toExtract), 'utf-8').toString('base64')
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$paths = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$out = @{}
foreach ($p in $paths) {
  try {
    if (-not (Test-Path $p)) { continue }
    $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($p)
    if (-not $ico) { continue }
    $src = $ico.ToBitmap()
    $bmp = New-Object System.Drawing.Bitmap(32, 32)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, 32, 32)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $b64 = [Convert]::ToBase64String($ms.ToArray())
    $out[$p] = "data:image/png;base64," + $b64
    $ms.Dispose(); $g.Dispose(); $bmp.Dispose(); $src.Dispose(); $ico.Dispose()
  } catch { }
}
$out | ConvertTo-Json -Compress
`
  try {
    const raw = await runPowerShell(script)
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>
    for (const k of Object.keys(parsed)) {
      const v = parsed[k]
      if (typeof v === 'string' && v.startsWith('data:image')) {
        cacheIcon(k, v)
        result[k] = v
      }
    }
  } catch {
    /* ignore — 图标缺失不影响主流程 */
  }
  return result
}
