// ───────────────────────────────────────────────────────────
// CLI 管理器（主进程）
// - 检测常用的命令行工具（模型运行时 / AI 编程助手 / 框架平台 / 评测向量 / 云 AI）
// - 扫描 PATH 仅自动发现命令行工具名（不匹配 git/node 等通用工具）
// - 在应用内可视化运行（流式输出）或一键打开外部终端
// - 支持通过包管理器（npm/pip/winget/scoop/choco）尽力卸载
// ───────────────────────────────────────────────────────────
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

export interface CliTool {
  id: string // 唯一标识（命令名，不含扩展名）
  name: string // 展示名
  command: string // 实际可执行命令
  category: string
  description?: string
  installed: boolean
  version: string | null
  exePath: string | null
  known: boolean // 是否来自内置注册表
}

interface RegistryEntry {
  id: string
  name: string
  command: string
  category: string
  description?: string
  versionArgs?: string[] // 自定义版本参数（覆盖默认候选）
}

// 内置 CLI 工具注册表（仅相关命令行工具）
// 保留的已结束运行数（含输出缓冲），超出丢弃最旧的
const FINISHED_RUNS_KEEP = 20

const REGISTRY: RegistryEntry[] = [
  // 模型运行时 / 本地推理
  { id: 'llama-server', name: 'llama.cpp Server', command: 'llama-server', category: 'model', description: 'llama.cpp 本地推理服务（OpenAI 兼容）' },
  { id: 'lms', name: 'LM Studio CLI', command: 'lms', category: 'model', description: 'LM Studio 模型管理与本地服务' },
  { id: 'whisper', name: 'Whisper', command: 'whisper', category: 'model', description: 'OpenAI 语音转文字命令行' },
  { id: 'comfy', name: 'ComfyUI CLI', command: 'comfy', category: 'model', description: 'ComfyUI 节点工作流管理', versionArgs: ['--version'] },
  // AI 编程助手 / Agent
  { id: 'aider', name: 'Aider', command: 'aider', category: 'coding', description: 'AI 结对编程（终端内改代码）', versionArgs: ['--version'] },
  { id: 'claude', name: 'Claude Code', command: 'claude', category: 'coding', description: 'Anthropic 官方 AI 编程 Agent', versionArgs: ['--version'] },
  { id: 'codex', name: 'Codex CLI', command: 'codex', category: 'coding', description: 'OpenAI Codex 编程 Agent', versionArgs: ['--version'] },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', category: 'coding', description: 'Google Gemini 编程 Agent', versionArgs: ['--version'] },
  { id: 'cursor', name: 'Cursor', command: 'cursor', category: 'coding', description: 'Cursor AI 编辑器命令行' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', category: 'coding', description: '开源 AI 编程 Agent', versionArgs: ['--version'] },
  { id: 'qwen', name: 'Qwen CLI', command: 'qwen', category: 'coding', description: '通义千问 AI 编程 CLI', versionArgs: ['--version'] },
  { id: 'mimo', name: 'MiMo Code', command: 'mimo', category: 'coding', description: '小米开源终端原生 AI 编程代理（多 Agent / 记忆）', versionArgs: ['--version'] },
  { id: 'goose', name: 'Goose', command: 'goose', category: 'coding', description: 'Block 开源 AI 代理（终端/桌面，MCP 支持）', versionArgs: ['--version'] },
  { id: 'zed', name: 'Zed', command: 'zed', category: 'coding', description: 'Rust 原生 AI 编辑器命令行' },
  { id: 'codebuddy', name: 'CodeBuddy CLI', command: 'codebuddy', category: 'coding', description: '腾讯 CodeBuddy AI 编程命令行' },
  // 框架与平台
  { id: 'huggingface-cli', name: 'Hugging Face CLI', command: 'huggingface-cli', category: 'framework', description: 'HF 模型/数据集下载与推理', versionArgs: ['--version'] },
  { id: 'cog', name: 'Cog (Replicate)', command: 'cog', category: 'framework', description: 'Replicate 模型容器化工具', versionArgs: ['--version'] },
  { id: 'modal', name: 'Modal', command: 'modal', category: 'framework', description: '云端 GPU 函数运行平台', versionArgs: ['--version'] },
  { id: 'replicate', name: 'Replicate CLI', command: 'replicate', category: 'framework', description: 'Replicate 模型部署与调用', versionArgs: ['--version'] },
  { id: 'langgraph', name: 'LangGraph CLI', command: 'langgraph', category: 'framework', description: 'LangChain 代理图开发 CLI', versionArgs: ['--version'] },
  { id: 'crewai', name: 'CrewAI', command: 'crewai', category: 'framework', description: '多 Agent 协作框架 CLI', versionArgs: ['--version'] },
  { id: 'fastmcp', name: 'FastMCP', command: 'fastmcp', category: 'framework', description: 'MCP(Model Context Protocol) 服务开发' },
  // 工具与评测 / ML 工程
  { id: 'promptfoo', name: 'Promptfoo', command: 'promptfoo', category: 'tooling', description: 'Prompt/LLM 评测与红队测试', versionArgs: ['--version'] },
  { id: 'chroma', name: 'Chroma', command: 'chroma', category: 'tooling', description: '向量数据库命令行', versionArgs: ['--version'] },
  { id: 'wandb', name: 'Weights & Biases', command: 'wandb', category: 'tooling', description: 'ML 实验追踪与可视化 CLI', versionArgs: ['--version'] },
  { id: 'mlflow', name: 'MLflow', command: 'mlflow', category: 'tooling', description: 'ML 生命周期 / 模型注册 CLI', versionArgs: ['--version'] },
  { id: 'dvc', name: 'DVC', command: 'dvc', category: 'tooling', description: '数据版本控制（AI/ML 数据集）', versionArgs: ['--version'] },
  // 云 AI 服务
  { id: 'openai', name: 'OpenAI CLI', command: 'openai', category: 'cloud', description: 'OpenAI 官方命令行（含音频/批处理）', versionArgs: ['--version'] },
]

// PATH 自动发现时只匹配这些 AI 工具名（避免把系统/通用工具扫进来）
const AI_NAME_SET = new Set<string>([
  // 模型运行时
  'ollama', 'llama-server', 'llama-cli', 'llama', 'lms', 'jan', 'jan-cli', 'whisper', 'comfy', 'vllm', 'tritonserver',
  // AI 编程助手 / Agent
  'aider', 'claude', 'claude-code', 'codex', 'codex-cli', 'gemini', 'cursor', 'opencode', 'qwen', 'qwen-cli',
  'mimo', 'goose', 'zed', 'codebuddy', 'trae', 'qoder', 'kiro', 'windsurf', 'roo', 'cline', 'kilo', 'antigravity', 'factory', 'devin',
  // 框架与平台
  'huggingface-cli', 'hf', 'cog', 'modal', 'replicate', 'langgraph', 'crewai', 'fastmcp', 'langsmith',
  // 工具与评测 / ML 工程
  'promptfoo', 'chroma', 'wandb', 'mlflow', 'dvc', 'litellm', 'deepeval', 'ragas',
  // 云 AI / 模型供应商
  'openai', 'groq', 'cohere', 'anthropic', 'mistral', 'deepseek', 'kimi',
  'glm', 'ernie', 'dashscope', 'zhipuai', 'siliconflow', 'bedrock', 'vertex', 'together',
  // 向量库
  'weaviate', 'qdrant', 'milvus', 'milvus_cli', 'pinecone',
  // 其他库 / 工具
  'inspect', 'transformers', 'diffusers', 'onnx', 'onnxruntime', 'sentence-transformers',
  'tensorflow', 'torch', 'pytorch', 'stable-diffusion', 'auto-gpt', 'agentic',
])

const VERSION_ARGS_CANDIDATES = ['--version', '-v', '-V', 'version', '--help']

// 路径扫描时排除的 Windows 系统目录（噪声过大）
const SYSTEM_DIR_HINTS = ['\\windows\\system32', '\\windows\\syswow64', '\\windows\\winsxs', '\\windows\\windowspowershell', '\\windows\\powershell']

const EXE_RE = /\.(exe|cmd|bat|ps1|com)$/i
const MAX_DISCOVERED = 250

let cache: CliTool[] | null = null

function looksLikeVersion(s: string): boolean {
  const t = (s || '').trim()
  if (!t) return false
  return /v?\d+\.\d+/.test(t) || /version/i.test(t.slice(0, 60))
}

// 通过 cmd /c where 定位命令完整路径（Windows）
function which(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('cmd', ['/c', 'where', command], { windowsHide: true, timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      // 优先选择 .exe / .cmd，避免选中无关扩展
      const preferred = lines.find((l) => /\.(exe|cmd)$/i.test(l)) || lines[0]
      resolve(preferred || null)
    })
  })
}

