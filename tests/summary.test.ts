import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../electron/main/schema'
import { ReportService } from '../electron/main/services/report'
import { SummaryService } from '../electron/main/services/summary'
import type { Project, SummaryReport } from '../shared/types'

const AUTHOR = 'tester'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

function makeProject(db: Database.Database): Project {
  db.prepare(
    `INSERT INTO project (key, name, backend_repo, git_author, created_at) VALUES ('t', 'T', NULL, ?, '2026-09-01T00:00:00Z')`
  ).run(AUTHOR)
  return db.prepare('SELECT * FROM project').get() as Project
}

function seedDay(reports: ReportService, projectId: number, date: string, summary: string[]): void {
  reports.upsert(projectId, {
    date,
    summary,
    commits: [{ hash: 'h' + date.replace(/-/g, ''), time: '10:00', message: 'feat: ' + date, repo: 'backend' }],
    stat_backend: { files: 1, insertions: 10, deletions: 2 },
    stat_frontend: null,
    content_md: ''
  })
}

describe('SummaryService', () => {
  let db: Database.Database
  let reports: ReportService
  let project: Project
  let logs: string[]

  beforeEach(() => {
    db = makeDb()
    reports = new ReportService(db)
    project = makeProject(db)
    logs = []
  })

  it('成功路径：聚合区间日报 → claude 归纳 → 落库', async () => {
    seedDay(reports, project.id, '2026-09-01', ['第一天做了 A'])
    seedDay(reports, project.id, '2026-09-02', ['第二天继续 A 并完成 B'])
    const fakeClaude = async () =>
      JSON.stringify({ result: JSON.stringify({ summary: ['完成 A 功能开发', '完成 B'] }) })
    const svc = new SummaryService(db, reports, () => project, fakeClaude)

    const r = await svc.generate(project.id, 'week', '2026-09-01', '2026-09-02', (l) => logs.push(l))
    expect(r.status).toBe('success')

    const list = svc.list(project.id)
    expect(list).toHaveLength(1)
    const row = svc.get(list[0].id) as SummaryReport
    expect(row.summary).toEqual(['完成 A 功能开发', '完成 B'])
    expect(row.daily_count).toBe(2)
    expect(row.commit_count).toBe(2)
    expect(row.kind).toBe('week')
    expect(row.detail_md).toContain('汇总报告（2026-09-01 ~ 2026-09-02）')
    expect(row.detail_md).toContain('- 2026-09-02：1 提交，+10/-2')
  })

  it('同区间重复生成：替换不重复', async () => {
    seedDay(reports, project.id, '2026-09-01', ['d1'])
    let n = 0
    const fakeClaude = async () => {
      n++
      return JSON.stringify({ result: JSON.stringify({ summary: [`第 ${n} 版`] }) })
    }
    const svc = new SummaryService(db, reports, () => project, fakeClaude)
    await svc.generate(project.id, 'month', '2026-09-01', '2026-09-30', () => {})
    await svc.generate(project.id, 'month', '2026-09-01', '2026-09-30', () => {})
    const list = svc.list(project.id)
    expect(list).toHaveLength(1)
    expect(svc.get(list[0].id)!.summary).toEqual(['第 2 版'])
  })

  it('区间无日报：失败且信息明确', async () => {
    const svc = new SummaryService(db, reports, () => project, async () => '{}')
    const r = await svc.generate(project.id, 'week', '2020-01-01', '2020-01-07', () => {})
    expect(r.status).toBe('failed')
    expect(r.message).toContain('没有任何日报')
    expect(svc.list(project.id)).toHaveLength(0)
  })

  it('缺失日提示：missingDates 列出区间内无日报的日期', async () => {
    seedDay(reports, project.id, '2026-09-01', ['d1'])
    seedDay(reports, project.id, '2026-09-03', ['d3'])
    const svc = new SummaryService(
      db,
      reports,
      () => project,
      async () => JSON.stringify({ result: '{"summary":["要点"]}' })
    )
    expect(svc.missingDates(project.id, '2026-09-01', '2026-09-03')).toEqual(['2026-09-02'])

    // 跳过缺失天生成成功
    const ok = await svc.generate(project.id, 'week', '2026-09-01', '2026-09-03', (l) => logs.push(l))
    expect(ok.status).toBe('success')
    expect(logs.some((l) => l.includes('2026-09-02'))).toBe(true)
    const row = svc.get(svc.list(project.id)[0].id)!
    expect(row.daily_count).toBe(2)
  })

  it('claude 失败：failed 且不入库', async () => {
    seedDay(reports, project.id, '2026-09-01', ['d1'])
    const bad = async () => {
      throw new Error('claude 退出码 1')
    }
    const svc = new SummaryService(db, reports, () => project, bad)
    const r = await svc.generate(project.id, 'week', '2026-09-01', '2026-09-01', () => {})
    expect(r.status).toBe('failed')
    expect(svc.list(project.id)).toHaveLength(0)
  })

  it('区间顺序错误：失败', async () => {
    const svc = new SummaryService(db, reports, () => project, async () => '{}')
    const r = await svc.generate(project.id, 'week', '2026-09-10', '2026-09-01', () => {})
    expect(r.status).toBe('failed')
    expect(r.message).toContain('区间无效')
  })

  it('delete 删除汇总', async () => {
    seedDay(reports, project.id, '2026-09-01', ['d1'])
    const svc = new SummaryService(
      db,
      reports,
      () => project,
      async () => JSON.stringify({ result: '{"summary":["x"]}' })
    )
    await svc.generate(project.id, 'week', '2026-09-01', '2026-09-01', () => {})
    const id = svc.list(project.id)[0].id
    expect(svc.delete(id)).toBe(true)
    expect(svc.list(project.id)).toHaveLength(0)
    expect(svc.delete(id)).toBe(false)
  })
})
