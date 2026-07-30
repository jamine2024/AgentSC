import { db, logToDb } from './db'
import {
  getRangeStats,
  getDailyReportInRange,
  getTopCreatedPathsInRange,
  getTopDeletedPathsInRange,
  getTopProcessesInRange,
} from './db'

export interface AiProviderConfig {
  provider: 'ollama' | 'openai'
  endpoint: string
  model: string
  apiKey?: string
}

export interface Anomaly {
  title: string
  description: string
  severity: 'low' | 'medium' | 'high'
}

export interface Suggestion {
  title: string
  description: string
  action: string
}

export interface AiInsightsResult {
  generatedAt: number
  source: 'ollama' | 'openai' | 'heuristic'
  model?: string
  summary: string
  anomalies: Anomaly[]
  suggestions: Suggestion[]
  error?: string
}

interface InsightInput {
  startDay: string
  endDay: string
  stats: {
    created_count: number
    deleted_count: number
    modified_count: number
    renamed_count: number
    created_bytes: number
    deleted_bytes: number
  }
  daily: { day: string; created_count: number; deleted_count: number; modified_count: number; renamed_count: number; created_bytes: number; deleted_bytes: number }[]
  topCreated: { path: string; total_size: number; count: number }[]
  topDeleted: { path: string; total_size: number; count: number }[]
  topProcesses: { process_name: string; event_count: number }[]
}

const DEFAULT_CONFIG: AiProviderConfig = {
  provider: 'ollama',
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5',
}

function toDayString(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getRange(days: number) {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days + 1)
  return { startDay: toDayString(start), endDay: toDayString(end) }
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function getSetting<T>(key: string, fallback: T): T {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return fallback
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

function setSetting(key: string, value: unknown) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  stmt.run(key, JSON.stringify(value))
}

// 持久化最近一次洞察结果，避免每次进入页面都是空的（跨会话/重启保留）
const AI_INSIGHTS_LAST_KEY = 'ai_insights_last'

export function getLastInsights(): AiInsightsResult | null {
  return getSetting<AiInsightsResult | null>(AI_INSIGHTS_LAST_KEY, null)
}

export function setLastInsights(result: AiInsightsResult) {
  setSetting(AI_INSIGHTS_LAST_KEY, result)
}

// 首次启动时若没有任何历史洞察，先用启发式快速生成一条，保证页面不空白
export function ensureInitialAiInsights() {
  const last = getLastInsights()
  if (!last) {
    const input = collectInsightInput(7)
    setLastInsights(buildHeuristicInsights(input))
  }
}

export function getAiConfig(): AiProviderConfig {
  return getSetting<AiProviderConfig>('ai_config', DEFAULT_CONFIG)
}

export function setAiConfig(config: Partial<AiProviderConfig>) {
  const next = { ...getAiConfig(), ...config }
  setSetting('ai_config', next)
  return next
}

function buildPrompt(input: InsightInput): string {
  const topCreatedText = input.topCreated.length
    ? input.topCreated.map((p, i) => `${i + 1}. ${p.path} (${formatBytes(p.total_size)}, ${p.count} 次)`).join('\n')
    : '无'
  const topDeletedText = input.topDeleted.length
    ? input.topDeleted.map((p, i) => `${i + 1}. ${p.path} (${formatBytes(p.total_size)}, ${p.count} 次)`).join('\n')
    : '无'
  const topProcessText = input.topProcesses.length
    ? input.topProcesses.map((p, i) => `${i + 1}. ${p.process_name} (${p.event_count} 次)`).join('\n')
    : '无'
  const dailyText = input.daily
    .map((d) => `${d.day}: 新增 ${d.created_count} / 删除 ${d.deleted_count} / 修改 ${d.modified_count} / 重命名 ${d.renamed_count}`)
    .join('\n')

  return `你是一名磁盘空间治理与文件变更分析专家。请根据以下监控数据，用中文生成一份简短、可操作的洞察报告。

统计区间：${input.startDay} ~ ${input.endDay}
总体数据：
- 新增文件 ${input.stats.created_count} 个，共 ${formatBytes(input.stats.created_bytes)}
- 删除文件 ${input.stats.deleted_count} 个，共 ${formatBytes(input.stats.deleted_bytes)}
- 修改 ${input.stats.modified_count} 次，重命名 ${input.stats.renamed_count} 次

每日趋势：
${dailyText}

Top 新增路径（按大小）：
${topCreatedText}

Top 删除路径（按大小）：
${topDeletedText}

Top 活跃进程：
${topProcessText}

请严格按以下 JSON 格式输出，不要附加任何解释或 Markdown 代码块：
{
  "summary": "总体判断，80-120字",
  "anomalies": [
    {"title": "异常标题", "description": "异常说明", "severity": "low|medium|high"}
  ],
  "suggestions": [
    {"title": "建议标题", "description": "建议说明", "action": "可执行动作"}
  ]
}`
}

async function callWithTimeout(url: string, options: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function callOllama(config: AiProviderConfig, prompt: string): Promise<AiInsightsResult> {
  const url = `${config.endpoint.replace(/\/$/, '')}/api/generate`
  const response = await callWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      prompt,
      stream: false,
      options: { temperature: 0.3, num_predict: 1200 },
    }),
  })
  if (!response.ok) {
    throw new Error(`Ollama 请求失败: ${response.status} ${response.statusText}`)
  }
  const data = (await response.json()) as { response?: string; done?: boolean }
  const text = data.response || ''
  return parseInsightResponse(text, 'ollama', config.model)
}

