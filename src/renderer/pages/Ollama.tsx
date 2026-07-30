import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Cpu,
  Download,
  Trash2,
  RefreshCw,
  Play,
  MessageSquare,
  Square,
  Info,
  AlertTriangle,
  CheckCircle2,
  X,
  Server,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

// 与 src/main/ollama.ts 对应的本地类型（避免渲染层打包 Node 模块）
interface OllamaStatus {
  installed: boolean
  running: boolean
  version: string | null
  executablePath: string | null
}

interface OllamaModel {
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

interface OllamaModelInfo {
  modelfile?: string
  parameters?: string
  template?: string
  system?: string
  details?: OllamaModel['details']
  license?: string
}

interface PullProgress {
  status: string
  total?: number
  completed?: number
  digest?: string
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download'

export default function Ollama() {
  const api = window.electronAPI
  const { t } = useI18n()

  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [pullName, setPullName] = useState('')
  const [pulling, setPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null)
  const [pullError, setPullError] = useState('')

  const [infoModel, setInfoModel] = useState<OllamaModel | null>(null)
  const [modelInfo, setModelInfo] = useState<OllamaModelInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)

  const [deleting, setDeleting] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  // 连接设置（高级）：host / apiKey 可运行时覆盖（绕过代理 / 鉴权）
  const [host, setHost] = useState('')
  const [apiKey, setApiKey] = useState('')
  function applyConfig() {
    if (!api) return
    void api.invoke('ollama-set-config', { host: host || undefined, apiKey: apiKey || undefined })
  }

  // 对话测试
  const [chatModelName, setChatModelName] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  async function loadStatus() {
    if (!api) return
    setLoadingStatus(true)
    try {
      const s = (await api.invoke('ollama-status')) as OllamaStatus | null
      setStatus(s)
      return s
    } finally {
      setLoadingStatus(false)
    }
  }

