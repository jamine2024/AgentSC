import { getAiConfig } from './aiInsights'
import { logToDb } from './db'

// 自然语言 -> 排除规则：AI 根据用户描述编写通配符排除规则，用户确认后落地到数据库。
// 排除规则的通配符语义与 db.ts 中 isPathExcluded 保持一致：* -> .* ，? -> . ，\ 为路径分隔符。

export interface AiExclusionRule {
  pattern: string
  reason: string
}

export interface GenerateExclusionsResult {
  rules: AiExclusionRule[]
  summary: string
  source: 'ollama' | 'openai' | 'heuristic'
  error?: string
  /** 是否检测到可用 AI 服务（用于前端提示去设置页配置） */
  aiAvailable?: boolean
}

// 本地 Ollama 首次请求会触发模型加载，/api/generate 会一直保持连接直到生成结束，
// 因此超时必须宽松；与 aiCleanup.ts 保持一致。
const AI_PROVIDER_TIMEOUT_MS = 60000
const AI_PROVIDER_MAX_ATTEMPTS = 2
const AI_PROVIDER_RETRY_DELAY_MS = 800

// 单次对话最多生成的规则条数，避免过宽模式淹没用户。
const MAX_RULES = 12

async function callWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message))
  )
}

// 校验通配符能否编译为正则（isPathExcluded 的转换逻辑），
// 过滤掉 * 转换后含有未闭合字符类（如孤立 [ ）的非法模式，避免日后匹配时抛错。
export function isValidExclusionPattern(pattern: string): boolean {
  const p = (pattern || '').trim()
  if (!p) return false
  try {
    const pat = p.replace(/\\/g, '\\\\').replace(/\*/g, '.*').replace(/\?/g, '.')
    // eslint-disable-next-line no-new
    new RegExp(`^${pat}$`, 'i')
    return true
  } catch {
    return false
  }
}

interface AiRawRule {
  pattern?: string
  reason?: string
}

async function callAiProviderJson(prompt: string): Promise<{ summary: string; rules: AiExclusionRule[] }> {
  const config = getAiConfig()
  const url =
    config.provider === 'openai'
      ? `${config.endpoint.replace(/\/$/, '')}/chat/completions`
      : `${config.endpoint.replace(/\/$/, '')}/api/generate`

  const body =
    config.provider === 'openai'
      ? JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        })
      : JSON.stringify({
          model: config.model,
          prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 1200 },
        })

  const headers: Record<string, string> =
    config.provider === 'openai'
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey || ''}` }
      : { 'Content-Type': 'application/json' }

  let lastErr: unknown
  for (let attempt = 1; attempt <= AI_PROVIDER_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await callWithTimeout(url, { method: 'POST', headers, body }, AI_PROVIDER_TIMEOUT_MS)
      if (!response.ok) {
        throw new Error(`AI 请求失败: ${response.status} ${response.statusText}`)
      }
      const data = (await response.json()) as
        | { response?: string; done?: boolean }
        | { choices?: { message?: { content?: string } }[] }
      const text =
        config.provider === 'openai'
          ? ((data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || '')
          : ((data as { response?: string }).response || '')

      const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim()
      const firstBrace = cleaned.indexOf('{')
      const lastBrace = cleaned.lastIndexOf('}')
      const jsonText =
        firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
          ? cleaned.slice(firstBrace, lastBrace + 1)
          : cleaned

      const parsed = JSON.parse(jsonText) as { summary?: string; rules?: unknown[] }
      const list = Array.isArray(parsed.rules) ? (parsed.rules as AiRawRule[]) : []
      const rules = list
        .map((r) => ({ pattern: String(r?.pattern || '').trim(), reason: String(r?.reason || '').trim() }))
        .filter((r) => isValidExclusionPattern(r.pattern))
        .slice(0, MAX_RULES)
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '已生成以下排除规则，请勾选需要添加的项。',
        rules,
      }
    } catch (err) {
      lastErr = err
      // 超时重试一次：首次调用常常只是预热本地模型。
      if (!isTimeoutError(err) || attempt >= AI_PROVIDER_MAX_ATTEMPTS) break
      await new Promise((r) => setTimeout(r, AI_PROVIDER_RETRY_DELAY_MS))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function buildPrompt(userPrompt: string): string {
  return `你是一名 Windows 磁盘监控软件的「排除规则」助手。用户会用自然语言描述他们希望从文件监控中排除的路径或文件类型，你需要把它们转换成精确的通配符排除规则。

排除规则的匹配规则（务必遵守）：
- 规则是「通配符模式」：用 * 匹配任意长度的任意字符，用 ? 匹配单个字符。
- 路径分隔符使用 Windows 风格的反斜杠 \\。
- 模式会不区分大小写地与文件/文件夹的完整路径进行匹配。
- 正确示例：
  - D:\\Projects\\* 排除 D 盘 Projects 目录下的所有内容
  - *.iso 排除所有 .iso 文件
  - *node_modules* 排除任何包含 node_modules 的路径
  - C:\\Users\\Alice\\Documents\\Private\\* 排除某个私人目录
  - *\\.git\\* 排除任意仓库的 .git 目录

请根据用户需求生成 1 到 ${MAX_RULES} 条最合适的排除规则。每条规则包含：
- pattern：符合上述规则的通配符模式（只输出模式本身，不要带引号或额外说明）
- reason：用中文写一句简短的排除原因

请以严格 JSON 输出，不要附加任何解释或 Markdown 代码块：
{
  "summary": "用中文说明你生成了哪些规则、覆盖了什么，80 字以内",
  "rules": [
    {"pattern": "通配符模式", "reason": "排除原因"}
  ]
}

用户需求：
${userPrompt}`
}

export async function generateExclusionRules(userPrompt: string): Promise<GenerateExclusionsResult> {
  const config = getAiConfig()
  const aiAvailable = config.provider === 'openai' || (config.provider === 'ollama' && !!config.endpoint)

  if (!aiAvailable) {
    return {
      rules: [],
      summary: '尚未配置 AI 服务，无法自动生成规则。请在「设置 › AI」中填写本地 Ollama 或 OpenAI 端点后重试。',
      source: 'heuristic',
      error: 'no-ai',
      aiAvailable: false,
    }
  }

  try {
    const analyzed = await callAiProviderJson(buildPrompt(userPrompt))
    return {
      rules: analyzed.rules,
      summary: analyzed.summary,
      source: config.provider as 'ollama' | 'openai',
      aiAvailable: true,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logToDb('error', 'aiExclusions', 'AI 生成排除规则失败', msg)
    return {
      rules: [],
      summary: `AI 生成失败：${msg}。可稍后重试，或手动在下方添加规则。`,
      source: config.provider as 'ollama' | 'openai',
      error: msg,
      aiAvailable: true,
    }
  }
}