async function callOpenAi(config: AiProviderConfig, prompt: string): Promise<AiInsightsResult> {
  const url = `${config.endpoint.replace(/\/$/, '')}/chat/completions`
  const response = await callWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey || ''}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  })
  if (!response.ok) {
    throw new Error(`OpenAI 请求失败: ${response.status} ${response.statusText}`)
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content || ''
  return parseInsightResponse(text, 'openai', config.model)
}

function parseInsightResponse(text: string, source: 'ollama' | 'openai', model?: string): AiInsightsResult {
  const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim()
  let jsonText = cleaned
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonText = cleaned.slice(firstBrace, lastBrace + 1)
  }
  try {
    const parsed = JSON.parse(jsonText) as { summary?: string; anomalies?: unknown[]; suggestions?: unknown[] }
    return {
      generatedAt: Date.now(),
      source,
      model,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '模型未返回总结。',
      anomalies: normalizeAnomalies(parsed.anomalies),
      suggestions: normalizeSuggestions(parsed.suggestions),
    }
  } catch (err) {
    throw new Error(`无法解析模型输出: ${(err as Error).message}`)
  }
}

function normalizeAnomalies(list: unknown[] | undefined): Anomaly[] {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => {
      const a = item as Record<string, unknown>
      const severity = ['low', 'medium', 'high'].includes(String(a?.severity)) ? (String(a?.severity) as Anomaly['severity']) : 'low'
      return {
        title: String(a?.title || '未命名异常'),
        description: String(a?.description || ''),
        severity,
      }
    })
    .filter((a) => a.title && a.description)
}

function normalizeSuggestions(list: unknown[] | undefined): Suggestion[] {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => {
      const s = item as Record<string, unknown>
      return {
        title: String(s?.title || '未命名建议'),
        description: String(s?.description || ''),
        action: String(s?.action || ''),
      }
    })
    .filter((s) => s.title && s.description)
}

export function collectInsightInput(days = 7): InsightInput {
  const { startDay, endDay } = getRange(days)
  const stats = getRangeStats(startDay, endDay)
  const daily = getDailyReportInRange(startDay, endDay)
  const topCreated = getTopCreatedPathsInRange(startDay, endDay, 8)
  const topDeleted = getTopDeletedPathsInRange(startDay, endDay, 8)
  const topProcesses = getTopProcessesInRange(startDay, endDay, 8)
  return { startDay, endDay, stats, daily, topCreated, topDeleted, topProcesses }
}

