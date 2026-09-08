import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations, MIGRATIONS } from '../electron/main/schema'
import { ProjectService } from '../electron/main/services/project'

function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

describe('db migration', () => {
  it('user_version 达到迁移数', () => {
    const db = openTestDb()
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    db.close()
  })

  it('三张表均存在', () => {
    const db = openTestDb()
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name)
    for (const t of ['project', 'report', 'generation_run']) {
      expect(tables).toContain(t)
    }
    db.close()
  })
})

describe('ProjectService', () => {
  let svc: ProjectService
  let db: Database.Database

  beforeEach(() => {
    db = openTestDb()
    svc = new ProjectService(db)
  })

  it('create + get 落库字段正确', () => {
    const p = svc.create({ key: 'demo-a', name: 'Demo-A', backend_repo: '/a', frontend_repo: '/b' })
    expect(p.id).toBeGreaterThan(0)
    expect(p.git_author).toBe('demo-user')
    expect(p.created_at).toBeTruthy()
    const got = svc.get(p.id)!
    expect(got.key).toBe('demo-a')
    expect(got.backend_repo).toBe('/a')
  })

  it('key 重复时抛出唯一约束错误', () => {
    svc.create({ key: 'demo-a', name: 'Demo-A' })
    expect(() => svc.create({ key: 'demo-a', name: '重复' })).toThrow()
  })

  it('update 只改传入字段', () => {
    const p = svc.create({ key: 'demo-b', name: 'Demo-B', subtitle: 'OLD' })
    const updated = svc.update(p.id, { name: 'Demo-B2' })!
    expect(updated.name).toBe('Demo-B2')
    expect(updated.subtitle).toBe('OLD')
  })

  it('update 不存在的 id 返回 undefined', () => {
    expect(svc.update(9999, { name: 'x' })).toBeUndefined()
  })

  it('delete 返回 true 且级联删除 report', () => {
    const p = svc.create({ key: 'waf', name: 'WAF' })
    db.prepare(
      'INSERT INTO report (project_id, report_date, commit_count) VALUES (?, ?, 0)'
    ).run(p.id, '2026-09-04')
    expect(svc.delete(p.id)).toBe(true)
    const reports = db.prepare('SELECT COUNT(*) AS c FROM report').get() as { c: number }
    expect(reports.c).toBe(0)
    expect(svc.delete(p.id)).toBe(false)
  })

  it('seedDefaults 仅在空表时写入', () => {
    svc.seedDefaults([{ key: 'demo-a', name: 'Demo-A' }, { key: 'demo-b', name: 'Demo-B' }])
    expect(svc.list().length).toBe(2)
    svc.seedDefaults([{ key: 'waf', name: 'WAF' }])
    expect(svc.list().length).toBe(2)
  })
})