// 运行命令并捕获 stdout+stderr（带超时）
function runCapture(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      settled = true
      const out = `${stdout || ''}${stderr || ''}`.trim()
      if (out) return resolve(out)
      reject(err || new Error('no output'))
    })
    child.on('error', (e) => {
      if (!settled) {
        settled = true
        reject(e)
      }
    })
  })
}

async function resolveVersion(_command: string, exePath: string, override?: string[]): Promise<string | null> {
  const argsList = override ? [override] : VERSION_ARGS_CANDIDATES.map((a) => [a])
  for (const a of argsList) {
    try {
      const out = await runCapture(exePath, a, 4000)
      const firstLine = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ''
      if (looksLikeVersion(firstLine)) return firstLine.replace(/\s+/g, ' ').slice(0, 80)
      // 若首行不像版本号但命令本身输出了内容，仍尝试在全部输出里找版本片段
      const m = out.match(/[vV]?\d+\.\d+\.\d+[\w.-]*/)
      if (m) return m[0].slice(0, 80)
    } catch {
      // 尝试下一个候选参数
    }
  }
  return null
}

// 扫描 PATH 仅自动发现命令行工具（排除系统目录与通用工具）
function scanPath(knownIds: Set<string>, aiNames: Set<string>): CliTool[] {
  const rawPath = process.env.PATH || ''
  const dirs = rawPath.split(';').map((d) => d.trim()).filter(Boolean)
  const seen = new Set<string>()
  const result: CliTool[] = []
  for (const dir of dirs) {
    const lower = dir.toLowerCase()
    if (SYSTEM_DIR_HINTS.some((h) => lower.includes(h))) continue
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isFile()) continue
      if (!EXE_RE.test(e.name)) continue
      const base = e.name.replace(EXE_RE, '').toLowerCase()
      if (!base || seen.has(base)) continue
      if (knownIds.has(base) || !aiNames.has(base)) continue
      seen.add(base)
      result.push({
        id: base,
        name: e.name.replace(EXE_RE, ''),
        command: e.name.replace(EXE_RE, ''),
        category: 'other',
        description: '检测到来自 PATH 的命令行工具',
        installed: true,
        version: null,
        exePath: path.join(dir, e.name),
        known: false,
      })
      if (result.length >= MAX_DISCOVERED) return result
    }
  }
  return result
}

