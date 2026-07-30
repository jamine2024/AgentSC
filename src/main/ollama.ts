// Ollama 本地大模型管理器 —— 封装 Ollama 本地 REST API。
// 默认监听 http://localhost:11434，可用环境变量 OLLAMA_HOST / OLLAMA_API_KEY 覆盖，
// 也可通过 setOllamaConfig() 在运行时调整（例如改 127.0.0.1 绕过代理、或填 API Key 鉴权）。
// 该模块只负责与本地 Ollama 守护进程通信，不包含任何 UI / 持久化逻辑。

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ───────────────────────────────────────────────────────────
// 可配置的运行时连接参数（支持环境变量 + 运行时覆盖）
// ───────────────────────────────────────────────────────────
let ollamaHost = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '')
let ollamaApiKey = process.env.OLLAMA_API_KEY || ''

export function setOllamaConfig(partial: { host?: string; apiKey?: string }): void {
  if (partial.host !== undefined) {
    const h = partial.host.trim().replace(/\/+$/, '')
    if (h) ollamaHost = h
  }
  if (partial.apiKey !== undefined) ollamaApiKey = partial.apiKey.trim()
}

function authHeaders(): Record<string, string> {
  return ollamaApiKey ? { Authorization: `Bearer ${ollamaApiKey}` } : {}
}

// 读取非 2xx 响应的错误体，便于前端排查（如代理/鉴权返回的说明文字）
async function readError(r: Response): Promise<string> {
  try {
    const t = await r.text()
    const trimmed = t.trim()
    return trimmed ? `HTTP ${r.status}: ${trimmed.slice(0, 400)}` : `HTTP ${r.status}`
  } catch {
    return `HTTP ${r.status}`
  }
}

export interface OllamaStatus {
  installed: boolean
  running: boolean
  version: string | null
  executablePath: string | null
}

export interface OllamaModel {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    format?: string
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
  }
}

export interface OllamaModelInfo {
  modelfile?: string
  parameters?: string
  template?: string
  system?: string
  details?: OllamaModel['details']
  license?: string
}

export interface PullProgress {
  status: string
  total?: number
  completed?: number
  digest?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ApiResult<T> {
  ok: boolean
  error?: string
  data?: T
}

// ───────────────────────────────────────────────────────────
// 安装检测
// ───────────────────────────────────────────────────────────
function isWin(): boolean {
  return process.platform === 'win32'
}

export function getOllamaPaths(): string[] {
  const paths = new Set<string>()
  if (isWin()) {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) paths.add(path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'))
    const programFiles = process.env.ProgramFiles
    if (programFiles) paths.add(path.join(programFiles, 'Ollama', 'ollama.exe'))
    const programFilesX86 = process.env['ProgramFiles(x86)']
    if (programFilesX86) paths.add(path.join(programFilesX86, 'Ollama', 'ollama.exe'))
  } else {
    paths.add('/usr/local/bin/ollama')
    paths.add('/usr/bin/ollama')
    paths.add(path.join(os.homedir(), '.ollama', 'bin', 'ollama'))
  }
  return [...paths]
}

export async function findOllamaExecutable(): Promise<string | null> {
  for (const p of getOllamaPaths()) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  // 回退到 PATH 探测
  return new Promise<string | null>((resolve) => {
    const cmd = isWin() ? 'where' : 'which'
    execFile(cmd, ['ollama'], { encoding: 'utf-8', windowsHide: true, timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null)
        return
      }
      const first = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean)
      resolve(first ? first : null)
    })
  })
}

// ───────────────────────────────────────────────────────────
// 服务状态
// ───────────────────────────────────────────────────────────
export async function getOllamaStatus(): Promise<OllamaStatus> {
  const executablePath = await findOllamaExecutable()
  const installed = !!executablePath
  let running = false
  let version: string | null = null
  try {
    const r = await fetch(`${ollamaHost}/api/version`, {
      signal: AbortSignal.timeout(2000),
      headers: authHeaders(),
    })
    if (r.ok) {
      const j = (await r.json()) as { version?: string }
      version = j.version || null
      running = true
    }
  } catch {
    // 端口未响应：视为未运行（已装但未启动 / 服务未就绪）
  }
  return { installed, running, version, executablePath }
}

