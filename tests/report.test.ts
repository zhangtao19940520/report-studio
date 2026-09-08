import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { parseReport } from '../electron/main/services/reportParser'
import { ReportService } from '../electron/main/services/report'
import { applyMigrations } from '../electron/main/schema'

const FIXTURES = path.join(__dirname, 'fixtures')
const siemMd = fs.readFileSync(path.join(FIXTURES, 'demo-a_work_report.md'), 'utf-8')
const dlpMd = fs.readFileSync(path.join(FIXTURES, 'demo-b_work_report.md'), 'utf-8')

function openDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

describe('parseReport · 真实日报快照', () => {
  it('demo-a：解析出总结/提交/统计', () => {
    const days = parseReport(siemMd)
    expect(days).toHaveLength(1)
    const d = days[0]
    expect(d.date).toBe('2026-09-04')
    expect(d.summary).toHaveLength(2)
    expect(d.summary[0]).toContain('巡检任务内存优化')
    expect(d.commits).toHaveLength(2)
    expect(d.commits[0]).toEqual({
      hash: '4c66777',
      time: '17:02',
      message: 'perf(patrol): [DEMO-A-20260904002] 巡检任务降内存：快照批量预取消除 N+1',
      repo: 'backend'
    })
    expect(d.commits.every((c) => c.repo === 'backend')).toBe(true)
    expect(d.stat_backend).toEqual({ files: 4, insertions: 212, deletions: 112 })
    expect(d.stat_frontend).toBeNull()
    // raw 保留原文（含表头），供导出降级使用
    expect(d.raw).toContain('## 2026-09-04')
    expect(d.raw).toContain('### 变更统计')
  })

  it('demo-b：嵌套缩进的提交行同样解析', () => {
    const days = parseReport(dlpMd)
    expect(days).toHaveLength(1)
    const d = days[0]
    expect(d.date).toBe('2026-09-04')
    expect(d.summary).toHaveLength(4)
    expect(d.commits).toHaveLength(4)
    expect(d.commits[0].hash).toBe('6672744e')
    expect(d.commits[0].repo).toBe('backend')
    expect(d.commits[0].message).toContain('rate_limit')
    expect(d.stat_backend).toEqual({ files: 7, insertions: 37, deletions: 14 })
    expect(d.stat_frontend).toBeNull()
  })

  it('多天日报切分正确', () => {
    const md = `# 工作日报\n\n## 2026-09-02\n\n### 今日工作总结\n- 第一天\n\n### 代码提交明细\n- **后端**：\n- \`aaa1111\` 10:00 feat: A\n\n### 变更统计\n- 后端：1 个文件变更，+10 行，-2 行\n- 前端：无\n\n## 2026-09-03\n\n### 今日工作总结\n- 第二天\n\n### 代码提交明细\n- **前端**：\n- \`bbb2222\` 11:00 fix: B\n\n### 变更统计\n- 前端：2 个文件变更，+5 行，-1 行\n`
    const days = parseReport(md)
    expect(days).toHaveLength(2)
    expect(days[0].date).toBe('2026-09-02')
    expect(days[0].commits[0].repo).toBe('backend')
    expect(days[1].date).toBe('2026-09-03')
    expect(days[1].commits[0].repo).toBe('frontend')
    expect(days[1].stat_frontend).toEqual({ files: 2, insertions: 5, deletions: 1 })
  })
})

describe('parseReport · 容错', () => {
  it('空文件返回空数组，不抛错', () => {
    expect(parseReport('')).toEqual([])
  })

  it('只有标题没有日期小节时返回空数组', () => {
    expect(parseReport('# 工作日报\n随便写点')).toEqual([])
  })

  it('格式漂移的小节不丢数据（raw 保留）且不抛错', () => {
    const md = '## 2026-01-01\n\n### 未知小节\n- 乱格式内容\n'
    const days = parseReport(md)
    expect(days).toHaveLength(1)
    expect(days[0].summary).toEqual([])
    expect(days[0].raw).toContain('乱格式内容')
  })
})

describe('ReportService · 导入与读取', () => {
  it('importFromMd 幂等：重复导入不产生重复行', () => {
    const db = openDb()
    const info = db
      .prepare(`INSERT INTO project (key, name, created_at) VALUES ('demo-a', 'Demo-A', ?)`)
      .run('2026-09-04T00:00:00Z')
    const projectId = Number(info.lastInsertRowid)
    const svc = new ReportService(db)

    const tmpDir = fs.mkdtempSync('rs-test-')
    fs.writeFileSync(path.join(tmpDir, 'demo-a_work_report.md'), siemMd)
    const r1 = svc.importFromMd(tmpDir, [{ id: projectId, key: 'demo-a' }])
    const r2 = svc.importFromMd(tmpDir, [{ id: projectId, key: 'demo-a' }])
    expect(r1).toEqual([{ key: 'demo-a', days: 1 }])
    expect(r2).toEqual([{ key: 'demo-a', days: 1 }])

    const list = svc.list(projectId)
    expect(list).toHaveLength(1)
    expect(list[0].commit_count).toBe(2)
    expect(list[0].files).toBe(4)
    expect(list[0].insertions).toBe(212)
    expect(list[0].deletions).toBe(112)

    const detail = svc.get(projectId, '2026-09-04')!
    expect(detail.summary).toHaveLength(2)
    expect(detail.commits).toHaveLength(2)
    expect(detail.stat_backend!.insertions).toBe(212)
    fs.rmSync(tmpDir, { recursive: true, force: true })
    db.close()
  })

  it('importFromMd 跳过不存在的文件', () => {
    const db = openDb()
    const svc = new ReportService(db)
    const tmpDir = fs.mkdtempSync('rs-test-')
    expect(svc.importFromMd(tmpDir, [{ id: 1, key: 'nope' }])).toEqual([])
    fs.rmSync(tmpDir, { recursive: true, force: true })
    db.close()
  })
})
