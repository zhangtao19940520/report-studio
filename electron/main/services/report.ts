import type Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type { CommitItem, ReportDetail, ReportIndex, Stat } from '../../../shared/types'
import { parseReport } from './reportParser'

export class ReportService {
  constructor(private db: Database.Database) {}

  list(projectId: number): ReportIndex[] {
    return this.db
      .prepare('SELECT * FROM report WHERE project_id = ? ORDER BY report_date DESC')
      .all(projectId) as ReportIndex[]
  }

  get(projectId: number, date: string): ReportDetail | undefined {
    const row = this.db
      .prepare('SELECT * FROM report WHERE project_id = ? AND report_date = ?')
      .get(projectId, date) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      ...row,
      summary: JSON.parse((row.summary as string) || '[]'),
      commits: JSON.parse((row.commits as string) || '[]') as CommitItem[],
      stat_backend: row.stat_backend ? (JSON.parse(row.stat_backend as string) as Stat) : null,
      stat_frontend: row.stat_frontend ? (JSON.parse(row.stat_frontend as string) as Stat) : null
    } as unknown as ReportDetail
  }

  delete(projectId: number, date: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM report WHERE project_id = ? AND report_date = ?')
        .run(projectId, date).changes > 0
    )
  }

  upsert(
    projectId: number,
    day: {
      date: string
      summary: string[]
      commits: CommitItem[]
      stat_backend: Stat | null
      stat_frontend: Stat | null
      content_md: string
    }
  ): void {
    const stats = [day.stat_backend, day.stat_frontend].filter(Boolean) as Stat[]
    const files = stats.reduce((s, x) => s + x.files, 0)
    const ins = stats.reduce((s, x) => s + x.insertions, 0)
    const del = stats.reduce((s, x) => s + x.deletions, 0)
    this.db
      .prepare(
        `INSERT INTO report
           (project_id, report_date, summary, commits, stat_backend, stat_frontend,
            content_md, commit_count, files, insertions, deletions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, report_date) DO UPDATE SET
           summary = excluded.summary,
           commits = excluded.commits,
           stat_backend = excluded.stat_backend,
           stat_frontend = excluded.stat_frontend,
           content_md = excluded.content_md,
           commit_count = excluded.commit_count,
           files = excluded.files,
           insertions = excluded.insertions,
           deletions = excluded.deletions`
      )
      .run(
        projectId,
        day.date,
        JSON.stringify(day.summary),
        JSON.stringify(day.commits),
        day.stat_backend ? JSON.stringify(day.stat_backend) : null,
        day.stat_frontend ? JSON.stringify(day.stat_frontend) : null,
        day.content_md,
        day.commits.length,
        files,
        ins,
        del
      )
  }

  /**
   * 一次性导入：扫描 reportsDir 下 {key}_work_report.md 并解析入库。
   * 幂等：按 (project_id, report_date) upsert，可重复执行。
   * 返回 { key, days } 列表。
   */
  importFromMd(
    reportsDir: string,
    projects: { id: number; key: string }[]
  ): { key: string; days: number }[] {
    const results: { key: string; days: number }[] = []
    for (const p of projects) {
      const file = path.join(reportsDir, `${p.key}_work_report.md`)
      if (!fs.existsSync(file)) continue
      const days = parseReport(fs.readFileSync(file, 'utf-8'))
      for (const d of days) {
        this.upsert(p.id, {
          date: d.date,
          summary: d.summary,
          commits: d.commits,
          stat_backend: d.stat_backend,
          stat_frontend: d.stat_frontend,
          content_md: d.raw
        })
      }
      results.push({ key: p.key, days: days.length })
    }
    return results
  }
}
