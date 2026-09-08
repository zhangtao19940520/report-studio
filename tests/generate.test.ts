import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { applyMigrations } from '../electron/main/schema'
import { ReportService } from '../electron/main/services/report'
import { GenerateService, buildContentMd } from '../electron/main/services/generate'
import type { Project } from '../shared/types'

const DATE = '2026-09-04'
const AUTHOR = 'tester'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

function makeProject(db: Database.Database, backendRepo: string | null): Project {
  const info = db
    .prepare(
      `INSERT INTO project (key, name, backend_repo, git_author, created_at) VALUES ('t', 'T', ?, ?, ?)`
    )
    .run(backendRepo, AUTHOR, '2026-09-04T00:00:00Z')
  return db
    .prepare('SELECT * FROM project WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as Project
}

function makeGitRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-gen-'))
  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env }, stdio: 'pipe' })
  run(['init', '-q'])
  run(['config', 'user.name', 'tester'])
  run(['config', 'user.email', 'tester@test'])
  const commit = (file: string, msg: string, time: string, lines = 3) => {
    fs.writeFileSync(`${repo}/${file}`, Array.from({ length: lines }, (_, i) => `${msg} ${i}`).join('\n'))
    run(['add', file])
    const env = {
      GIT_AUTHOR_NAME: AUTHOR,
      GIT_AUTHOR_EMAIL: 'tester@test',
      GIT_COMMITTER_NAME: AUTHOR,
      GIT_COMMITTER_EMAIL: 'tester@test',
      GIT_AUTHOR_DATE: `${DATE}T${time}:00`,
      GIT_COMMITTER_DATE: `${DATE}T${time}:00`
    }
    run(['commit', '-m', msg], env)
  }
  commit('a.txt', 'feat: one', '09:00', 5)
  commit('b.txt', 'fix: two', '10:00', 2)
  return repo
}

