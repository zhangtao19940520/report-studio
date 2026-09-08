import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../electron/main/schema'
import { ReportService } from '../electron/main/services/report'
import { ExportService, buildMarkdown, buildExcel, buildHtml } from '../electron/main/services/export'
import type { Project, ReportDetail } from '../shared/types'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

const project: Project = {
  id: 1,
  key: 'demo-a',
  name: 'Demo-A',
  subtitle: null,
  backend_repo: '/a',
  frontend_repo: '/b',
  git_author: 'demo-user',
  created_at: '2026-09-04T00:00:00Z'
}

function makeDetail(overrides: Partial<ReportDetail> = {}): ReportDetail {
  return {
    id: 1,
    project_id: 1,
    report_date: '2026-09-04',
    summary: ['完成了 A', '修复了 B'],
    commits: [
      { hash: 'abc1234', time: '10:00', message: 'feat: A', repo: 'backend' },
      { hash: 'def5678', time: '11:00', message: 'fix: B', repo: 'frontend' }
    ],
    stat_backend: { files: 4, insertions: 212, deletions: 112 },
    stat_frontend: null,
    content_md: '',
    commit_count: 2,
    files: 4,
    insertions: 212,
    deletions: 112,
    ...overrides
  }
}

describe('导出内容生成', () => {
  it('buildMarkdown：格式与既有日报一致（编号总结 + 提交明细 + 统计）', () => {
    const md = buildMarkdown(project, [makeDetail()])
    expect(md).toContain('# Demo-A 工作日报')
    expect(md).toContain('## 2026-09-04')
    expect(md).toContain('1. 完成了 A')
    expect(md).toContain('2. 修复了 B')
    expect(md).toContain('- `abc1234` 10:00 feat: A')
    expect(md).toContain('- 后端：4 个文件变更，+212 行，-112 行')
    expect(md).toContain('- 前端：无')
  })

  it('buildMarkdown：多天日报按日期拼接', () => {
    const md = buildMarkdown(project, [
      makeDetail({ report_date: '2026-09-03', summary: ['x'] }),
      makeDetail({ report_date: '2026-09-04' })
    ])
    expect(md.indexOf('## 2026-09-03')).toBeLessThan(md.indexOf('## 2026-09-04'))
  })

  it('buildExcel：生成合法 xlsx Buffer（含两个 sheet）', async () => {
    const buf = await buildExcel(project, [makeDetail()])
    expect(buf.length).toBeGreaterThan(1000)
    // xlsx 是 zip，魔数 PK
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('buildHtml：HTML 转义防注入，含提交表格', () => {
    const html = buildHtml(project, [
      makeDetail({
        summary: ['<script>alert(1)</script>'],
        commits: [{ hash: 'aaa', time: '09:00', message: 'x < y & z', repo: 'backend' }]
      })
    ])
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('x &lt; y &amp; z')
  })
})

describe('ExportService.build', () => {
  it('从数据库读取并按区间过滤', async () => {
    const db = makeDb()
    db.prepare(
      `INSERT INTO project (key, name, backend_repo, git_author, created_at) VALUES ('demo-a', 'Demo-A', '/a', 'za', '2026-09-04T00:00:00Z')`
    ).run()
    const reports = new ReportService(db)
    reports.upsert(1, {
      date: '2026-09-03',
      summary: ['d3'],
      commits: [],
      stat_backend: null,
      stat_frontend: null,
      content_md: ''
    })
    reports.upsert(1, {
      date: '2026-09-04',
      summary: ['d4'],
      commits: [{ hash: 'h1', time: '10:00', message: 'feat: x', repo: 'backend' }],
      stat_backend: { files: 1, insertions: 2, deletions: 3 },
      stat_frontend: null,
      content_md: ''
    })
    const svc = new ExportService(db, reports, () => project)

    const md = await svc.build(1, '2026-09-01', '2026-09-30', 'md')
    expect(md.ok).toBe(true)
    if (md.ok) {
      expect(String(md.data)).toContain('2026-09-03')
      expect(String(md.data)).toContain('2026-09-04')
      expect(md.filenameBase).toBe('demo-a_work_report_2026-09-01_2026-09-30')
    }

    const single = await svc.build(1, '2026-09-04', '2026-09-04', 'excel')
    expect(single.ok).toBe(true)
    if (single.ok) expect(single.filenameBase).toBe('demo-a_work_report_2026-09-04')
  })

  it('范围内无日报返回失败信息', async () => {
    const db = makeDb()
    const reports = new ReportService(db)
    const svc = new ExportService(db, reports, () => project)
    const r = await svc.build(1, '2020-01-01', '2020-01-02', 'md')
    expect(r).toEqual({ ok: false, message: '所选范围内没有日报' })
  })

  it('项目不存在返回失败', async () => {
    const db = makeDb()
    const svc = new ExportService(db, new ReportService(db), () => undefined)
    const r = await svc.build(99, '2026-09-04', '2026-09-04', 'md')
    expect(r.ok).toBe(false)
  })
})