export async function detectCliTools(force = false): Promise<CliTool[]> {
  if (cache && !force) return cache
  const knownIds = new Set(REGISTRY.map((r) => r.id.toLowerCase()))

  // 并行检测注册表内工具
  const knownResults = await Promise.all(
    REGISTRY.map(async (entry): Promise<CliTool> => {
      const exePath = await which(entry.command)
      if (!exePath) {
        return {
          id: entry.id,
          name: entry.name,
          command: entry.command,
          category: entry.category,
          description: entry.description,
          installed: false,
          version: null,
          exePath: null,
          known: true,
        }
      }
      const version = await resolveVersion(entry.command, exePath, entry.versionArgs)
      return {
        id: entry.id,
        name: entry.name,
        command: entry.command,
        category: entry.category,
        description: entry.description,
        installed: true,
        version,
        exePath,
        known: true,
      }
    }),
  )

  const discovered = scanPath(knownIds, AI_NAME_SET)

  const merged = [...knownResults, ...discovered].sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  cache = merged
  return merged
}

// ── 在应用内运行（流式输出） ──
interface RunHandle {
  child: ChildProcess
  sender: Electron.WebContents
  command: string
  cwd: string
  buffer: string // 累计输出缓冲（供渲染端重连/恢复时回放）
  startTime: number
  finished: boolean
  exitCode: number | null
}
// 运行中进程
const runs = new Map<string, RunHandle>()
// 已退出但保留元数据的进程（用于关闭控制台前仍可查看最终输出）
const finishedRuns = new Map<string, RunHandle>()

