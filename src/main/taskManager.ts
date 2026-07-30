// 系统任务管理器主进程模块：列出运行中的进程（含双采样计算的实时 CPU 占用率
// 与内存占用），结束进程，以及本地启发式"AI 分析"（资源占用、未知发布者、
// 多实例、无响应等）。AI 分析遵循本项目约定：Ollama 不可用时的本地启发式兜底。
import { execFile } from 'node:child_process'

export interface ProcessInfo {
  id: number
  name: string
  cpu: number // 实时 CPU 占用率（双采样 delta / 逻辑核数）
  cpuTime: number // 累计 CPU 时间（秒）
  memory: number // WorkingSet，bytes
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
  source: 'heuristic'
  generatedAt: number
}

function runPowerShell(script: string, timeoutMs = 20000): Promise<string> {
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

const LIST_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
$first = @{};
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) { $first[$p.Id] = $p.CPU };
Start-Sleep -Milliseconds 1000;
$cores = 0;
foreach ($c in (Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue)) { $cores += [int]$c.NumberOfLogicalProcessors };
if ($cores -eq 0) { $cores = 1 };
$result = @();
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  if ($p.Name -eq 'Idle') { continue };
  $prev = $first[$p.Id];
  $delta = if ($null -ne $prev) { [math]::Max(0, $p.CPU - $prev) } else { 0 };
  $cpuPct = [math]::Min(100, ($delta / 1.0) * 100 / $cores);
  $result += [PSCustomObject]@{
    id = [int]$p.Id;
    name = $p.Name;
    cpu = [math]::Round($cpuPct, 1);
    cpuTime = [math]::Round([double]$p.CPU, 1);
    memory = [int64]$p.WorkingSet;
    company = $p.Company;
    description = $p.Description;
    title = $p.MainWindowTitle;
    responding = [bool]$p.Responding;
    session = [int]$p.SessionId;
    path = $p.Path;
    handles = [int]$p.HandleCount;
    threads = [int]$p.Threads.Count;
    startTime = if ($p.StartTime) { $p.StartTime.ToString('o') } else { $null }
  };
};
$result | ConvertTo-Json -Compress;
`

const KILL_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Stop-Process -Id {PID} -Force -ErrorAction Stop;
"OK"
`

// ── 进程列表缓存：避免 TaskManager 页每次刷新都在主进程 fork 一个
// 含 Start-Sleep 1s 的 PowerShell（为双采样算 CPU 占用率）。改为后台低频
// 刷新 + 读缓存，list-processes 瞬时返回；页面关闭 15s 后自动停刷，
// 不再无谓占用后台。
let procCache: ProcessInfo[] = []
let procCacheReady = false
let procRefreshTimer: NodeJS.Timeout | null = null
let lastListCall = 0
const PROC_REFRESH_MS = 5000
const PROC_IDLE_STOP_MS = 15000

function parseRow(r: any): ProcessInfo {
  return {
    id: Number(r.id) || 0,
    name: String(r.name || 'unknown'),
    cpu: typeof r.cpu === 'number' ? r.cpu : 0,
    cpuTime: typeof r.cpuTime === 'number' ? r.cpuTime : 0,
    memory: typeof r.memory === 'number' ? r.memory : 0,
    company: String(r.company || ''),
    description: String(r.description || ''),
    title: String(r.title || ''),
    responding: r.responding !== false,
    session: Number(r.session) || 0,
    path: String(r.path || ''),
    handles: Number(r.handles) || 0,
    threads: Number(r.threads) || 0,
    startTime: r.startTime || null,
  }
}

async function refreshProcs(): Promise<void> {
  try {
    const raw = await runPowerShell(LIST_SCRIPT)
    const rows = parseJsonArray<any>(raw)
    procCache = rows.map(parseRow).filter((p) => p.id > 0)
    procCacheReady = true
  } catch {
    /* 刷新失败保留上次缓存，不覆盖 */
  }
}

