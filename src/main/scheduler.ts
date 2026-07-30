import schedule from 'node-schedule'
import { BrowserWindow } from 'electron'
import { exec } from 'node:child_process'
import {
  ScheduledTaskRow,
  NewScheduledTask,
  getScheduledTasks,
  getScheduledTaskById,
  addScheduledTask as dbAdd,
  updateScheduledTask as dbUpdate,
  deleteScheduledTask as dbDelete,
  logToDb,
  type CleanerRule,
} from './db'
import { executeCleanerTask } from './cleaner'
import { generateAiInsights } from './aiInsights'
import { scanAiCleanup, runAiCleanup } from './aiCleanup'

type Task = ScheduledTaskRow

interface RunResult {
  success: boolean
  message: string
  freedBytes?: number
}

// ---------------------------------------------------------------------------
// 与渲染进程的通讯：持有 mainWindow 引用以便广播刷新与失败通知
// ---------------------------------------------------------------------------
let mainWindowRef: BrowserWindow | null = null
export function setSchedulerMainWindow(win: BrowserWindow | null) {
  mainWindowRef = win
}

function broadcastUpdate() {
  const wc = mainWindowRef?.webContents
  if (wc && !wc.isDestroyed()) {
    wc.send('scheduler:updated')
  }
}

function notify(title: string, body: string) {
  const wc = mainWindowRef?.webContents || null
  if (wc && !wc.isDestroyed()) {
    wc.send('toast-notification', { title, body, timestamp: Date.now() })
  }
}

