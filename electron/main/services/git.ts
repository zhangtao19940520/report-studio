import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CommitItem, Stat } from '../../../shared/types'

const exec = promisify(execFile)

function git(repo: string, args: string[]): Promise<string> {
  return exec('git', ['-C', repo, ...args], {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000
  }).then((r) => r.stdout)
}

function isRepoOk(repo: string | null): repo is string {
  return !!repo && repo.trim() !== ''
}

/** 采集某仓库某天的提交（作者过滤，排除 merge），返回带时间与 message 的明细 */
export async function collectCommits(
  repo: string,
  author: string,
  date: string,
  repoLabel: 'backend' | 'frontend' = 'backend'
): Promise<CommitItem[]> {
  if (!isRepoOk(repo)) return []
  let out: string
  try {
    out = await git(repo, [
      'log',
      '--all',
      `--since=${date} 00:00:00`,
      `--until=${date} 23:59:59`,
      `--author=${author}`,
      '--no-merges',
      "--pretty=%h|%ad|%s",
      '--date=format:%H:%M'
    ])
  } catch {
    return [] // 仓库不存在或非 git 目录
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [hash, time, ...rest] = l.split('|')
      return { hash, time, message: rest.join('|') }
    })
    .filter((c) => c.hash && c.time)
    .map((c) => ({ ...c, repo: repoLabel }))
}

/** 聚合一批 commit 的 --shortstat（复刻 daily_report.sh collect_stat） */
export async function collectStat(repo: string, hashes: string[]): Promise<Stat | null> {
  if (!isRepoOk(repo) || hashes.length === 0) return null
  let files = 0
  let ins = 0
  let del = 0
  for (const h of hashes) {
    try {
      const out = await git(repo, ['show', '--shortstat', '--format=', h])
      const text = out.replace(/\n/g, '')
      const m = text.match(/(\d+) files? changed/)
      if (m) files += Number(m[1])
      const i = text.match(/(\d+) insertions?/)
      if (i) ins += Number(i[1])
      const d = text.match(/(\d+) deletions?/)
      if (d) del += Number(d[1])
    } catch {
      // 单个 commit 统计失败不阻塞整体
    }
  }
  if (files === 0 && ins === 0 && del === 0) return null
  return { files, insertions: ins, deletions: del }
}