// 输出缓冲上限（字符），超出只保留尾部
const BUFFER_CAP = 200000

// 将原始输出追加进缓冲（去除 ANSI，与渲染端展示保持一致）
function pushBuffer(handle: RunHandle, data: string) {
  const clean = data
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
  handle.buffer += clean
  if (handle.buffer.length > BUFFER_CAP) {
    handle.buffer = handle.buffer.slice(handle.buffer.length - BUFFER_CAP)
  }
}

// 仅允许运行内置 AI 工具名（命中注册表/自动发现白名单）或真实存在的可执行文件绝对路径。
// 杜绝渲染进程通过 shell:true 把任意命令注入主进程执行（管理员权限下的 RCE）。
function isAllowedCliCommand(command: string): boolean {
  const trimmed = (command || '').trim()
  if (!trimmed) return false
  const base = path.basename(trimmed).toLowerCase()
  if (REGISTRY.some((r) => r.command.toLowerCase() === trimmed.toLowerCase()) || AI_NAME_SET.has(base)) {
    return true
  }
  // 绝对路径可执行文件（需真实存在），避免 shell 解析注入
  if (/^[a-z]:[\\/]/i.test(trimmed) || trimmed.startsWith('\\\\')) {
    try {
      const stat = fs.statSync(trimmed)
      return stat.isFile() && /\.(exe|cmd|bat|ps1|com)$/i.test(trimmed)
    } catch {
      return false
    }
  }
  return false
}

export function runCli(
  id: string,
  command: string,
  args: string[],
  sender: Electron.WebContents,
  cwd?: string,
): { ok: boolean; pid?: number; error?: string } {
  // 同 id 先终止旧进程（若存在）
  killCli(id)
  if (!isAllowedCliCommand(command)) {
    return { ok: false, error: 'command-not-allowed' }
  }
  // 路径型可执行 -> 禁用 shell（避免 shell 解释注入）；PATH 工具名 -> 保留 shell 以便解析
  const useShell = !/^[a-z]:[\\/]/i.test(command) && !command.startsWith('\\\\')
  const child = spawn(command, args || [], {
    shell: useShell,
    cwd: cwd || undefined,
    windowsHide: true,
  })
  const handle: RunHandle = {
    child,
    sender,
    command,
    cwd: cwd || '',
    buffer: '',
    startTime: Date.now(),
    finished: false,
    exitCode: null,
  }
  runs.set(id, handle)
  const emit = (stream: 'stdout' | 'stderr', data: string) => {
    try {
      sender.send('cli:data', { id, stream, data })
    } catch {
      /* ignore */
    }
  }
  child.stdout?.on('data', (d) => {
    const s = d.toString()
    pushBuffer(handle, s)
    emit('stdout', s)
  })
  child.stderr?.on('data', (d) => {
    const s = d.toString()
    pushBuffer(handle, s)
    emit('stderr', s)
  })
  child.on('error', (e) => emit('stderr', String(e)))
  child.on('exit', (code) => {
    handle.finished = true
    handle.exitCode = code ?? null
    // 退出后保留元数据与缓冲，移到 finishedRuns，便于渲染端恢复查看
    runs.delete(id)
    finishedRuns.set(id, handle)
    // finishedRuns 上限：句柄含最长 200K 字符的输出缓冲，只在显式清空时
    // 释放；不设上限时长期多次运行会缓慢累积，保留最近 FINISHED_KEEP 条
    if (finishedRuns.size > FINISHED_RUNS_KEEP) {
      const oldest = finishedRuns.keys().next().value
      if (oldest !== undefined) finishedRuns.delete(oldest)
    }
    try {
      sender.send('cli:exit', { id, code })
    } catch {
      /* ignore */
    }
  })
  return { ok: true, pid: child.pid ?? undefined }
}

