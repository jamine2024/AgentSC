import { useEffect, useRef, useState } from 'react'
import { Download, Filter, Plus, Trash2, Upload, Sparkles, Send, Bot, User, Check, Loader2, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

interface ExclusionRule {
  id: number
  pattern: string
  reason: string
  enabled: number
  is_default?: number
  created_at: number
}

interface AiRule {
  pattern: string
  reason: string
  added?: boolean
}

interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  rules?: AiRule[]
  generating?: boolean
  error?: boolean
}

export default function Exclusions() {
  const { t } = useI18n()
  const api = window.electronAPI
  const [rules, setRules] = useState<ExclusionRule[]>([])
  const [pattern, setPattern] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- AI 对话状态 ----
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [batchMessage, setBatchMessage] = useState('')
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)
  const nextId = () => `m${++idRef.current}`

  useEffect(() => {
    loadRules()
  }, [])

  // 新消息到达时把滚动条拉到底部
  useEffect(() => {
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function loadRules() {
    const res = await api?.invoke('get-exclusion-rules')
    if (Array.isArray(res)) setRules(res as ExclusionRule[])
  }

  // ---------------------------------------------------------------------------
  // AI 对话
  // ---------------------------------------------------------------------------

  async function sendMessage() {
    const text = input.trim()
    if (!text || busy) return
    setBatchMessage('')
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text }
    const aiId = nextId()
    const aiMsg: ChatMessage = { id: aiId, role: 'ai', text: '', generating: true }
    setMessages((prev) => [...prev, userMsg, aiMsg])
    setInput('')
    setBusy(true)

    try {
      const res = (await api?.invoke('generate-exclusion-rules', text)) as {
        rules?: AiRule[]
        summary: string
        source: string
        error?: string
      } | undefined

      const rules = Array.isArray(res?.rules) ? res!.rules! : []
      // 默认勾选全部（生成后未添加的规则）
      const sel: Record<string, boolean> = {}
      rules.forEach((_r, i) => {
        sel[`${aiId}__${i}`] = true
      })
      setSelected((prev) => ({ ...prev, ...sel }))

      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId
            ? { ...m, text: res?.summary || t('exclusions.ai_no_rules_returned'), rules, generating: false, error: !!res?.error && rules.length === 0 }
            : m,
        ),
      )
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId ? { ...m, text: t('exclusions.ai_error', { reason: String(err) }), generating: false, error: true } : m,
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  function toggleRule(msgId: string, idx: number) {
    const key = `${msgId}__${idx}`
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function selectedRulesFor(msg: ChatMessage): AiRule[] {
    if (!msg.rules) return []
    return msg.rules
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => !r.added && selected[`${msg.id}__${i}`])
      .map(({ r }) => r)
  }

  function allUnaddedSelected(msg: ChatMessage): boolean {
    if (!msg.rules) return false
    const pending = msg.rules.filter((r) => !r.added)
    if (pending.length === 0) return false
    // 遍历全部规则用真实下标判断：已添加视为选中，未添加看勾选态
    return msg.rules.every((r, i) => (r.added ? true : selected[`${msg.id}__${i}`]))
  }

  function toggleAllFor(msg: ChatMessage) {
    if (!msg.rules) return
    const next = !allUnaddedSelected(msg)
    setSelected((prev) => {
      const copy = { ...prev }
      msg.rules!.forEach((r, i) => {
        if (!r.added) copy[`${msg.id}__${i}`] = next
      })
      return copy
    })
  }

  async function addSelected(msg: ChatMessage) {
    // 带真实下标收集勾选且未添加的规则，便于回写与清勾
    const toAddWithIdx = (msg.rules || [])
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => !r.added && selected[`${msg.id}__${i}`])
    if (toAddWithIdx.length === 0) return
    const toAdd = toAddWithIdx.map(({ r }) => r)
    setBatchMessage('')
    try {
      const res = (await api?.invoke('add-exclusion-rules-batch', toAdd)) as
        | { added?: number; skipped?: number }
        | undefined
      // 标记这些规则为已添加，并取消它们的勾选
      const idxSet = new Set(toAddWithIdx.map(({ i }) => i))
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msg.id || !m.rules) return m
          const rules = m.rules.map((r, i) => (idxSet.has(i) ? { ...r, added: true } : r))
          return { ...m, rules }
        }),
      )
      setSelected((prev) => {
        const copy = { ...prev }
        idxSet.forEach((i) => delete copy[`${msg.id}__${i}`])
        return copy
      })
      setBatchMessage(t('exclusions.ai_added', { added: res?.added ?? 0, skipped: res?.skipped ?? 0 }))
      loadRules()
    } catch (err) {
      setBatchMessage(t('exclusions.ai_error', { reason: String(err) }))
    }
  }

  function clearChat() {
    setMessages([])
    setSelected({})
    setBatchMessage('')
    setInput('')
  }

  // ---------------------------------------------------------------------------
  // 手动添加
  // ---------------------------------------------------------------------------

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!pattern.trim()) return
    setError('')
    try {
      await api?.invoke('add-exclusion-rule', {
        pattern: pattern.trim(),
        reason: reason.trim(),
        enabled: 1,
      })
      setPattern('')
      setReason('')
      loadRules()
    } catch (err) {
      setError(t('exclusions.add_failed'))
    }
  }

  async function toggleRule2(rule: ExclusionRule) {
    await api?.invoke('update-exclusion-rule', {
      id: rule.id,
      rule: { enabled: rule.enabled ? 0 : 1 },
    })
    loadRules()
  }

  async function deleteRule(id: number) {
    const res = (await api?.invoke('delete-exclusion-rule', id)) as
      | { ok: boolean; error?: string }
      | undefined
    if (res && res.ok === false && res.error === 'builtin') {
      setError(t('exclusions.builtin_cannot_delete'))
      return
    }
    loadRules()
  }

  async function handleExport() {
    setError('')
    setMessage('')
    try {
      const res = (await api?.invoke('export-exclusion-rules')) as
        | { canceled: boolean; filePath: string | null; error?: string }
        | undefined
      if (!res || res.canceled) return
      if (res.error) {
        setError(t('exclusions.export_failed'))
        return
      }
      setMessage(res.filePath || '')
    } catch {
      setError(t('exclusions.export_failed'))
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError('')
    setMessage('')
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选择同一文件
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const rules = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rules) ? parsed.rules : null
      if (!rules || !rules.every((r: unknown) => r && typeof (r as { pattern?: unknown }).pattern === 'string')) {
        setError(t('exclusions.import_invalid'))
        return
      }
      const res = (await api?.invoke('import-exclusion-rules', rules)) as
        | { canceled: boolean; error?: string | null; added?: number; skipped?: number }
        | undefined
      if (!res || res.canceled) return
      if (res.error === 'invalid-format') {
        setError(t('exclusions.import_invalid'))
        return
      }
      if (res.error) {
        setError(t('exclusions.import_failed'))
        return
      }
      setMessage(t('exclusions.import_success', { added: res.added ?? 0, skipped: res.skipped ?? 0 }))
      loadRules()
    } catch {
      setError(t('exclusions.import_invalid'))
    }
  }

  return (
    <div className="space-y-6">
      {/* ===== AI 助手对话面板 ===== */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold tracking-tight">{t('exclusions.ai_title')}</h2>
            <p className="text-xs text-muted-foreground">{t('exclusions.ai_subtitle')}</p>
          </div>
          {messages.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={clearChat} disabled={busy}>
              {t('exclusions.ai_clear')}
            </Button>
          )}
        </div>

        <div
          ref={chatScrollRef}
          className="max-h-[360px] min-h-[120px] space-y-4 overflow-y-auto rounded-xl border border-white/5 bg-black/20 p-4"
        >
          {messages.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">{t('exclusions.ai_no_rules_yet')}</div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  msg.role === 'user' ? 'bg-white/10 text-foreground' : 'bg-primary/10 text-primary',
                )}
              >
                {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>
              <div className={cn('min-w-0 max-w-[85%] space-y-2', msg.role === 'user' && 'items-end text-right')}>
                <div
                  className={cn(
                    'inline-block rounded-2xl px-3.5 py-2 text-sm',
                    msg.role === 'user'
                      ? 'bg-primary/15 text-foreground'
                      : msg.error
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-white/[0.04] text-foreground',
                  )}
                >
                  {msg.generating ? (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('exclusions.ai_generating')}
                    </span>
                  ) : (
                    msg.text
                  )}
                </div>

                {msg.rules && msg.rules.length > 0 && (
                  <>
                    <div className="space-y-2 text-left">
                      {msg.rules.map((r, i) => {
                        const key = `${msg.id}__${i}`
                        const checked = !!selected[key]
                        return (
                          <div
                            key={i}
                            className={cn(
                              'flex items-start gap-2.5 rounded-xl border p-2.5 transition',
                              r.added
                                ? 'border-emerald-500/30 bg-emerald-500/[0.04] opacity-70'
                                : checked
                                  ? 'border-primary/40 bg-primary/[0.04]'
                                  : 'border-white/10 bg-white/[0.02]',
                            )}
                          >
                            <button
                              type="button"
                              disabled={r.added}
                              onClick={() => toggleRule(msg.id, i)}
                              className={cn(
                                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
                                r.added
                                  ? 'border-emerald-500/40 bg-emerald-500/20'
                                  : checked
                                    ? 'border-primary bg-primary text-white'
                                    : 'border-white/20 bg-transparent hover:border-primary/50',
                              )}
                              aria-label={t('exclusions.ai_pattern')}
                            >
                              {r.added ? <Check className="h-3 w-3 text-emerald-300" /> : checked && <Check className="h-3.5 w-3.5" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-xs" title={r.pattern}>
                                {r.pattern}
                              </div>
                              {r.reason && <div className="mt-0.5 text-xs text-muted-foreground">{r.reason}</div>}
                            </div>
                            {r.added && (
                              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                                {t('exclusions.ai_added_badge')}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    <div className="flex items-center justify-end gap-2 text-left">
                      <Button type="button" variant="ghost" size="sm" onClick={() => toggleAllFor(msg)}>
                        <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                        {allUnaddedSelected(msg) ? t('exclusions.ai_deselect_all') : t('exclusions.ai_select_all')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => addSelected(msg)}
                        disabled={selectedRulesFor(msg).length === 0}
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                        {t('exclusions.ai_add_selected')}
                        {selectedRulesFor(msg).length > 0 ? ` (${selectedRulesFor(msg).length})` : ''}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Input
            placeholder={t('exclusions.ai_placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            disabled={busy}
          />
          <Button type="button" onClick={sendMessage} disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {t('exclusions.ai_send')}
          </Button>
        </div>
        {batchMessage && <p className="mt-2 break-all text-xs text-emerald-400">{batchMessage}</p>}
      </section>

      {/* ===== 手动添加 ===== */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Filter className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold tracking-tight">{t('exclusions.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('exclusions.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleExport}>
              <Download className="h-4 w-4" />
              {t('exclusions.export')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {t('exclusions.import')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
        </div>

        <form onSubmit={handleAdd} className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground">{t('exclusions.pattern')}</label>
            <Input
              placeholder={t('exclusions.pattern_placeholder')}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground">{t('exclusions.reason')}</label>
            <Input
              placeholder={t('exclusions.reason_placeholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button type="submit" className="gap-2">
            <Plus className="h-4 w-4" />
            {t('exclusions.add')}
          </Button>
        </form>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        {message && <p className="mt-2 break-all text-xs text-emerald-400">{message}</p>}
      </section>

      <section className="glass rounded-2xl border border-white/5">
        <div className="grid grid-cols-12 gap-4 border-b border-white/5 px-5 py-3 text-xs font-medium text-muted-foreground">
          <div className="col-span-5">{t('exclusions.column_rule')}</div>
          <div className="col-span-4">{t('exclusions.column_reason')}</div>
          <div className="col-span-2 text-center">{t('exclusions.column_enabled')}</div>
          <div className="col-span-1"></div>
        </div>
        {rules.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">{t('exclusions.no_rules')}</div>
        )}
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={cn(
              'grid grid-cols-12 items-center gap-4 border-b border-white/5 px-5 py-3 text-sm last:border-0',
              !rule.enabled && 'opacity-60',
            )}
          >
            <div className="col-span-5 truncate font-mono text-xs" title={rule.pattern}>
              {rule.pattern}
            </div>
            <div className="col-span-4 truncate text-muted-foreground" title={rule.reason}>
              {rule.reason || '-'}
            </div>
            <div className="col-span-2 flex justify-center">
              <Switch checked={!!rule.enabled} onCheckedChange={() => toggleRule2(rule)} />
            </div>
            <div className="col-span-1 flex items-center justify-end gap-2">
              {rule.is_default ? (
                <span className="rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-[11px] font-medium text-primary/80">
                  {t('exclusions.builtin')}
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteRule(rule.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
