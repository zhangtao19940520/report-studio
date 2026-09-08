import type Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import type { CommitItem, Project, ReportDetail, Stat } from '../../../shared/types'
import { ReportService } from './report'

export type ExportFormat = 'md' | 'excel' | 'pdf'

export interface ExportPayload {
  md: string
  excel: Buffer
  html: string // pdf 由渲染层打印
  filenameBase: string
}

function statLine(s: Stat | null): string {
  return s ? `${s.files} 个文件变更，+${s.insertions} 行，-${s.deletions} 行` : '无'
}

export function buildMarkdown(project: Project, reports: ReportDetail[]): string {
  const head = `# ${project.name} 工作日报\n`
  return (
    head +
    reports
      .map((r) => {
        const group = (repo: 'backend' | 'frontend', label: string) => {
          const rows = r.commits.filter((c: CommitItem) => c.repo === repo)
          if (rows.length === 0) return `- **${label}**：\n- 无`
          return `- **${label}**：\n${rows.map((c) => `- \`${c.hash}\` ${c.time} ${c.message}`).join('\n')}`
        }
        return [
          `## ${r.report_date}`,
          '',
          '### 今日工作总结',
          ...r.summary.map((s, i) => `${i + 1}. ${s}`),
          '',
          '### 代码提交明细',
          group('backend', '后端'),
          group('frontend', '前端'),
          '',
          '### 变更统计',
          `- 后端：${statLine(r.stat_backend)}`,
          `- 前端：${statLine(r.stat_frontend)}`
        ].join('\n')
      })
      .join('\n\n')
  )
}

export async function buildExcel(project: Project, reports: ReportDetail[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = '日报工作台'

  const summary = wb.addWorksheet('总结')
  summary.columns = [
    { header: '日期', key: 'date', width: 12 },
    { header: '工作总结', key: 'summary', width: 80 },
    { header: '提交数', key: 'commits', width: 8 },
    { header: '变更统计', key: 'stat', width: 30 }
  ]
  for (const r of reports) {
    summary.addRow({
      date: r.report_date,
      summary: r.summary.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      commits: r.commit_count,
      stat: `后端：${statLine(r.stat_backend)}；前端：${statLine(r.stat_frontend)}`
    })
  }

  const commits = wb.addWorksheet('提交明细')
  commits.columns = [
    { header: '日期', key: 'date', width: 12 },
    { header: '仓库', key: 'repo', width: 8 },
    { header: 'Hash', key: 'hash', width: 12 },
    { header: '时间', key: 'time', width: 8 },
    { header: 'Message', key: 'msg', width: 90 }
  ]
  for (const r of reports) {
    for (const c of r.commits) {
      commits.addRow({
        date: r.report_date,
        repo: c.repo === 'backend' ? '后端' : '前端',
        hash: c.hash,
        time: c.time,
        msg: c.message
      })
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

export function buildHtml(project: Project, reports: ReportDetail[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const days = reports
    .map(
      (r) => `
    <section>
      <h1>${esc(r.report_date)}</h1>
      <h2>今日工作总结</h2>
      <ol>${r.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <h2>代码提交明细</h2>
      <table>
        <tr><th>仓库</th><th>Hash</th><th>时间</th><th>Message</th></tr>
        ${r.commits
          .map(
            (c) =>
              `<tr><td>${c.repo === 'backend' ? '后端' : '前端'}</td><td>${c.hash}</td><td>${c.time}</td><td>${esc(c.message)}</td></tr>`
          )
          .join('')}
        ${r.commits.length === 0 ? '<tr><td colspan="4">无</td></tr>' : ''}
      </table>
      <h2>变更统计</h2>
      <p>后端：${statLine(r.stat_backend)}　前端：${statLine(r.stat_frontend)}</p>
    </section>`
    )
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(project.name)} 工作日报</title>
  <style>
    body { font-family: 'PingFang SC', sans-serif; padding: 40px; color: #2b2e34; }
    h1 { font-size: 22px; border-bottom: 2px solid #e05d38; padding-bottom: 6px; margin-top: 32px; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    li { line-height: 1.8; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
    th { background: #f5f3ec; }
    p { font-size: 13px; }
    @media print { h1:first-of-type { margin-top: 0; } }
  </style></head><body>${days}</body></html>`
}

export class ExportService {
  constructor(
    private db: Database.Database,
    private reports: ReportService,
    private getProject: (id: number) => Project | undefined
  ) {}

  /** 导出单日或日期区间（from/to 含端点） */
  async build(
    projectId: number,
    from: string,
    to: string,
    format: ExportFormat
  ): Promise<
    { ok: true; data: Buffer | string; filenameBase: string } | { ok: false; message: string }
  > {
    const project = this.getProject(projectId)
    if (!project) return { ok: false, message: '项目不存在' }
    const rows = this.reports.list(projectId).filter((r) => r.report_date >= from && r.report_date <= to)
    if (rows.length === 0) return { ok: false, message: '所选范围内没有日报' }
    const details = rows
      .map((r) => this.reports.get(projectId, r.report_date)!)
      .sort((a, b) => (a.report_date < b.report_date ? -1 : 1))

    const filenameBase =
      from === to ? `${project.key}_work_report_${from}` : `${project.key}_work_report_${from}_${to}`

    if (format === 'md') {
      return { ok: true, data: buildMarkdown(project, details), filenameBase }
    }
    if (format === 'excel') {
      return { ok: true, data: await buildExcel(project, details), filenameBase }
    }
    return { ok: true, data: buildHtml(project, details), filenameBase }
  }
}