function startProcRefresh(): void {
  lastListCall = Date.now()
  if (procRefreshTimer) return
  void refreshProcs()
  procRefreshTimer = setInterval(() => {
    if (Date.now() - lastListCall > PROC_IDLE_STOP_MS) {
      if (procRefreshTimer) {
        clearInterval(procRefreshTimer)
        procRefreshTimer = null
      }
      procCacheReady = false
      return
    }
    void refreshProcs()
  }, PROC_REFRESH_MS)
  ;(procRefreshTimer as any).unref?.()
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  if (!procCacheReady) {
    await refreshProcs()
  }
  startProcRefresh()
  return procCache
}

export async function killProcess(pid: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await runPowerShell(KILL_SCRIPT.replace('{PID}', String(pid)), 15000)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ───────────────────── 本地启发式 AI 分析 ─────────────────────

const KNOWN_SYSTEM_NAMES = new Set([
  'System', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'svchost', 'dwm',
  'explorer', 'fontdrvhost', 'audiodg', 'conhost', 'registry', 'spoolsv',
  'SearchIndexer', 'MsMpEng', 'NisSrv', 'SecurityHealthService', 'RuntimeBroker',
  'ShellExperienceHost', 'SearchUI', 'ctfmon', 'WmiPrvSE', 'dllhost', 'taskhostw',
  'sihost', 'chassis', 'PhoneExperienceHost', 'aggregatorhost', 'unsecapp',
])

export function analyzeProcesses(
  procs: ProcessInfo[],
  memTotal: number,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): ProcessAnalysisResult {
  const zh = locale === 'zh-CN'
  const anomalies: ProcessAnalysisAnomaly[] = []
  const suggestions: ProcessAnalysisSuggestion[] = []

  const total = procs.length
  const memSum = procs.reduce((s, p) => s + p.memory, 0)
  const sortedMem = [...procs].sort((a, b) => b.memory - a.memory)
  const sortedCpu = [...procs].sort((a, b) => b.cpu - a.cpu)
  const topMem = sortedMem.slice(0, 5)
  const topCpu = sortedCpu.slice(0, 5)

  const gb = (b: number) => `${(b / 1073741824).toFixed(2)} GB`
  const memPctTotal = memTotal > 0 ? (memSum / memTotal) * 100 : 0

  // 整体研判
  let overall = ''
  if (memPctTotal > 85 || sortedCpu[0]?.cpu > 70) {
    overall = zh
      ? `当前共 ${total} 个进程，系统资源占用偏高，建议排查高占用项。`
      : `There are ${total} processes running and system resource usage is high; review the top consumers.`
  } else if (memPctTotal > 60 || sortedCpu[0]?.cpu > 30) {
    overall = zh
      ? `当前共 ${total} 个进程，资源占用处于中等水平，运行平稳。`
      : `There are ${total} processes running; resource usage is moderate and stable.`
  } else {
    overall = zh
      ? `当前共 ${total} 个进程，系统资源占用健康，无明显压力。`
      : `There are ${total} processes running; resource usage is healthy with no obvious pressure.`
  }

  const summary = zh
    ? `${overall} 内存占用最高：${topMem[0]?.name || '—'}（${gb(topMem[0]?.memory || 0)}）；CPU 占用最高：${topCpu[0]?.name || '—'}（${topCpu[0]?.cpu || 0}%）。`
    : `${overall} Top memory: ${topMem[0]?.name || '—'} (${gb(topMem[0]?.memory || 0)}); top CPU: ${topCpu[0]?.name || '—'} (${topCpu[0]?.cpu || 0}%).`

  // 异常 1：高内存进程（单个 > 1GB 或占总内存 > 15%）
  const heavyMem = sortedMem.filter((p) => p.memory > 1073741824 || (memTotal > 0 && p.memory / memTotal > 0.15))
  if (heavyMem.length) {
    anomalies.push({
      title: zh ? `高内存占用进程 (${heavyMem.length})` : `High memory processes (${heavyMem.length})`,
      description: heavyMem
        .slice(0, 3)
        .map((p) => `${p.name} · ${gb(p.memory)}`)
        .join('，'),
      severity: 'medium',
    })
    suggestions.push({
      title: zh ? '释放内存' : 'Free memory',
      description: zh
        ? `可结束非必要的重量级进程（如浏览器、IDE）以释放约 ${gb(heavyMem.reduce((s, p) => s + p.memory, 0))} 内存。`
        : `Closing non-essential heavy processes (browsers, IDEs) can free ~${gb(heavyMem.reduce((s, p) => s + p.memory, 0))}.`,
      action: zh ? '结束高内存进程' : 'End high-memory processes',
    })
  }

  // 异常 2：高 CPU 进程
  const heavyCpu = sortedCpu.filter((p) => p.cpu > 25)
  if (heavyCpu.length) {
    anomalies.push({
      title: zh ? `高 CPU 占用进程 (${heavyCpu.length})` : `High CPU processes (${heavyCpu.length})`,
      description: heavyCpu
        .slice(0, 3)
        .map((p) => `${p.name} · ${p.cpu}%`)
        .join('，'),
      severity: 'high',
    })
    if (!KNOWN_SYSTEM_NAMES.has(heavyCpu[0]?.name || '')) {
      suggestions.push({
        title: zh ? '排查异常高 CPU 程序' : 'Investigate abnormal CPU usage',
        description: zh
          ? `${heavyCpu[0].name} 持续占用大量 CPU，若非预期任务，建议结束或检查其来源。`
          : `${heavyCpu[0].name} is consuming significant CPU; end it or check its origin if unexpected.`,
        action: zh ? '结束该进程' : 'End this process',
      })
    }
  }

  // 异常 3：无响应进程
  const notResponding = procs.filter((p) => !p.responding && !KNOWN_SYSTEM_NAMES.has(p.name))
  if (notResponding.length) {
    anomalies.push({
      title: zh ? `无响应进程 (${notResponding.length})` : `Not responding (${notResponding.length})`,
      description: notResponding
        .slice(0, 3)
        .map((p) => p.name)
        .join('，'),
      severity: 'medium',
    })
    suggestions.push({
      title: zh ? '重启卡死程序' : 'Restart hung apps',
      description: zh
        ? '无响应的程序可能卡住，结束后可重新打开。'
        : 'Hung processes may be stuck; ending them lets you reopen cleanly.',
      action: zh ? '结束无响应进程' : 'End unresponsive processes',
    })
  }

  // 异常 4：未知发布者的后台进程（潜在可疑）
  const unknownPublisher = procs.filter(
    (p) => !p.company && !KNOWN_SYSTEM_NAMES.has(p.name) && (p.memory > 50 * 1048576 || p.cpu > 1),
  )
  if (unknownPublisher.length) {
    anomalies.push({
      title: zh ? `未知发布者进程 (${unknownPublisher.length})` : `Unknown publisher (${unknownPublisher.length})`,
      description: unknownPublisher
        .slice(0, 3)
        .map((p) => p.name)
        .join('，'),
      severity: 'low',
    })
    suggestions.push({
      title: zh ? '核实未知程序' : 'Verify unknown programs',
      description: zh
        ? '部分后台进程缺少发布者信息，建议核对其路径与用途，警惕可疑软件。'
        : 'Some background processes lack publisher info; verify their path and purpose for suspicious software.',
      action: zh ? '查看进程路径' : 'Inspect process path',
    })
  }

  // 异常 5：同一程序多实例（可能冗余/异常）
  const byName = new Map<string, number>()
  for (const p of procs) byName.set(p.name, (byName.get(p.name) || 0) + 1)
  const multiInstance = [...byName.entries()].filter(([, c]) => c >= 12).sort((a, b) => b[1] - a[1])
  if (multiInstance.length) {
    anomalies.push({
      title: zh ? `多实例进程 (${multiInstance.length})` : `Many instances (${multiInstance.length})`,
      description: multiInstance
        .slice(0, 3)
        .map(([n, c]) => `${n} × ${c}`)
        .join('，'),
      severity: 'low',
    })
  }

  if (anomalies.length === 0) {
    anomalies.push({
      title: zh ? '未检测到明显异常' : 'No obvious anomalies',
      description: zh ? '当前进程列表运行正常。' : 'The current process list looks normal.',
      severity: 'low',
    })
  }

  return {
    summary,
    anomalies,
    suggestions,
    source: 'heuristic',
    generatedAt: Date.now(),
  }
}
