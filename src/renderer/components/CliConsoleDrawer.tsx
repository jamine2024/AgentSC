import { useEffect, useRef } from 'react'
import {
  TerminalSquare,
  Play,
  Square,
  Send,
  Trash2,
  FolderOpen,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  CircleDot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { type CliRunState, tokenize } from '@/lib/cliTypes'

export interface CliConsoleDrawerProps {
  open: boolean
  runs: CliRunState[]
  activeRunId: string | null
  onSetActiveRun: (id: string) => void
  onRunStart: (id: string, args: string[]) => void
  onSendStdin: (id: string, data: string) => void
  onKill: (id: string) => void
  onClearRun: (id: string) => void
  onClearOutput: (id: string) => void
  onSetInput: (id: string, value: string) => void
  onSetCwd: (id: string, cwd: string) => void
  onCloseConsole: () => void
}

export function CliConsoleDrawer(props: CliConsoleDrawerProps) {
  const { t } = useI18n()
  const {
    open,
    runs,
    activeRunId,
    onSetActiveRun,
    onRunStart,
    onSendStdin,
    onKill,
    onClearRun,
    onClearOutput,
    onSetInput,
    onSetCwd,
    onCloseConsole,
  } = props

  const active = runs.find((r) => r.id === activeRunId) || runs[runs.length - 1] || null
  const outputEndRef = useRef<HTMLDivElement>(null)

  // 输出区自动滚动到底部（仅当前激活任务）
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active?.output, active?.id])

  if (!open) return null

  const runningCount = runs.filter((r) => r.running).length

  function handleRunOrSend(run: CliRunState) {
    if (run.running) {
      const data = run.input
      if (!data.trim()) return
      onSendStdin(run.id, data + '\n')
      onSetInput(run.id, '')
    } else {
      onRunStart(run.id, tokenize(run.input))
    }
  }

  async function handleSelectCwd(run: CliRunState) {
    const dir = (await window.electronAPI.invoke('select-directory')) as string | null
    if (dir) onSetCwd(run.id, dir)
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-stretch justify-end bg-black/60 p-0 backdrop-blur-sm md:p-6">
      <div className="glass flex h-full w-full max-w-3xl flex-col rounded-none border border-white/10 md:rounded-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <TerminalSquare className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">
                {t('cli.console_title')}
                {runningCount > 0 && (
                  <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    {runningCount} {t('cli.tasks_indicator')}
                  </span>
                )}
              </h3>
              <p className="text-[10px] text-muted-foreground">{t('cli.close_console_hint')}</p>
            </div>
          </div>
          <button
            onClick={onCloseConsole}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground"
            title={t('cli.tab_close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 任务标签页（多任务并行，切换不影响后台进程） */}
        {runs.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-white/5 px-3 py-2">
            {runs.map((r) => {
              const isActive = r.id === active?.id
              return (
                <div
                  key={r.id}
                  className={cn(
                    'group flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all',
                    isActive
                      ? 'border-primary/30 bg-primary/15 text-primary'
                      : 'border-white/[0.06] bg-white/[0.03] text-muted-foreground hover:text-foreground',
                  )}
                >
                  <button className="flex items-center gap-1.5" onClick={() => onSetActiveRun(r.id)}>
                    <RunStatusDot run={r} />
                    <span className="max-w-[120px] truncate">{r.toolName}</span>
                  </button>
                  <button
                    className="ml-0.5 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
                    title={t('cli.tab_close')}
                    onClick={() => {
                      if (window.confirm(t('cli.tab_close_confirm'))) onClearRun(r.id)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t('cli.no_active_run')}
          </div>
        ) : (
          <>
            {/* 输出区 */}
            <div className="relative flex-1 overflow-auto bg-black/30 p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground/90">
                {active.output || (
                  <span className="text-muted-foreground/60">
                    $ {active.command} {active.input}
                    {'\n'}
                    {t('cli.console_subtitle')}
                  </span>
                )}
                <div ref={outputEndRef} />
              </pre>
            </div>

            {/* 状态条 */}
            <div className="flex items-center gap-2 border-t border-white/5 px-4 py-1.5 text-[11px]">
              <RunStatusDot run={active} />
              <span
                className={cn(
                  active.running
                    ? 'text-emerald-400'
                    : active.finished
                      ? 'text-muted-foreground/70'
                      : 'text-primary',
                )}
              >
                {active.running
                  ? t('cli.keep_running')
                  : active.finished
                    ? `${t('cli.finished')} · code ${active.exitCode ?? '?'}`
                    : t('cli.input_placeholder')}
              </span>
            </div>

            {/* 工作目录 */}
            <div className="flex items-center gap-2 border-t border-white/5 px-4 py-2">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <span className="shrink-0 text-[11px] text-muted-foreground">{t('cli.cwd')}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80" title={active.cwd}>
                {active.cwd || t('cli.cwd_placeholder')}
              </span>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void handleSelectCwd(active)}>
                {t('cli.select_dir')}
              </Button>
            </div>

            {/* 输入区 */}
            <div className="flex items-center gap-2 border-t border-white/5 p-3">
              <span className="shrink-0 font-mono text-xs text-primary">$</span>
              <Input
                value={active.input}
                onChange={(e) => onSetInput(active.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleRunOrSend(active)
                  }
                }}
                placeholder={t('cli.input_placeholder')}
                className="flex-1 font-mono text-xs"
              />
              {active.running ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => handleRunOrSend(active)}
                    disabled={!active.input.trim()}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    {t('cli.send')}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => onKill(active.id)}>
                    <Square className="mr-1 h-3.5 w-3.5" />
                    {t('cli.stop')}
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => handleRunOrSend(active)}>
                  <Play className="mr-1 h-3.5 w-3.5" />
                  {active.finished ? t('cli.run_again') : t('cli.run_btn')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onClearOutput(active.id)}
                title={t('cli.clear')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function RunStatusDot({ run }: { run: CliRunState }) {
  if (run.running) {
    return <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
  }
  if (run.finished) {
    return run.exitCode === 0 ? (
      <CheckCircle2 className="h-3 w-3 text-muted-foreground/60" />
    ) : (
      <XCircle className="h-3 w-3 text-destructive" />
    )
  }
  return <CircleDot className="h-3 w-3 text-primary" />
}