// ───────────────────────────────────────────────────────────
// 模型列表 / 详情 / 删除
// ───────────────────────────────────────────────────────────
export async function listModels(): Promise<ApiResult<OllamaModel[]>> {
  try {
    const r = await fetch(`${ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      headers: authHeaders(),
    })
    if (!r.ok) return { ok: false, error: await readError(r) }
    const j = (await r.json()) as { models?: OllamaModel[] }
    return { ok: true, data: j.models || [] }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function showModel(name: string): Promise<ApiResult<OllamaModelInfo>> {
  try {
    const r = await fetch(`${ollamaHost}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return { ok: false, error: await readError(r) }
    const j = (await r.json()) as OllamaModelInfo
    return { ok: true, data: j }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function deleteModel(name: string): Promise<ApiResult<null>> {
  try {
    const r = await fetch(`${ollamaHost}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return { ok: false, error: await readError(r) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ───────────────────────────────────────────────────────────
// 拉取模型（流式进度，通过回调逐条上报 NDJSON 状态行）
// ───────────────────────────────────────────────────────────
export async function pullModel(
  name: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<ApiResult<null>> {
  try {
    const r = await fetch(`${ollamaHost}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, stream: true }),
      signal,
    })
    if (!r.ok) return { ok: false, error: await readError(r) }
    const reader = r.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (line) {
          try {
            onProgress(JSON.parse(line) as PullProgress)
          } catch {
            // 忽略无法解析的增量行
          }
        }
      }
    }
    if (buf.trim()) {
      try {
        onProgress(JSON.parse(buf.trim()) as PullProgress)
      } catch {
        // ignore
      }
    }
    return { ok: true }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, error: aborted ? 'aborted' : String(e) }
  }
}

// ───────────────────────────────────────────────────────────
// 对话（流式 token，通过回调逐增量推送；返回完整文本）
// ───────────────────────────────────────────────────────────
let chatAbortController: AbortController | null = null

export function abortChat(): void {
  chatAbortController?.abort()
  chatAbortController = null
}

export async function chatModel(
  model: string,
  messages: ChatMessage[],
  onToken: (delta: string) => void,
  opts?: { temperature?: number },
): Promise<ApiResult<{ content: string }>> {
  const controller = new AbortController()
  chatAbortController = controller
  try {
    const r = await fetch(`${ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: opts?.temperature !== undefined ? { temperature: opts.temperature } : undefined,
      }),
      signal: controller.signal,
    })
    if (!r.ok) {
      chatAbortController = null
      return { ok: false, error: await readError(r) }
    }
    const reader = r.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        try {
          const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
          if (j.message?.content) {
            full += j.message.content
            onToken(j.message.content)
          }
        } catch {
          // ignore
        }
      }
    }
    if (buf.trim()) {
      try {
        const j = JSON.parse(buf.trim()) as { message?: { content?: string } }
        if (j.message?.content) {
          full += j.message.content
          onToken(j.message.content)
        }
      } catch {
        // ignore
      }
    }
    chatAbortController = null
    return { ok: true, data: { content: full } }
  } catch (e) {
    chatAbortController = null
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, error: aborted ? 'aborted' : String(e) }
  }
}

// ───────────────────────────────────────────────────────────
// 启动本地 Ollama 守护进程（best-effort）
// ───────────────────────────────────────────────────────────
export async function startOllama(): Promise<ApiResult<{ version: string | null }>> {
  const exe = await findOllamaExecutable()
  if (!exe) return { ok: false, error: 'not-installed' }
  try {
    // 以 detached 方式后台拉起 `ollama serve`，不阻塞主进程
    const child = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch (e) {
    return { ok: false, error: String(e) }
  }
  // 轮询端口，最多等待 10s
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const rr = await fetch(`${ollamaHost}/api/version`, {
        signal: AbortSignal.timeout(1000),
        headers: authHeaders(),
      })
      if (rr.ok) {
        const j = (await rr.json()) as { version?: string }
        return { ok: true, data: { version: j.version || null } }
      }
    } catch {
      // 尚未就绪，继续等待
    }
  }
  return { ok: false, error: 'start-timeout' }
}