// ---------------------------------------------------------------------------
// 调度配置解析与 spec 构建
// ---------------------------------------------------------------------------
function parseJson(raw: string | null | undefined, fallback: any = {}): any {
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

type ScheduleSpec = any

function buildScheduleSpec(type: Task['schedule_type'], value: any): ScheduleSpec {
  switch (type) {
    case 'interval': {
      const v = Math.max(1, Number(value?.value) || 1)
      const unit = value?.unit || 'hour'
      if (unit === 'minute') return `*/${v} * * * *`
      if (unit === 'day') return `0 0 */${v} * *`
      return `0 */${v} * * *` // hour
    }
    case 'daily':
      return { hour: Number(value?.hour) || 0, minute: Number(value?.minute) || 0 }
    case 'weekly':
      return {
        dayOfWeek: Number(value?.dayOfWeek) ?? 0,
        hour: Number(value?.hour) || 0,
        minute: Number(value?.minute) || 0,
      }
    case 'cron':
      return String(value?.expr || value || '')
    case 'once': {
      const t = Number(value?.time ?? value)
      if (!t || isNaN(t)) return null
      return new Date(t)
    }
    default:
      return null
  }
}

function computeNextRun(type: Task['schedule_type'], value: any): number | null {
  const spec = buildScheduleSpec(type, value)
  if (!spec) return null
  try {
    const temp = schedule.scheduleJob(spec, () => {})
    const next = temp.nextInvocation()
    temp.cancel()
    return next ? next.getTime() : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 任务注册 / 取消
// ---------------------------------------------------------------------------
const jobs = new Map<number, schedule.Job>()

function registerTask(task: Task) {
  if (!task.enabled) return
  const value = parseJson(task.schedule_value, {})
  if (task.schedule_type === 'once') {
    const t = Number(value?.time ?? value)
    if (!t || t <= Date.now()) return // 已过期，不调度
  }
  const spec = buildScheduleSpec(task.schedule_type, value)
  if (!spec) return
  try {
    const job = schedule.scheduleJob(spec, () => {
      void runTask(task.id)
    })
    if (job) {
      jobs.set(task.id, job)
      const next = job.nextInvocation()
      dbUpdate(task.id, { next_run: next ? next.getTime() : null })
    }
  } catch (err) {
    logToDb('error', 'scheduler', `调度注册失败: ${task.name}`, String(err))
  }
}

export function cancelScheduledTask(id: number) {
  jobs.get(id)?.cancel()
  jobs.delete(id)
}

function reregisterTask(id: number) {
  const task = getScheduledTaskById(id)
  if (!task) return
  cancelScheduledTask(id)
  registerTask(task)
}

export function reloadAllScheduledTasks() {
  for (const [, job] of jobs) job.cancel()
  jobs.clear()
  for (const task of getScheduledTasks()) registerTask(task)
}

// ---------------------------------------------------------------------------
// 动作执行
// ---------------------------------------------------------------------------
async function executeAction(task: Task): Promise<RunResult> {
  const params = parseJson(task.params, {})
  switch (task.action) {
    case 'cleanup':
      return runCleanup(params)
    case 'ai_insights':
      return runAiInsights()
    case 'ai_cleanup':
      return runAiCleanupAuto(params)
    case 'shell':
      return runShell(params)
    default:
      return { success: false, message: '未知动作: ' + task.action }
  }
}

async function runCleanup(params: any): Promise<RunResult> {
  const type: string = params?.type || 'all'
  if (type === 'all') {
    const types: CleanerRule['type'][] = ['recycle_bin', 'ie_history', 'temp_dir', 'browser_cache']
    let freed = 0
    let ok = true
    const msgs: string[] = []
    for (const tp of types) {
      const r = await executeCleanerTask(tp)
      if (r.success) freed += r.freedBytes
      else ok = false
      msgs.push(r.message)
    }
    return { success: ok, message: msgs.join('；'), freedBytes: freed }
  }
  if (type === 'custom') {
    if (!params?.target) return { success: false, message: '未指定自定义目录' }
    return executeCleanerTask('custom', params.target, params.patterns || undefined)
  }
  return executeCleanerTask(type as CleanerRule['type'])
}

async function runAiInsights(): Promise<RunResult> {
  try {
    const r = await generateAiInsights(true, true)
    const summary = (r && (r as any).summary) ? (r as any).summary : 'AI 洞察已生成'
    return { success: !!r, message: summary }
  } catch (e) {
    return { success: false, message: 'AI 洞察生成失败: ' + String(e) }
  }
}

async function runAiCleanupAuto(params: any): Promise<RunResult> {
  const target = params?.target || undefined
  const opts = {
    largeThresholdMb: Number(params?.largeThresholdMb) || 500,
    oldDays: Number(params?.oldDays) || 180,
    maxItems: 30,
  }
  const scan = await scanAiCleanup(target, opts)
  // 仅自动清理「系统垃圾」类且被推荐的项（安全，直接删除），不动大文件/旧文件
  const items = scan.items.filter((i) => i.action === 'system' && i.recommended)
  if (items.length === 0) {
    return { success: true, message: '无需清理（无推荐系统垃圾）', freedBytes: 0 }
  }
  const res = await runAiCleanup({ items })
  return { success: res.success, message: res.message, freedBytes: res.freedBytes }
}

function runShell(params: any): Promise<RunResult> {
  const command = params?.command
  const cwd = params?.cwd || undefined
  if (!command || !command.trim()) {
    return Promise.resolve({ success: false, message: '命令为空' })
  }
  // 安全：拒绝包含 shell 元字符的命令（& | ; < > $ ` 等），防止链式执行 / 重定向 / 注入。
  // scheduler 以管理员权限运行，任意 shell 命令可被 XSS/恶意调用升级为 RCE。
  if (/[&|;<>$`\r\n]/.test(command)) {
    return Promise.resolve({ success: false, message: '命令包含不允许的字符（禁止 & | ; < > $ ` 等）' })
  }
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            success: false,
            message: `命令失败: ${err.message}${stderr ? '｜' + stderr.slice(0, 200) : ''}`,
          })
        } else {
          const out = (stdout || '').trim()
          resolve({ success: true, message: out ? `输出: ${out.slice(0, 200)}` : '命令已执行' })
        }
      },
    )
  })
}

