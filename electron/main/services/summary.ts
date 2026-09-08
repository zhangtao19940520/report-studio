import type Database from 'better-sqlite3'
import type { Project, ReportDetail, SummaryKind, SummaryReport } from '../../../shared/types'
import { ReportService } from './report'
import { claudeCliRunner, type LlmRunner } from './llm'

export interface SummaryResult {
  status: 'success' | 'failed'
  message: string
  missingDates?: string[]
}

function buildSummaryPrompt(project: Project, from: string, to: string, days: ReportDetail[]): string {
  const dayBlocks = days
    .map((d) => {
      const commits = d.commits.map((c) => `- \`${c.hash}\` ${c.time} ${c.message}`).join('\n')
      return `【${d.report_date}】\n总结：\n${d.summary.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n提交：\n${commits || '无'}`
    })
    .join('\n\n')
  return `你是工作周报/月报生成助手。以下是 ${project.name} 项目 ${from} ~ ${to} 期间的工作日报数据（已由外部采集，无需执行任何命令）：

${dayBlocks}

请把这段时间的工作归纳为一份汇报要点：
- 3~8 条，按主题/模块归纳（如某功能的多天演进合并为一条），不要逐日罗列
- 每条说明做了什么、达到什么效果，语言精炼、面向上级阅读
- 可在最后加一条「其他」收纳零散事项

只返回一个 JSON 对象，格式：{"summary": ["要点1", "要点2"]}，不要输出任何其他内容。`
}

function extractSummary(raw: string): string[] {
  let text = raw
  try {
    const outer = JSON.parse(raw) as { result?: string }
    if (outer.result) text = outer.result
  } catch {
    // 非 JSON 包裹，直接按模型文本处理
  }
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as { summary?: unknown }
      if (Array.isArray(parsed.summary)) {
        return parsed.summary.map(String).filter((s) => s.trim() !== '')
      }
    } catch {
      // 继续降级
    }
  }
  throw new Error(`AI 输出无法解析为 JSON：${text.slice(0, 200)}`)
}

function buildDetailMd(
  project: Project,
  from: string,
  to: string,
  days: ReportDetail[],
  summary: string[]
): string {
  const lines = [
    `# ${project.name} 汇总报告（${from} ~ ${to}）`,
    '',
    '## 汇总要点',
    ...summary.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## 分日概览'
  ]
  for (const d of days) {
    const ins = (d.stat_backend?.insertions ?? 0) + (d.stat_frontend?.insertions ?? 0)
    const del = (d.stat_backend?.deletions ?? 0) + (d.stat_frontend?.deletions ?? 0)
    lines.push(`- ${d.report_date}：${d.commit_count} 提交，+${ins}/-${del}。${d.summary[0] ?? '无代码提交'}`)
  }
  return lines.join('\n')
}

export class SummaryService {
  constructor(
    private db: Database.Database,
    private reports: ReportService,
    private getProject: (id: number) => Project | undefined,
    private claudeRunner: LlmRunner = claudeCliRunner
  ) {}

  /** 区间内缺日报的日期列表（仅统计已有日报首尾之间的空洞更贴合直觉；这里直接列出区间内全部缺失日） */
  missingDates(projectId: number, from: string, to: string): string[] {
    const have = new Set(
      (this.reports.list(projectId) as { report_date: string }[])
        .filter((r) => r.report_date >= from && r.report_date <= to)
        .map((r) => r.report_date)
    )
    const missing: string[] = []
    const cur = new Date(from + 'T00:00:00')
    const end = new Date(to + 'T00:00:00')
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    while (cur <= end) {
      const s = fmt(cur)
      if (!have.has(s)) missing.push(s)
      cur.setDate(cur.getDate() + 1)
    }
    return missing
  }

  list(projectId: number): SummaryReport[] {
    return this.db
      .prepare('SELECT * FROM summary_report WHERE project_id = ? ORDER BY date_to DESC, id DESC')
      .all(projectId) as SummaryReport[]
  }

  get(id: number): SummaryReport | undefined {
    const row = this.db.prepare('SELECT * FROM summary_report WHERE id = ?').get(id) as
      | (Omit<SummaryReport, 'summary'> & { summary: string })
      | undefined
    if (!row) return undefined
    return { ...row, summary: JSON.parse(row.summary || '[]') }
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM summary_report WHERE id = ?').run(id).changes > 0
  }

  async generate(
    projectId: number,
    kind: SummaryKind,
    from: string,
    to: string,
    onLog: (line: string) => void
  ): Promise<SummaryResult> {
    const project = this.getProject(projectId)
    if (!project) return { status: 'failed', message: '项目不存在' }
    if (from > to) return { status: 'failed', message: '区间无效：开始日期晚于结束日期' }

    const days = this.reports
      .list(projectId)
      .filter((r) => r.report_date >= from && r.report_date <= to)
      .map((r) => this.reports.get(projectId, r.report_date)!)
      .sort((a, b) => (a.report_date < b.report_date ? -1 : 1))

    if (days.length === 0) {
      return { status: 'failed', message: `${from} ~ ${to} 区间内没有任何日报，请先生成日报` }
    }
    const missing = this.missingDates(projectId, from, to)
    if (missing.length > 0) {
      onLog(`注意：区间内有 ${missing.length} 天缺日报（${missing.join('、')}），将跳过这些天`)
    }

    try {
      onLog(`[${project.key}] 汇总 ${from} ~ ${to}（${days.length} 天日报）`)
      onLog(`[${project.key}] 调用 AI 归纳汇总要点…`)
      const raw = await this.claudeRunner(buildSummaryPrompt(project, from, to, days), onLog)
      const summary = extractSummary(raw)
      const commitCount = days.reduce((s, d) => s + d.commit_count, 0)
      const detailMd = buildDetailMd(project, from, to, days, summary)

      // 同区间重建：生成成功后才替换旧记录（失败保留旧版）
      this.db
        .prepare('DELETE FROM summary_report WHERE project_id = ? AND kind = ? AND date_from = ? AND date_to = ?')
        .run(projectId, kind, from, to)
      this.db
        .prepare(
          `INSERT INTO summary_report
             (project_id, kind, date_from, date_to, summary, detail_md, daily_count, commit_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          projectId,
          kind,
          from,
          to,
          JSON.stringify(summary),
          detailMd,
          days.length,
          commitCount,
          new Date().toISOString()
        )
      const msg = `[${project.key}] 汇总完成：${summary.length} 条要点，覆盖 ${days.length} 天`
      onLog(msg)
      return { status: 'success', message: msg }
    } catch (e) {
      const msg = `[${project.key}] 汇总生成失败：${String(e)}`
      onLog(msg)
      return { status: 'failed', message: msg }
    }
  }
}
