// ───────────────────────────────────────────────────────────
// 系统事件查看器（主进程）
// - 通过 PowerShell Get-WinEvent 读取 Windows 事件日志
// - queryEvents：按日志名 / 级别 / 时间范围 / 关键字检索，返回结构化列表
// - getEventXml：按 RecordId 取单条事件的原始 XML（FilterXPath）
// 用户需求：查看异常（错误/关键/警告）、搜索、排序、过滤、查看 XML。
// ───────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'

export interface SystemEvent {
  recordId: number
  timeCreated: string // ISO 8601（本地时区）
  level: number // 1=Critical 2=Error 3=Warning 4=Information 5=Verbose 0=Other
  provider: string
  id: number
  task: string
  message: string
}

export interface EventQueryOptions {
  logName: string
  levels?: number[] // 仅读取指定级别
  search?: string // 匹配 Message / ProviderName / Id
  from?: string // 本地 datetime（datetime-local 格式）
  to?: string
  max?: number // 最大返回条数（1..2000）
}

export interface EventQueryResult {
  events: SystemEvent[]
  error?: string
}

const PS_TIMEOUT = 30_000

function sanitizeLogName(s: string): string {
  return (s || '').replace(/[^A-Za-z0-9_\-./# ]/g, '').slice(0, 120)
}

// 嵌入 PowerShell 单引号字符串：仅 ' 需转义为 ''
function sanitizeSearch(s: string): string {
  return (s || '').replace(/'/g, "''").slice(0, 200)
}

function sanitizeDate(s: string): string {
  return (s || '').replace(/[^0-9T:\-]/g, '').slice(0, 25)
}

function runPowerShell(script: string, timeout = PS_TIMEOUT): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ' + script],
      { encoding: 'utf-8', timeout, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        resolve((stdout || '').trim())
      },
    )
  })
}

export async function queryEvents(opts: EventQueryOptions): Promise<EventQueryResult> {
  const logName = sanitizeLogName(opts.logName)
  if (!logName) return { events: [], error: 'invalid-log-name' }

  const lines: string[] = []
  lines.push('$ErrorActionPreference = "Stop"')
  lines.push('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8')
  lines.push(`$filter = @{ LogName = '${logName}' }`)

  if (opts.levels && opts.levels.length > 0) {
    const arr = opts.levels.map((l) => Math.trunc(l)).join(',')
    lines.push(`$filter['Level'] = @(${arr})`)
  }
  if (opts.from) {
    const f = sanitizeDate(opts.from)
    if (f) lines.push(`$filter['StartTime'] = [datetime]::Parse('${f}')`)
  }
  if (opts.to) {
    const t = sanitizeDate(opts.to)
    if (t) lines.push(`$filter['EndTime'] = [datetime]::Parse('${t}')`)
  }

  const max = Math.min(Math.max(opts.max ?? 200, 1), 2000)
  lines.push('try {')
  lines.push(`  $evts = Get-WinEvent -FilterHashtable $filter -MaxEvents ${max} -ErrorAction Stop`)
  lines.push('} catch {')
  lines.push("  if ($_.Exception.Message -like '*No events were found*') { $evts = @() } else { throw }")
  lines.push('}')

  const q = opts.search ? sanitizeSearch(opts.search) : ''
  if (q) {
    lines.push(
      `if ($evts) { $evts = $evts | Where-Object { ($_.Message -like "*${q}*") -or ($_.ProviderName -like "*${q}*") -or ("$($_.Id)" -like "*${q}*") } }`,
    )
  }

  lines.push('$arr = @($evts | ForEach-Object {')
  lines.push('  $msg = if ($_.Message) { $_.Message } else { "" }')
  lines.push("  $msg = ($msg -replace '\\s+', ' ').Trim()")
  lines.push('  if ($msg.Length -gt 600) { $msg = $msg.Substring(0,600) + [char]8230 }')
  lines.push('  [PSCustomObject]@{')
  lines.push('    recordId = [int]($_.RecordId)')
  lines.push("    timeCreated = $_.TimeCreated.ToString('o')")
  lines.push('    level = [int]($_.Level)')
  lines.push('    provider = $_.ProviderName')
  lines.push('    id = [int]($_.Id)')
  lines.push('    task = if ($_.TaskDisplayName) { $_.TaskDisplayName } else { "" }')
  lines.push('    message = $msg')
  lines.push('  }')
  lines.push('})')
  lines.push('$out = [PSCustomObject]@{ items = $arr }')
  lines.push('$out | ConvertTo-Json -Compress -Depth 4')

  const script = lines.join('\n')
  try {
    const stdout = await runPowerShell(script)
    if (!stdout) return { events: [] }
    const parsed = JSON.parse(stdout) as { items?: SystemEvent[] }
    return { events: Array.isArray(parsed.items) ? parsed.items : [] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/No events were found/i.test(msg)) return { events: [] }
    return { events: [], error: msg }
  }
}

export async function getEventXml(
  logName: string,
  recordId: number,
): Promise<{ xml?: string; error?: string }> {
  const safeLog = sanitizeLogName(logName)
  if (!safeLog) return { error: 'invalid-log-name' }
  const rid = Math.trunc(Number(recordId))
  if (!Number.isFinite(rid) || rid <= 0) return { error: 'invalid-record-id' }

  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$filterXPath = "*[System[EventRecordID=${rid}]]"`,
    `$ev = Get-WinEvent -LogName '${safeLog}' -FilterXPath $filterXPath -MaxEvents 1 -ErrorAction Stop`,
    '$ev.ToXml()',
  ].join('\n')

  try {
    const stdout = await runPowerShell(script, 15_000)
    if (!stdout) return { error: 'empty-xml' }
    return { xml: stdout }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: msg }
  }
}
