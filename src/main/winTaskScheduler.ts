// Windows 任务计划程序管理（任务注册表管理）
// 通过系统 schtasks.exe 列出 / 运行 / 启用 / 禁用 / 删除 / 创建计划任务。
// 所有写操作需要足够权限；普通用户可管理自己的任务，系统任务可能需以管理员运行。
import { execFile } from 'node:child_process'

export interface WinTask {
  name: string // 完整任务名，含前导反斜杠，如 \Microsoft\Windows\Defrag\ScheduledDefrag
  folder: string // 所在文件夹，如 \Microsoft\Windows\Defrag
  taskName: string // 任务名（不含路径），如 ScheduledDefrag
  nextRun: string
  status: string // Ready | Disabled | Running | 未知
  lastRun: string
  lastResult: string // 0 表示成功，其他为错误码
  author: string
  command: string // Task To Run
  enabled: boolean
}

export interface WinTaskCreateOptions {
  name: string // 完整任务名（可含文件夹路径），如 \MyTasks\Backup
  command: string // 要运行的程序 / 命令
  scheduleType: 'MINUTE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'ONLOGON' | 'ONSTART' | 'ONCE'
  modifier?: string // 间隔（如每 N 分钟 / 天）
  startTime?: string // HH:mm
  day?: string // WEEKLY 时指定星期（MON,TUE...）
  force?: boolean // 覆盖已存在任务
}

function runExe(args: string[], timeoutMs = 30000): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile('schtasks', args, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 8, timeout: timeoutMs }, (err, stdout, stderr) => {
      // schtasks 在非 0 退出或仅 stderr 时视为失败；但部分信息在 stdout
      if (err && !stdout) {
        reject(new Error((stderr || err.message).trim() || 'schtasks failed'))
        return
      }
      const code = (err as { code?: number } | null)?.code ?? 0
      resolve({ stdout: stdout || '', code })
    })
  })
}

// 解析 schtasks /Query /V /FO CSV 的输出。首行为表头，后续为数据行。
function parseCsvTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = (text || '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const parseLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inq = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inq && line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inq = !inq
        }
      } else if (c === ',' && !inq) {
        out.push(cur)
        cur = ''
      } else {
        cur += c
      }
    }
    out.push(cur)
    return out
  }
  const headers = parseLine(lines[0]).map((h) => h.trim())
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

export async function listWinTasks(): Promise<WinTask[]> {
  const { stdout } = await runExe(['/Query', '/V', '/FO', 'CSV'])
  const { headers, rows } = parseCsvTable(stdout)
  const idx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  const iTask = idx('TaskName')
  const iNext = idx('Next Run Time')
  const iStatus = idx('Status')
  const iLast = idx('Last Run Time')
  const iResult = idx('Last Result')
  const iAuthor = idx('Author')
  const iRun = idx('Task To Run')
  const result: WinTask[] = []
  for (const r of rows) {
    const name = (r[iTask] ?? '').trim()
    if (!name) continue
    const status = (r[iStatus] ?? '').trim()
    const folder = name.includes('\\') ? name.slice(0, name.lastIndexOf('\\')) : ''
    const taskName = name.includes('\\') ? name.slice(name.lastIndexOf('\\') + 1) : name
    result.push({
      name,
      folder,
      taskName,
      nextRun: (r[iNext] ?? '').trim(),
      status,
      lastRun: (r[iLast] ?? '').trim(),
      lastResult: (r[iResult] ?? '').trim(),
      author: (r[iAuthor] ?? '').trim(),
      command: (r[iRun] ?? '').trim(),
      enabled: !/disabled/i.test(status),
    })
  }
  // 按路径排序，文件夹优先
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

export interface SimpleResult {
  ok: boolean
  message: string
}

export async function runWinTask(name: string): Promise<SimpleResult> {
  try {
    const { stdout } = await runExe(['/Run', '/TN', name])
    return { ok: true, message: (stdout || '已请求运行').trim() }
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}

export async function setWinTaskEnabled(name: string, enabled: boolean): Promise<SimpleResult> {
  try {
    const { stdout } = await runExe(['/Change', '/TN', name, enabled ? '/ENABLE' : '/DISABLE'])
    return { ok: true, message: (stdout || (enabled ? '已启用' : '已禁用')).trim() }
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}

export async function deleteWinTask(name: string): Promise<SimpleResult> {
  try {
    await runExe(['/Delete', '/TN', name, '/F'])
    return { ok: true, message: '已删除' }
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}

export async function createWinTask(opts: WinTaskCreateOptions): Promise<SimpleResult> {
  const args = ['/Create', '/TN', opts.name, '/TR', opts.command]
  if (opts.force) args.push('/F')
  switch (opts.scheduleType) {
    case 'MINUTE':
      args.push('/SC', 'MINUTE', '/MO', opts.modifier || '30')
      break
    case 'HOURLY':
      args.push('/SC', 'HOURLY', '/MO', opts.modifier || '1')
      break
    case 'DAILY':
      args.push('/SC', 'DAILY', '/MO', opts.modifier || '1')
      break
    case 'WEEKLY':
      args.push('/SC', 'WEEKLY')
      if (opts.day) args.push('/D', opts.day)
      if (opts.modifier) args.push('/MO', opts.modifier)
      break
    case 'ONLOGON':
      args.push('/SC', 'ONLOGON')
      break
    case 'ONSTART':
      args.push('/SC', 'ONSTART')
      break
    case 'ONCE':
      args.push('/SC', 'ONCE')
      break
  }
  if (opts.startTime) args.push('/ST', opts.startTime)
  // 默认以当前用户身份运行（不指定 /RU 即当前用户），并忽略密码提示
  args.push('/RL', 'HIGHEST')
  try {
    const { stdout } = await runExe(args, 40000)
    return { ok: true, message: (stdout || '已创建任务').trim() }
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) }
  }
}