/** 固定提交数据的假 git 采集结果：直接在真实临时仓库上采集保证 git 部分真实 */
describe('GenerateService', () => {
  let db: Database.Database
  let reports: ReportService
  let project: Project
  let repo: string
  const logs: string[] = []

  beforeEach(() => {
    db = makeDb()
    reports = new ReportService(db)
    repo = makeGitRepo()
    project = makeProject(db, repo)
    logs.length = 0
  })

  it('成功路径：采集→claude→落库→generation_run success', async () => {
    const fakeClaude = async () =>
      JSON.stringify({ result: JSON.stringify({ summary: ['完成了 A 和 B', '修复了 C'] }) })
    const svc = new GenerateService(db, reports, (id) => (id === project.id ? project : undefined), fakeClaude)
    const r = await svc.run(project.id, DATE, (l) => logs.push(l))
    expect(r.status).toBe('success')

    const detail = reports.get(project.id, DATE)!
    expect(detail.summary).toEqual(['完成了 A 和 B', '修复了 C'])
    expect(detail.commits).toHaveLength(2)
    expect(detail.commits[0].repo).toBe('backend')
    expect(detail.stat_backend!.files).toBe(2)
    expect(detail.commit_count).toBe(2)
    expect(detail.content_md).toContain('## 2026-09-04')
    expect(detail.content_md).toContain('### 变更统计')

    const run = db.prepare('SELECT * FROM generation_run').get() as Record<string, unknown>
    expect(run.status).toBe('success')
    expect(logs.some((l) => l.includes('完成'))).toBe(true)
  })

  it('幂等：已有日报则 skipped，不调用 claude', async () => {
    let called = 0
    const fakeClaude = async () => {
      called++
      return JSON.stringify({ result: '{"summary":["x"]}' })
    }
    const svc = new GenerateService(db, reports, () => project, fakeClaude)
    await svc.run(project.id, DATE, () => {})
    const r2 = await svc.run(project.id, DATE, (l) => logs.push(l))
    expect(r2.status).toBe('skipped')
    expect(called).toBe(1)
    const runs = db.prepare('SELECT status FROM generation_run').all() as { status: string }[]
    expect(runs.map((x) => x.status).sort()).toEqual(['skipped', 'success'])
  })

  it('force=true：已有日报时删除重建', async () => {
    let n = 0
    const fakeClaude = async () => {
      n++
      return JSON.stringify({ result: JSON.stringify({ summary: [`第 ${n} 版总结`] }) })
    }
    const svc = new GenerateService(db, reports, () => project, fakeClaude)
    await svc.run(project.id, DATE, () => {})
    const r2 = await svc.run(project.id, DATE, () => {}, true)
    expect(r2.status).toBe('success')
    expect(n).toBe(2)
    const detail = reports.get(project.id, DATE)!
    expect(detail.summary).toEqual(['第 2 版总结'])
    // 只有一行日报，没有重复
    expect(reports.list(project.id)).toHaveLength(1)
  })

  it('force 重新生成失败：旧日报保留不丢失（回归：先删后生成导致的丢数据）', async () => {
    const okClaude = async () => JSON.stringify({ result: JSON.stringify({ summary: ['旧版总结'] }) })
    const svc1 = new GenerateService(db, reports, () => project, okClaude)
    await svc1.run(project.id, DATE, () => {})

    const badClaude = async () => {
      throw new Error('claude 退出码 1')
    }
    const svc2 = new GenerateService(db, reports, () => project, badClaude)
    const r = await svc2.run(project.id, DATE, () => {}, true)
    expect(r.status).toBe('failed')

    // 旧日报仍在，内容未变
    const detail = reports.get(project.id, DATE)!
    expect(detail.summary).toEqual(['旧版总结'])
  })

  it('claude 失败：failed 落 generation_run，日报不入库', async () => {
    const badClaude = async () => {
      throw new Error('claude 退出码 1')
    }
    const svc = new GenerateService(db, reports, () => project, badClaude)
    const r = await svc.run(project.id, DATE, () => {})
    expect(r.status).toBe('failed')
    expect(reports.get(project.id, DATE)).toBeUndefined()
    const run = db.prepare('SELECT * FROM generation_run').get() as Record<string, unknown>
    expect(run.status).toBe('failed')
    expect(String(run.log)).toContain('claude 退出码 1')
  })

  it('claude 输出非 JSON：failed 且错误信息可读', async () => {
    const badClaude = async () => '我觉得今天干得不错'
    const svc = new GenerateService(db, reports, () => project, badClaude)
    const r = await svc.run(project.id, DATE, () => {})
    expect(r.status).toBe('failed')
    expect(r.message).toContain('无法解析')
  })

  it('markdown 代码块包裹的 JSON 也能解析', async () => {
    const fakeClaude = async () =>
      JSON.stringify({ result: '```json\n{"summary": ["要点"]}\n```' })
    const svc = new GenerateService(db, reports, () => project, fakeClaude)
    const r = await svc.run(project.id, DATE, () => {})
    expect(r.status).toBe('success')
    expect(reports.get(project.id, DATE)!.summary).toEqual(['要点'])
  })

  it('项目不存在：直接 failed', async () => {
    const svc = new GenerateService(db, reports, () => undefined, async () => '{}')
    const r = await svc.run(999, DATE, () => {})
    expect(r.status).toBe('failed')
    expect(r.message).toContain('项目不存在')
  })
})

describe('buildContentMd', () => {
  it('无提交时提交明细写「无」', () => {
    const md = buildContentMd('2026-09-04', ['无代码提交'], [], null, null)
    expect(md).toContain('- 无代码提交')
    expect(md).toContain('- **后端**：')
    expect(md).toContain('- 无')
    expect(md).toContain('- 前端：无')
  })

  it('格式与既有 md 日报一致', () => {
    const md = buildContentMd(
      '2026-09-04',
      ['要点一'],
      [{ hash: 'abc1234', time: '10:00', message: 'feat: x', repo: 'backend' }],
      { files: 1, insertions: 5, deletions: 2 },
      null
    )
    expect(md).toContain('- `abc1234` 10:00 feat: x')
    expect(md).toContain('- 后端：1 个文件变更，+5 行，-2 行')
  })
})