export function writeCli(id: string, data: string): boolean {
  const handle = runs.get(id)
  if (!handle) return false
  handle.child.stdin?.write(data)
  return true
}

// 终止进程；进程退出后会由 exit 处理器迁移到 finishedRuns（保留缓冲供查看）
export function killCli(id: string): boolean {
  const handle = runs.get(id)
  if (!handle) return false
  try {
    handle.child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  return true
}

// 彻底清理：从 runs / finishedRuns 中移除（渲染端关闭标签页时调用）
export function clearCli(id: string): boolean {
  const running = runs.get(id)
  if (running) {
    try {
      running.child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    runs.delete(id)
  }
  const finished = finishedRuns.get(id)
  if (finished) {
    finishedRuns.delete(id)
  }
  return running !== undefined || finished !== undefined
}

// 列出当前所有运行/已结束的进程，供渲染端在挂载或重连时恢复状态
export function listCliRuns(): Array<{
  id: string
  command: string
  cwd: string
  running: boolean
  finished: boolean
  exitCode: number | null
  startTime: number
  buffer: string
}> {
  const all: Array<[string, RunHandle]> = [
    ...runs.entries(),
    ...finishedRuns.entries(),
  ]
  return all.map(([id, h]) => ({
    id,
    command: h.command,
    cwd: h.cwd,
    running: !h.finished,
    finished: h.finished,
    exitCode: h.exitCode,
    startTime: h.startTime,
    buffer: h.buffer,
  }))
}

// ── 一键在外部终端启动（现代化方案） ──
export async function openCliTerminal(
  command: string,
  name?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const title = name ? `AgentSC · ${name}` : `AgentSC · ${command}`
    // 优先检测 PowerShell 7（pwsh），其次 Windows Terminal（wt）
    const [wtPath, pwshPath] = await Promise.all([which('wt'), which('pwsh')])
    const hasWt = !!wtPath
    const hasPwsh = !!pwshPath

    if (hasWt && hasPwsh) {
      // 最佳路径：Windows Terminal + PowerShell 7
      const child = spawn('wt', ['--title', title, 'pwsh', '-NoExit', '-Command', command], {
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      })
      child.unref()
      return { ok: true }
    }

    if (hasWt) {
      // 有 wt 但没有 pwsh，用 cmd 但给个好看标题
      const child = spawn('wt', ['--title', title, 'cmd', '/k', command], {
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      })
      child.unref()
      return { ok: true }
    }

    if (hasPwsh) {
      // 有 pwsh 但没 wt，直接启动 pwsh 窗口
      const ps = `Start-Process pwsh -ArgumentList "-NoExit","-Command","${command.replace(/"/g, '`"')}" -WindowStyle Normal`
      const child = spawn('powershell', ['-NoProfile', '-Command', ps], {
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      })
      child.unref()
      return { ok: true }
    }

    // 最终回退：PowerShell 5.1 启动 cmd
    const ps = `Start-Process cmd -ArgumentList "/k","${command.replace(/"/g, '`"')}" -WindowStyle Normal`
    const child = spawn('powershell', ['-NoProfile', '-Command', ps], {
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
    })
    child.unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── 通过 shell 运行命令并捕获 stdout+stderr（带超时） ──
// 使用 shell:true 以兼容 npm.cmd / pip.exe 等需经 PATH 解析的命令。
function runShellCapture(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    let settled = false
    let buf = ''
    const child = spawn(cmd, args, { shell: true, windowsHide: true })
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve(buf)
      }
    }, timeout)
    const onData = (d: Buffer | string) => {
      buf += d.toString()
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(buf)
      }
    })
    child.on('exit', () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(buf)
      }
    })
  })
}