// ---------------------------------------------------------------------------
// 任务运行（被调度回调与「立即运行」共用）
// ---------------------------------------------------------------------------
async function runTask(id: number): Promise<RunResult> {
  const task = getScheduledTaskById(id)
  if (!task) return { success: false, message: 'task-not-found' }

  const startedAt = Date.now()
  let status: 'success' | 'failed' = 'success'
  let message = ''
  let freedBytes = 0

  try {
    const res = await executeAction(task)
    status = res.success ? 'success' : 'failed'
    message = res.message
    freedBytes = res.freedBytes || 0
  } catch (err) {
    status = 'failed'
    message = String(err && (err as any).message ? (err as any).message : err)
  }

  const value = parseJson(task.schedule_value, {})
  const next = task.schedule_type === 'once' ? null : computeNextRun(task.schedule_type, value)
  dbUpdate(task.id, {
    last_run: startedAt,
    last_status: status,
    next_run: next,
  })

  if (task.schedule_type === 'once') {
    cancelScheduledTask(task.id) // 一次性任务执行后从活跃调度移除
  }

  logToDb(
    status === 'success' ? 'info' : 'error',
    'scheduler',
    `定时任务「${task.name}」${status === 'success' ? '执行成功' : '执行失败'}`,
    message,
  )

  if (status === 'failed') {
    notify('定时任务失败', `${task.name}：${message}`)
  }

  broadcastUpdate()
  return { success: status === 'success', message, freedBytes }
}

export async function runScheduledTaskNow(id: number): Promise<RunResult | { error: string }> {
  const task = getScheduledTaskById(id)
  if (!task) return { error: 'not-found' }
  return runTask(task.id)
}

// ---------------------------------------------------------------------------
// IPC 支撑：创建 / 更新 / 删除 / 切换
// ---------------------------------------------------------------------------
export function createScheduledTask(task: NewScheduledTask): number {
  const id = dbAdd(task)
  const created = getScheduledTaskById(id)
  if (created) registerTask(created)
  return id
}

export function updateScheduledTaskById(id: number, patch: Partial<ScheduledTaskRow>) {
  dbUpdate(id, patch)
  reregisterTask(id)
}

export function deleteScheduledTaskById(id: number) {
  cancelScheduledTask(id)
  dbDelete(id)
}

export function toggleScheduledTask(id: number, enabled: boolean) {
  dbUpdate(id, { enabled: enabled ? 1 : 0 })
  reregisterTask(id)
}

// ---------------------------------------------------------------------------
// 快捷模板：一键添加常用定时任务
// ---------------------------------------------------------------------------
export interface SchedulerPreset {
  name: string
  i18nKey: string
  action: Task['action']
  schedule_type: Task['schedule_type']
  schedule_value: string
  params?: string
  enabled?: number
}

export const SCHEDULER_PRESETS: SchedulerPreset[] = [
  {
    name: '每天清理回收站 (03:00)',
    i18nKey: 'scheduler.preset.daily_recycle_bin',
    action: 'cleanup',
    schedule_type: 'daily',
    schedule_value: JSON.stringify({ hour: 3, minute: 0 }),
    params: JSON.stringify({ type: 'recycle_bin' }),
  },
  {
    name: '每天释放临时文件 (03:30)',
    i18nKey: 'scheduler.preset.daily_temp_dir',
    action: 'cleanup',
    schedule_type: 'daily',
    schedule_value: JSON.stringify({ hour: 3, minute: 30 }),
    params: JSON.stringify({ type: 'temp_dir' }),
  },
  {
    name: '每周深度清理 (周日 02:00)',
    i18nKey: 'scheduler.preset.weekly_all',
    action: 'cleanup',
    schedule_type: 'weekly',
    schedule_value: JSON.stringify({ dayOfWeek: 0, hour: 2, minute: 0 }),
    params: JSON.stringify({ type: 'all' }),
  },
  {
    name: '每天生成 AI 洞察 (09:00)',
    i18nKey: 'scheduler.preset.daily_ai_insights',
    action: 'ai_insights',
    schedule_type: 'daily',
    schedule_value: JSON.stringify({ hour: 9, minute: 0 }),
  },
  {
    name: '每周 AI 清理系统垃圾 (周日 04:00)',
    i18nKey: 'scheduler.preset.weekly_ai_cleanup',
    action: 'ai_cleanup',
    schedule_type: 'weekly',
    schedule_value: JSON.stringify({ dayOfWeek: 0, hour: 4, minute: 0 }),
    params: JSON.stringify({ largeThresholdMb: 500, oldDays: 180 }),
  },
  {
    name: '每小时清理浏览器缓存',
    i18nKey: 'scheduler.preset.hourly_browser_cache',
    action: 'cleanup',
    schedule_type: 'interval',
    schedule_value: JSON.stringify({ unit: 'hour', value: 1 }),
    params: JSON.stringify({ type: 'browser_cache' }),
  },
]