  async function loadModels() {
    if (!api) return
    setLoadingModels(true)
    try {
      const result = (await api.invoke('ollama-list')) as { ok: boolean; error?: string; data?: OllamaModel[] }
      if (result.ok && result.data) {
        setModels(result.data)
        // 默认选中第一个模型用于对话（如果用户尚未选择）
        setChatModelName((prev) => prev || result.data?.[0]?.name || '')
      }
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    void (async () => {
      const s = await loadStatus()
      if (s?.running) await loadModels()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 流式进度 / token 监听
  useEffect(() => {
    if (!api) return
    const onPull = (p: unknown) => setPullProgress(p as PullProgress)
    const onToken = (delta: unknown) => {
      const d = String(delta ?? '')
      setChatMessages((prev) => {
        const copy = [...prev]
        const idx = copy.length - 1
        const last = copy[idx]
        if (last && last.role === 'assistant') {
          copy[idx] = { ...last, content: last.content + d }
        }
        return copy
      })
    }
    api.on('ollama-pull-progress', onPull)
    api.on('ollama-chat-token', onToken)
    return () => {
      api?.removeAllListeners('ollama-pull-progress')
      api?.removeAllListeners('ollama-chat-token')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 聊天滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  async function handleStart() {
    if (!api) return
    setLoadingStatus(true)
    setMessage('')
    try {
      const result = (await api.invoke('ollama-start')) as { ok: boolean; error?: string }
      if (result.ok) {
        setMessage(t('ollama.start_success'))
        const s = await loadStatus()
        if (s?.running) await loadModels()
      } else {
        const map: Record<string, string> = {
          'not-installed': t('ollama.not_installed'),
          'start-timeout': t('ollama.start_timeout'),
        }
        setMessage('⚠ ' + t('ollama.start_failed') + '：' + (map[result.error || ''] || result.error || ''))
      }
    } finally {
      setLoadingStatus(false)
    }
  }

  async function handlePull() {
    if (!api || !pullName.trim() || pulling) return
    setPulling(true)
    setPullProgress(null)
    setPullError('')
    try {
      const result = (await api.invoke('ollama-pull', pullName.trim())) as { ok: boolean; error?: string }
      if (result.ok) {
        setMessage(t('ollama.pull_success', { name: pullName.trim() }))
        setPullName('')
        setPullProgress(null)
        await loadModels()
      } else {
        const map: Record<string, string> = { aborted: t('ollama.pull_aborted') }
        setPullError(map[result.error || ''] || result.error || '')
      }
    } finally {
      setPulling(false)
    }
  }

  async function handleDelete(model: OllamaModel) {
    if (!api) return
    if (!window.confirm(t('ollama.delete_confirm', { name: model.name }))) return
    setDeleting(model.name)
    setMessage('')
    try {
      const result = (await api.invoke('ollama-delete', model.name)) as { ok: boolean; error?: string }
      if (result.ok) {
        setMessage(t('ollama.delete_success', { name: model.name }))
        await loadModels()
      } else {
        setMessage('⚠ ' + t('ollama.delete_failed') + '：' + (result.error || ''))
      }
    } finally {
      setDeleting(null)
    }
  }

  async function handleShowInfo(model: OllamaModel) {
    if (!api) return
    setInfoModel(model)
    setModelInfo(null)
    setInfoLoading(true)
    try {
      const result = (await api.invoke('ollama-show', model.name)) as {
        ok: boolean
        error?: string
        data?: OllamaModelInfo
      }
      if (result.ok && result.data) setModelInfo(result.data)
    } finally {
      setInfoLoading(false)
    }
  }

  function closeInfo() {
    setInfoModel(null)
    setModelInfo(null)
  }

  async function handleSend() {
    if (!api || !chatModelName || !chatInput.trim() || chatLoading) return
    const userMsg: ChatMessage = { role: 'user', content: chatInput.trim() }
    const history: ChatMessage[] = [...chatMessages, userMsg]
    setChatMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }])
    setChatInput('')
    setChatError('')
    setChatLoading(true)
    try {
      const result = (await api.invoke('ollama-chat', chatModelName, history)) as { ok: boolean; error?: string }
      if (!result.ok) {
        setChatError(result.error === 'aborted' ? t('ollama.chat_aborted') : result.error || '')
      }
    } catch (err) {
      setChatError(String(err))
    } finally {
      setChatLoading(false)
    }
  }

  async function handleStop() {
    if (!api) return
    await api.invoke('ollama-chat-stop')
  }

  function formatTime(iso?: string) {
    if (!iso) return '-'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  }

  const pullPct =
    pullProgress && pullProgress.total && pullProgress.completed != null
      ? Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))
      : null

  const installed = status?.installed ?? false
  const running = status?.running ?? false

  return (
    <div className="space-y-6">
      {/* ── 标题 ── */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('ollama.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('ollama.subtitle')}</p>
          </div>
        </div>
      </section>

      {/* ── 服务状态 ── */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                'flex h-14 w-14 items-center justify-center rounded-2xl',
                running
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : installed
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-destructive/10 text-destructive',
              )}
            >
              <Server className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    running
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : installed
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-destructive/10 text-destructive',
                  )}
                >
                  {running ? t('ollama.running') : installed ? t('ollama.not_running') : t('ollama.not_installed')}
                </span>
                {status?.version && (
                  <span className="text-xs text-muted-foreground">{t('ollama.version')} {status.version}</span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{t('ollama.service_desc')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadStatus()}
              disabled={loadingStatus}
            >
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loadingStatus && 'animate-spin')} />
              {t('ollama.refresh')}
            </Button>
            {installed && !running && (
              <Button size="sm" onClick={() => void handleStart()} disabled={loadingStatus}>
                <Play className="mr-1 h-3.5 w-3.5" />
                {loadingStatus ? t('ollama.starting') : t('ollama.start')}
              </Button>
            )}
            {!installed && (
              <Button
                size="sm"
                onClick={async () => {
                  await api?.invoke('open-external', OLLAMA_DOWNLOAD_URL)
                }}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                {t('ollama.download')}
              </Button>
            )}
          </div>
        </div>

        {!installed && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-3 text-xs text-amber-300/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('ollama.install_hint')}</span>
          </div>
        )}
        {installed && !running && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-3 text-xs text-amber-300/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('ollama.not_running_hint')}</span>
          </div>
        )}

        {message && (
          <p
            className={cn(
              'mt-4 flex items-center gap-1 text-xs',
              message.startsWith('⚠') ? 'text-destructive' : 'text-emerald-400',
            )}
          >
            {message.startsWith('⚠') ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            {message}
          </p>
        )}
      </section>

      {/* ── 连接设置（高级） ── */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-muted-foreground">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">{t('ollama.config_title')}</h3>
            <p className="text-xs text-muted-foreground">{t('ollama.config_hint')}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs text-muted-foreground">{t('ollama.config_host')}</label>
            <Input
              placeholder={t('ollama.config_host_ph')}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onBlur={applyConfig}
              className="w-full"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-xs text-muted-foreground">{t('ollama.config_apikey')}</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={applyConfig}
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* ── 模型管理 ── */}
      {running && (
        <section className="glass rounded-2xl border border-white/5 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-info/10 text-info">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold tracking-tight">{t('ollama.models')}</h3>
                <p className="text-xs text-muted-foreground">{t('ollama.models_desc')}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadModels()} disabled={loadingModels}>
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loadingModels && 'animate-spin')} />
              {t('ollama.refresh')}
            </Button>
          </div>

          {/* 拉取新模型 */}
          <div className="mb-5 flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row">
            <Input
              placeholder={t('ollama.pull_placeholder')}
              value={pullName}
              onChange={(e) => setPullName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handlePull()
              }}
              className="flex-1"
              disabled={pulling}
            />
            <Button onClick={() => void handlePull()} disabled={pulling || !pullName.trim()}>
              {pulling ? (
                t('ollama.pulling')
              ) : (
                <>
                  <Download className="mr-1 h-4 w-4" />
                  {t('ollama.pull')}
                </>
              )}
            </Button>
          </div>

          {pulling && (
            <div className="mb-5 rounded-xl border border-primary/15 bg-primary/[0.04] p-4">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-primary">
                  <Download className="h-3.5 w-3.5" />
                  {pullName} · {pullProgress?.status || t('ollama.pulling')}
                </span>
                {pullPct != null && <span className="text-muted-foreground">{pullPct}%</span>}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-info transition-all duration-300"
                  style={{ width: `${pullPct ?? 0}%` }}
                />
              </div>
              {pullProgress && pullProgress.total != null && (
                <div className="mt-1.5 text-[10px] text-muted-foreground">
                  {formatBytes(pullProgress.completed ?? 0)} / {formatBytes(pullProgress.total)}
                </div>
              )}
            </div>
          )}

          {pullError && (
            <p className="mb-4 flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {t('ollama.pull_failed')}：{pullError}
            </p>
          )}

          {/* 模型列表 */}
          {models.length === 0 && !loadingModels ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('ollama.no_models')}</div>
          ) : (
            <div className="space-y-2">
              {models.map((m) => (
                <div
                  key={m.digest || m.name}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{m.name}</div>
                      <div className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                        <span>{formatBytes(m.size)}</span>
                        {m.details.parameter_size && <span>{m.details.parameter_size}</span>}
                        {m.details.quantization_level && <span>{m.details.quantization_level}</span>}
                        {(m.details.family || (m.details.families && m.details.families[0])) && (
                          <span>{m.details.family || m.details.families?.[0]}</span>
                        )}
                        <span>{t('ollama.modified')}：{formatTime(m.modified_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => void handleShowInfo(m)}>
                      <Info className="mr-1 h-3.5 w-3.5" />
                      {t('ollama.details')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => void handleDelete(m)}
                      disabled={deleting === m.name}
                      title={t('ollama.delete')}
                    >
                      {deleting === m.name ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 对话测试 ── */}
      {running && (
        <section className="glass rounded-2xl border border-white/5 p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">{t('ollama.chat_title')}</h3>
              <p className="text-xs text-muted-foreground">{t('ollama.chat_subtitle')}</p>
            </div>
          </div>

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs text-muted-foreground">{t('ollama.chat_select_model')}</label>
            <select
              value={chatModelName}
              onChange={(e) => setChatModelName(e.target.value)}
              className="h-9 max-w-xs rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{t('ollama.chat_no_model')}</option>
              {models.map((m) => (
                <option key={m.digest || m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* 消息区 */}
          <div className="h-72 overflow-auto rounded-xl border border-white/5 bg-black/20 p-4">
            {chatMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                {t('ollama.chat_empty')}
              </div>
            ) : (
              <div className="space-y-3">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[80%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed',
                        msg.role === 'user'
                          ? 'bg-gradient-to-r from-primary to-info text-primary-foreground'
                          : 'border border-white/10 bg-white/[0.03] text-foreground',
                      )}
                    >
                      {msg.role === 'assistant' && msg.content === '' && chatLoading ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:0.2s]" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:0.4s]" />
                        </span>
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {chatError && (
            <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {t('ollama.chat_failed')}：{chatError}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder={t('ollama.chat_placeholder')}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              className="flex-1"
              disabled={chatLoading || !chatModelName}
            />
            {chatLoading ? (
              <Button variant="destructive" onClick={() => void handleStop()}>
                <Square className="mr-1 h-3.5 w-3.5" />
                {t('ollama.chat_stop')}
              </Button>
            ) : (
              <Button onClick={() => void handleSend()} disabled={!chatModelName || !chatInput.trim()}>
                <MessageSquare className="mr-1 h-3.5 w-3.5" />
                {t('ollama.chat_send')}
              </Button>
            )}
          </div>
          {models.length === 0 && (
            <p className="mt-2 text-[10px] text-muted-foreground">{t('ollama.chat_no_model_hint')}</p>
          )}
        </section>
      )}

      {/* ── 模型详情弹窗 ── */}
      {infoModel && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-2xl rounded-2xl border border-white/10 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Info className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">{infoModel.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(infoModel.size)}
                    {infoModel.details.quantization_level ? ' · ' + infoModel.details.quantization_level : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={closeInfo}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {infoLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {t('ollama.detail_loading')}
              </div>
            ) : (
              <div className="max-h-[50vh] space-y-4 overflow-auto pr-1">
                {modelInfo?.system && (
                  <DetailBlock title={t('ollama.detail_system')} content={modelInfo.system} />
                )}
                {modelInfo?.parameters && (
                  <DetailBlock title={t('ollama.detail_parameters')} content={modelInfo.parameters} />
                )}
                {modelInfo?.modelfile && (
                  <DetailBlock title={t('ollama.detail_modelfile')} content={modelInfo.modelfile} />
                )}
                {modelInfo?.template && (
                  <DetailBlock title={t('ollama.detail_template')} content={modelInfo.template} />
                )}
                {modelInfo?.license && (
                  <DetailBlock title={t('ollama.detail_license')} content={modelInfo.license} />
                )}
                {!modelInfo && (
                  <div className="py-6 text-center text-sm text-muted-foreground">{t('common.no_data')}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailBlock({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/30 p-3 text-[11px] leading-relaxed text-foreground/90">
        {content}
      </pre>
    </div>
  )
}