export function buildHeuristicInsights(input: InsightInput): AiInsightsResult {
  const { stats } = input
  const anomalies: Anomaly[] = []
  const suggestions: Suggestion[] = []

  if (stats.created_count === 0 && stats.deleted_count === 0) {
    anomalies.push({
      title: '监控数据不足',
      description: '最近 7 天未记录到文件变更事件，请确认监控已启用且选择了正确的磁盘或目录。',
      severity: 'low',
    })
    suggestions.push({
      title: '检查监控配置',
      description: '前往「追踪路径」页面，选择需要监控的磁盘并启用监控。',
      action: '打开追踪路径',
    })
  }

  if (stats.created_count > 0 && stats.deleted_count === 0) {
    anomalies.push({
      title: '只增不减',
      description: `新增 ${stats.created_count} 个文件，但没有任何删除记录，磁盘占用将持续增长。`,
      severity: 'medium',
    })
    suggestions.push({
      title: 'Review 新增内容',
      description: '查看 Top 新增路径，确认是否有重复下载、缓存堆积或日志膨胀。',
      action: '查看占用分析',
    })
  }

  if (stats.created_bytes > stats.deleted_bytes * 3 && stats.deleted_bytes > 0) {
    anomalies.push({
      title: '新增远大于删除',
      description: `新增 ${formatBytes(stats.created_bytes)}，删除仅 ${formatBytes(stats.deleted_bytes)}，净增长明显。`,
      severity: 'high',
    })
  }

  if (input.topCreated.length > 0 && input.topCreated[0].total_size > stats.created_bytes * 0.5) {
    const top = input.topCreated[0]
    anomalies.push({
      title: '单一路径占新增大头',
      description: `${top.path} 占新增总量 ${formatBytes(top.total_size)}，可能为缓存或打包目录。`,
      severity: 'medium',
    })
    suggestions.push({
      title: '清理该路径',
      description: '如果该目录为临时或缓存目录，可添加清理规则或手动删除。',
      action: '创建清理规则',
    })
  }

  if (input.topProcesses.length > 0) {
    const top = input.topProcesses[0]
    suggestions.push({
      title: `关注活跃进程 ${top.process_name}`,
      description: `该进程在最近 7 天触发了 ${top.event_count} 次文件变更，可进一步分析其产生的大文件。`,
      action: '查看追踪事件',
    })
  }

  suggestions.push({
    title: '定期生成报告',
    description: '建议每周生成周报，跟踪磁盘占用趋势和异常进程。',
    action: '前往汇报中心',
  })

  let summary = `最近 7 天共新增 ${stats.created_count} 个文件（${formatBytes(stats.created_bytes)}），删除 ${stats.deleted_count} 个（${formatBytes(stats.deleted_bytes)}）。`
  if (stats.created_bytes > stats.deleted_bytes) {
    summary += ' 磁盘净增长为正，建议关注大文件来源。'
  } else if (stats.deleted_bytes > stats.created_bytes) {
    summary += ' 删除量大于新增量，磁盘占用有所下降。'
  } else {
    summary += ' 新增与删除相对平衡。'
  }

  return {
    generatedAt: Date.now(),
    source: 'heuristic',
    summary,
    anomalies,
    suggestions,
  }
}

// Short-lived in-memory cache so repeated dashboard/AI calls don't re-hit the
// LLM unnecessarily. Bypassed when `force` is true.
interface CachedInsights {
  result: AiInsightsResult
  at: number
}
let cachedInsights: CachedInsights | null = null
const AI_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function generateAiInsights(force = false, background = false): Promise<AiInsightsResult> {
  const now = Date.now()
  if (!force && cachedInsights && now - cachedInsights.at < AI_CACHE_TTL) {
    return cachedInsights.result
  }

  const config = getAiConfig()
  const input = collectInsightInput(7)

  let result: AiInsightsResult

  // Return fast heuristic when no provider is usable
  if (config.provider === 'ollama' && !config.endpoint) {
    result = buildHeuristicInsights(input)
  } else {
    try {
      const prompt = buildPrompt(input)
      if (config.provider === 'openai') {
        result = await callOpenAi(config, prompt)
      } else {
        result = await callOllama(config, prompt)
      }
    } catch (err) {
      // 后台定时任务降级为 info 级别，避免无 LLM 时刷屏错误日志
      logToDb(background ? 'info' : 'error', 'aiInsights', 'LLM 调用失败，降级到启发式分析', String(err))
      const heuristic = buildHeuristicInsights(input)
      heuristic.error = (err as Error).message
      result = heuristic
    }
  }

  cachedInsights = { result, at: now }
  // 持久化，使页面重新进入时仍能展示最近一次结果（含生成时间）
  setLastInsights(result)
  return result
}
