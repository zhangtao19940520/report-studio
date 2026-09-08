import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { collectCommits, collectStat } from '../electron/main/services/git'

const AUTHOR = 'tester'
const DATE = '2026-09-04'

let repo: string
let otherRepo: string

function run(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' })
}

function commit(
  cwd: string,
  file: string,
  msg: string,
  time: string,
  author: string = AUTHOR
): void {
  fs.writeFileSync(path.join(cwd, file), `${msg}\n${Math.random()}`)
  run(cwd, ['add', file])
  const env = {
    GIT_AUTHOR_NAME: author,
    GIT_AUTHOR_EMAIL: `${author}@test`,
    GIT_COMMITTER_NAME: author,
    GIT_COMMITTER_EMAIL: `${author}@test`,
    GIT_AUTHOR_DATE: `${DATE}T${time}:00`,
    GIT_COMMITTER_DATE: `${DATE}T${time}:00`
  }
  run(cwd, ['commit', '-m', msg], env)
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-git-'))
  otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-git-'))
  for (const r of [repo, otherRepo]) {
    run(r, ['init', '-q'])
    run(r, ['config', 'user.name', 'tester'])
    run(r, ['config', 'user.email', 'tester@test'])
  }
  commit(repo, 'a.txt', 'feat: first', '09:00')
  commit(repo, 'b.txt', 'fix: second', '10:00')
  // 其他作者的提交应被过滤
  commit(repo, 'c.txt', 'chore: other author', '11:00', 'someoneelse')
  // merge 提交应被排除
  run(repo, ['checkout', '-q', '-b', 'side'])
  commit(repo, 'd.txt', 'feat: on side', '12:00')
  run(repo, ['checkout', '-q', 'master'])
  commit(repo, 'e.txt', 'feat: on master', '13:00')
  run(repo, ['merge', '-q', '--no-ff', 'side', '-m', 'merge side'], {
    GIT_AUTHOR_NAME: AUTHOR,
    GIT_AUTHOR_EMAIL: `${AUTHOR}@test`,
    GIT_COMMITTER_NAME: AUTHOR,
    GIT_COMMITTER_EMAIL: `${AUTHOR}@test`,
    GIT_AUTHOR_DATE: `${DATE}T14:00:00`,
    GIT_COMMITTER_DATE: `${DATE}T14:00:00`
  })
})

afterAll(() => {
  for (const r of [repo, otherRepo]) fs.rmSync(r, { recursive: true, force: true })
})

describe('GitService', () => {
  it('collectCommits：作者过滤 + merge 排除 + 时间按序返回', async () => {
    const commits = await collectCommits(repo, AUTHOR, DATE)
    const msgs = commits.map((c) => c.message)
    expect(msgs).toContain('feat: first')
    expect(msgs).toContain('fix: second')
    expect(msgs).toContain('feat: on master')
    expect(msgs).toContain('feat: on side') // --all：分支提交也采集
    expect(msgs).not.toContain('chore: other author')
    expect(msgs).not.toContain('merge side')
    for (const c of commits) {
      expect(c.hash).toMatch(/^[0-9a-f]+$/)
      expect(c.time).toMatch(/^\d{2}:\d{2}$/)
    }
  })

  it('collectCommits：空仓库（无提交）返回空数组', async () => {
    expect(await collectCommits(otherRepo, AUTHOR, DATE)).toEqual([])
  })

  it('collectCommits：不存在的目录返回空数组不抛错', async () => {
    expect(await collectCommits('/nonexistent/repo', AUTHOR, DATE)).toEqual([])
  })

  it('collectStat：聚合 shortstat', async () => {
    const commits = await collectCommits(repo, AUTHOR, DATE)
    const stat = await collectStat(
      repo,
      commits.map((c) => c.hash)
    )
    expect(stat).not.toBeNull()
    expect(stat!.files).toBeGreaterThanOrEqual(4)
    expect(stat!.insertions).toBeGreaterThanOrEqual(4)
    expect(stat!.deletions).toBeGreaterThanOrEqual(0)
  })

  it('collectStat：无 hash 返回 null', async () => {
    expect(await collectStat(repo, [])).toBeNull()
    expect(await collectStat('', ['abc'])).toBeNull()
  })
})
