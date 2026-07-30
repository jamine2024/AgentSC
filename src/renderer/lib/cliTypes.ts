// 全局 CLI 运行态类型与工具（在 App 与 CliConsoleDrawer 之间共享）
// 关键：运行态提升到 App 层级，渲染端常驻，切 tab 不会卸载，
// 因此后台进程的输出可实时累计，进程也只在用户手动终止时才结束。

export interface CliRunState {
  id: string // 稳定唯一标识，主进程按此 id 关联子进程
  toolId: string // 对应已安装 CLI 工具的 id
  toolName: string // 展示名
  command: string // 实际执行的命令
  args: string[] // 参数（用于重跑）
  cwd: string // 工作目录
  output: string // 累计输出（已去除 ANSI）
  running: boolean // 进程是否仍在运行
  finished: boolean // 进程是否已退出
  exitCode: number | null // 退出码
  startTime: number // 启动时间戳
  input: string // 输入框当前内容（用于 Run 按钮 / 重跑）
}

// 去除常见 ANSI 转义序列，便于在 <pre> 中干净展示
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

// 单个运行输出上限（字符数），超出只保留尾部，避免内存无限增长
export const CLI_OUTPUT_CAP = 80000

// 简单的命令行分词（支持双引号包裹含空格的参数）
export function tokenize(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

// CliManager 需要的工具简报（由页面自身的 CliTool 结构兼容传入）
export interface CliToolBrief {
  id: string
  name: string
  command: string
}

// App 下传给 CliManager 的外部状态与回调（运行态已提升到 App 层级）
export interface CliManagerProps {
  runs: CliRunState[]
  consoleOpen: boolean
  activeRunId: string | null
  onOpenTool: (tool: CliToolBrief) => void
  onOpenConsole: () => void
  onSetActiveRun: (id: string) => void
  onKillRun: (id: string) => void
  onClearRun: (id: string) => void
  onClearOutput: (id: string) => void
}