function safeJsonParse(s: string): any {
  try {
    const idx = s.indexOf('{')
    return idx >= 0 ? JSON.parse(s.slice(idx)) : null
  } catch {
    return null
  }
}

export interface UninstallResult {
  ok: boolean
  method?: string
  error?: string
}

// 尽力通过包管理器卸载一个 CLI 工具（按命令名匹配）
export async function uninstallCli(command: string): Promise<UninstallResult> {
  const cmd = command.toLowerCase()

  // 1) npm 全局（按 bin 名匹配包名，兼容 @scope/pkg）
  try {
    const out = await runShellCapture('npm', ['ls', '-g', '--depth=0', '--json'], 20000)
    const json = safeJsonParse(out)
    const deps: Record<string, any> = json?.dependencies || {}
    for (const [pkg, info] of Object.entries(deps)) {
      const bin = info?.bin
      const bins = bin ? (typeof bin === 'string' ? [bin] : Object.values(bin)) : []
      if (bins.some((b: unknown) => String(b).toLowerCase() === cmd)) {
        await runShellCapture('npm', ['uninstall', '-g', pkg], 180000)
        if (!(await which(command))) return { ok: true, method: `npm (${pkg})` }
        return { ok: false, error: `npm 卸载已执行，但 ${command} 仍存在` }
      }
    }
  } catch {
    /* ignore */
  }

  // 2) pip
  try {
    const show = await runShellCapture('pip', ['show', command], 10000)
    if (show && /Name:/i.test(show)) {
      await runShellCapture('pip', ['uninstall', '-y', command], 180000)
      if (!(await which(command))) return { ok: true, method: 'pip' }
      return { ok: false, error: `pip 卸载已执行，但 ${command} 仍存在` }
    }
  } catch {
    /* ignore */
  }

  // 3) winget
  try {
    const list = await runShellCapture('winget', ['list', '--name', command], 10000)
    if (list && list.toLowerCase().includes(cmd)) {
      await runShellCapture('winget', ['uninstall', '--name', command, '-e'], 180000)
      if (!(await which(command))) return { ok: true, method: 'winget' }
      return { ok: false, error: `winget 卸载已执行，但 ${command} 仍存在` }
    }
  } catch {
    /* ignore */
  }

  // 4) scoop
  try {
    const list = await runShellCapture('scoop', ['list'], 10000)
    if (list && list.toLowerCase().includes(cmd)) {
      await runShellCapture('scoop', ['uninstall', command], 180000)
      if (!(await which(command))) return { ok: true, method: 'scoop' }
      return { ok: false, error: `scoop 卸载已执行，但 ${command} 仍存在` }
    }
  } catch {
    /* ignore */
  }

  // 5) choco
  try {
    const list = await runShellCapture('choco', ['list', '--local-only', command], 10000)
    if (list && !/No packages/i.test(list) && list.trim()) {
      await runShellCapture('choco', ['uninstall', command, '-y'], 180000)
      if (!(await which(command))) return { ok: true, method: 'choco' }
      return { ok: false, error: `choco 卸载已执行，但 ${command} 仍存在` }
    }
  } catch {
    /* ignore */
  }

  return { ok: false, error: '未找到匹配的包管理器，请手动卸载' }
}
