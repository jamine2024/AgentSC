import { useMemo, useState } from 'react'
import {
  Calendar,
  FileSearch,
  Trash2,
  FileEdit,
  FilePlus,
  Loader2,
  Sparkles,
  Brain,
  AlertTriangle,
  Lightbulb,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatBytes } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { ReportData, ReportType, AiInsightsResult } from '@/App'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'

/* ───────────────────────────── Report helpers ───────────────────────────── */

function toDayString(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWeekRange(date: Date) {
  const day = date.getDay()
  const diffToMonday = (day === 0 ? -6 : 1) - day
  const start = new Date(date)
  start.setDate(date.getDate() + diffToMonday)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { startDay: toDayString(start), endDay: toDayString(end) }
}

function getMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0)
  return { startDay: toDayString(start), endDay: toDayString(end) }
}

function StatCard({ label, value, sub, icon: Icon, tone = 'primary' }: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  tone?: 'primary' | 'accent' | 'destructive' | 'amber'
}) {
  const toneClasses = {
    primary: 'bg-primary/10 text-primary',
    accent: 'bg-purple-500/10 text-purple-400',
    destructive: 'bg-destructive/10 text-destructive',
    amber: 'bg-amber-500/10 text-amber-400',
  }
  return (
    <div className="glass rounded-2xl border border-white/5 p-4 transition hover:scale-[1.01]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-2 text-xl font-bold tracking-tight">{value}</div>
          {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        </div>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-xl', toneClasses[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── AI Insights helpers ───────────────────────── */

interface Anomaly {
  title: string
  description: string
  severity: 'low' | 'medium' | 'high'
}

function SeverityBadge({ severity }: { severity: Anomaly['severity'] }) {
  const { t } = useI18n()
  const config = useMemo(() => ({
    low: { label: t('severity.low'), class: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    medium: { label: t('severity.medium'), class: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    high: { label: t('severity.high'), class: 'bg-red-500/10 text-red-400 border-red-500/20' },
  }), [t])
  const c = config[severity]
  return (
    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', c.class)}>
      {c.label}
    </span>
  )
}

function SourceBadge({ source, model }: { source: AiInsightsResult['source']; model?: string }) {
  const { t } = useI18n()
  const labels = useMemo(() => ({
    ollama: t('ai.source.ollama'),
    openai: t('ai.source.openai'),
    heuristic: t('ai.source.heuristic'),
  }), [t])
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-muted-foreground">
      <Sparkles className="h-3 w-3 text-primary" />
      {labels[source as keyof typeof labels] || source}
      {model && ` · ${model}`}
    </span>
  )
}

/* ───────────────────────────── Merged page ───────────────────────────── */

export default function ReportsInsights({
  report,
  reportType,
  reportDateValue,
  reportMonthValue,
  reportLoading,
  reportError,
  onReportChange,
  onReportTypeChange,
  onReportDateValueChange,
  onReportMonthValueChange,
  onReportLoadingChange,
  onReportErrorChange,
  aiResult,
  aiLoading,
  onAiResultChange,
  onAiLoadingChange,
}: {
  report: ReportData | null
  reportType: ReportType
  reportDateValue: string
  reportMonthValue: string
  reportLoading: boolean
  reportError: string
  onReportChange: (v: ReportData | null) => void
  onReportTypeChange: (v: ReportType) => void
  onReportDateValueChange: (v: string) => void
  onReportMonthValueChange: (v: string) => void
  onReportLoadingChange: (v: boolean) => void
  onReportErrorChange: (v: string) => void
  aiResult: AiInsightsResult | null
  aiLoading: boolean
  onAiResultChange: (v: AiInsightsResult | null) => void
  onAiLoadingChange: (v: boolean) => void
}) {
  const { t } = useI18n()
  const api = window.electronAPI

  /* ── Report state ── */
  const [exporting, setExporting] = useState(false)
  const [reportMessage, setReportMessage] = useState('')

  const rangeLabel = useMemo(() => {
    if (report) return `${report.startDay} ~ ${report.endDay}`
    if (reportType === 'day') return reportDateValue
    if (reportType === 'week') {
      const { startDay, endDay } = getWeekRange(new Date(reportDateValue))
      return `${startDay} ~ ${endDay}`
    }
    const [year, month] = reportMonthValue.split('-').map(Number)
    const { startDay, endDay } = getMonthRange(year, month)
    return `${startDay} ~ ${endDay}`
  }, [report, reportType, reportDateValue, reportMonthValue])

  const chartData = useMemo(() => {
    if (!report) return []
    const created = t('reports.created')
    const deleted = t('reports.deleted')
    const modified = t('reports.modified')
    return report.daily.map((d) => ({
      day: d.day.slice(5),
      [created]: d.created_count,
      [deleted]: d.deleted_count,
      [modified]: d.modified_count,
    }))
  }, [report, t])

  async function handleGenerateReport() {
    onReportLoadingChange(true)
    onReportErrorChange('')
    onReportChange(null)
    setReportMessage('')
    try {
      let startDay = reportDateValue
      let endDay = reportDateValue
      if (reportType === 'week') {
        const range = getWeekRange(new Date(reportDateValue))
        startDay = range.startDay
        endDay = range.endDay
      } else if (reportType === 'month') {
        const [year, month] = reportMonthValue.split('-').map(Number)
        const range = getMonthRange(year, month)
        startDay = range.startDay
        endDay = range.endDay
      }
      const result = await api?.invoke('generate-report', startDay, endDay)
      if (result && typeof result === 'object') {
        onReportChange(result as ReportData)
      }
    } catch (err) {
      onReportErrorChange(t('reports.generate_failed') + '：' + String(err))
    } finally {
      onReportLoadingChange(false)
    }
  }

  async function handleExportReport() {
    if (!report) return
    setExporting(true)
    setReportMessage('')
    try {
      const name = `agentsc-report-${report.startDay}-${report.endDay}.json`
      const res = (await api?.invoke('export-events', [report], name)) as
        | { canceled: boolean; filePath: string | null }
        | undefined
      if (res && !res.canceled && res.filePath) {
        setReportMessage(t('reports.exported_to') + ' ' + res.filePath)
      }
    } catch (err) {
      setReportMessage(t('reports.export_failed') + '：' + String(err))
    } finally {
      setExporting(false)
    }
  }

  /* ── AI Insights state ── */
  const [aiMessage, setAiMessage] = useState('')
  const [aiIsError, setAiIsError] = useState(false)

  async function handleGenerateInsights() {
    onAiLoadingChange(true)
    setAiMessage('')
    setAiIsError(false)
    try {
      const res = await api?.invoke('get-ai-insights', true)
      if (res && typeof res === 'object') {
        onAiResultChange(res as AiInsightsResult)
      }
    } catch (err) {
      setAiMessage(t('ai.generate_failed') + '：' + String(err))
      setAiIsError(true)
    } finally {
      onAiLoadingChange(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ════════════════ 汇报中心 ════════════════ */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Calendar className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{t('reports.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('reports.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-1">
            {[
              { id: 'day', label: t('reports.daily') },
              { id: 'week', label: t('reports.weekly') },
              { id: 'month', label: t('reports.monthly') },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => onReportTypeChange(tab.id as ReportType)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                  reportType === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {reportType === 'month' ? (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">{t('reports.select_month')}</label>
              <input
                type="month"
                value={reportMonthValue}
                onChange={(e) => onReportMonthValueChange(e.target.value)}
                className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                {reportType === 'day' ? t('reports.select_date') : t('reports.select_week')}
              </label>
              <input
                type="date"
                value={reportDateValue}
                onChange={(e) => onReportDateValueChange(e.target.value)}
                className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
          )}

          <Button onClick={handleGenerateReport} disabled={reportLoading}>
            {reportLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {reportLoading ? t('reports.generating') : t('reports.generate')}
          </Button>
        </div>

        {reportError && <p className="mt-3 text-xs text-destructive">{reportError}</p>}
        {report && !reportError && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2">
            <span className="text-xs text-muted-foreground">{t('reports.date_range')}：{rangeLabel}</span>
            <Button variant="outline" size="sm" disabled={exporting} onClick={handleExportReport}>
              {exporting ? t('reports.exporting') : t('reports.export_report')}
            </Button>
          </div>
        )}
        {reportMessage && (
          <p className={cn('mt-2 text-xs', reportMessage.includes('失败') ? 'text-destructive' : 'text-emerald-400')}>
            {reportMessage}
          </p>
        )}
      </section>

      {report && (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('reports.new_files')} value={report.stats.created_count.toLocaleString()} sub={formatBytes(report.stats.created_bytes)} icon={FilePlus} tone="primary" />
            <StatCard label={t('reports.deleted_files')} value={report.stats.deleted_count.toLocaleString()} sub={`${t('dashboard.freed')} ${formatBytes(report.stats.deleted_bytes)}`} icon={Trash2} tone="destructive" />
            <StatCard label={t('reports.modified_files')} value={report.stats.modified_count.toLocaleString()} icon={FileEdit} tone="amber" />
            <StatCard label={t('reports.renamed_files')} value={report.stats.renamed_count.toLocaleString()} icon={FileSearch} tone="accent" />
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 glass rounded-2xl border border-white/5 p-5">
              <h3 className="mb-4 text-sm font-semibold tracking-tight">{t('reports.daily_trend')}</h3>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(15,23,42,0.9)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '0.75rem',
                      }}
                      labelStyle={{ color: 'rgba(255,255,255,0.8)' }}
                      itemStyle={{ fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey={t('reports.created')} fill="#10b981" radius={[4, 4, 0, 0]}  isAnimationActive={false}/>
                    <Bar dataKey={t('reports.deleted')} fill="#ef4444" radius={[4, 4, 0, 0]}  isAnimationActive={false}/>
                    <Bar dataKey={t('reports.modified')} fill="#3b82f6" radius={[4, 4, 0, 0]}  isAnimationActive={false}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass rounded-2xl border border-white/5 p-5">
              <h3 className="mb-3 text-sm font-semibold tracking-tight">{t('reports.top_processes')}</h3>
              <div className="max-h-[300px] overflow-auto">
                {report.topProcesses.length > 0 ? (
                  report.topProcesses.map((p, idx) => (
                    <div
                      key={p.process_name}
                      className="flex items-center justify-between border-b border-white/5 py-2.5 last:border-0"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="truncate text-xs text-muted-foreground" title={p.process_name}>
                          {p.process_name}
                        </span>
                      </div>
                      <span className="ml-2 shrink-0 text-xs font-medium">{p.event_count}</span>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">{t('reports.no_processes')}</div>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="glass rounded-2xl border border-white/5 p-5">
              <h3 className="mb-3 text-sm font-semibold tracking-tight">{t('reports.top_created_paths')}</h3>
              <div className="max-h-[300px] overflow-auto">
                {report.topCreated.length > 0 ? (
                  report.topCreated.map((item, idx) => (
                    <div
                      key={item.path}
                      className="flex items-center justify-between border-b border-white/5 py-2.5 last:border-0"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="truncate text-xs text-muted-foreground" title={item.path}>
                          {item.path}
                        </span>
                      </div>
                      <span className="ml-2 shrink-0 text-xs font-medium">{formatBytes(item.total_size)}</span>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">{t('reports.no_created_paths')}</div>
                )}
              </div>
            </div>

            <div className="glass rounded-2xl border border-white/5 p-5">
              <h3 className="mb-3 text-sm font-semibold tracking-tight">{t('reports.top_deleted_paths')}</h3>
              <div className="max-h-[300px] overflow-auto">
                {report.topDeleted.length > 0 ? (
                  report.topDeleted.map((item, idx) => (
                    <div
                      key={item.path}
                      className="flex items-center justify-between border-b border-white/5 py-2.5 last:border-0"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="truncate text-xs text-muted-foreground" title={item.path}>
                          {item.path}
                        </span>
                      </div>
                      <span className="ml-2 shrink-0 text-xs font-medium">{formatBytes(item.total_size)}</span>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">{t('reports.no_deleted_paths')}</div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ════════════════ AI 洞察 ════════════════ */}
      <section className="glass rounded-2xl border border-white/5 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Brain className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">{t('ai.title')}</h2>
              <p className="text-xs text-muted-foreground">{t('ai.subtitle')}</p>
            </div>
          </div>
          <Button onClick={handleGenerateInsights} disabled={aiLoading}>
            {aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {aiLoading ? t('ai.generating') : t('ai.generate')}
          </Button>
        </div>

        {aiMessage && (
          <p className={cn('text-xs', aiIsError ? 'text-destructive' : 'text-emerald-400')}>
            {aiMessage}
          </p>
        )}
      </section>

      {aiLoading && !aiResult && (
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm">{t('ai.analyzing')}</p>
        </div>
      )}

      {aiResult && (
        <div className="space-y-6 animate-fade-in">
          <section className="glass rounded-2xl border border-white/5 p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">{t('ai.overall_judgment')}</h3>
              </div>
              <SourceBadge source={aiResult.source} model={aiResult.model} />
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{aiResult.summary}</p>
            {aiResult.error && (
              <p className="mt-3 text-xs text-amber-400">
                {t('ai.model_fallback')}：{aiResult.error}
              </p>
            )}
            <p className="mt-3 text-[10px] text-muted-foreground">
              {t('ai.generated_at')}：{new Date(aiResult.generatedAt).toLocaleString()}
            </p>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="glass rounded-2xl border border-white/5 p-5">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold tracking-tight">{t('ai.anomaly_detection')}</h3>
              </div>
              {aiResult.anomalies.length > 0 ? (
                <div className="space-y-3">
                  {aiResult.anomalies.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-white/5 bg-white/[0.02] p-3 transition hover:border-white/10"
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-medium break-words">{item.title}</span>
                        <SeverityBadge severity={item.severity} />
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('ai.no_anomalies')}</p>
              )}
            </div>

            <div className="glass rounded-2xl border border-white/5 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold tracking-tight">{t('ai.optimization_suggestions')}</h3>
              </div>
              {aiResult.suggestions.length > 0 ? (
                <div className="space-y-3">
                  {aiResult.suggestions.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-white/5 bg-white/[0.02] p-3 transition hover:border-white/10"
                    >
                      <div className="mb-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-sm font-medium break-words">{item.title}</span>
                        </div>
                        {item.action && (
                          <div className="mt-1 text-[10px] text-muted-foreground break-words">{item.action}</div>
                        )}
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('ai.no_suggestions')}</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
