import type { CommitItem, Stat } from '../../../shared/types'

export interface ParsedDay {
  date: string
  summary: string[]
  commits: CommitItem[]
  stat_backend: Stat | null
  stat_frontend: Stat | null
  raw: string
}

const DATE_RE = /^## (\d{4}-\d{2}-\d{2})\s*$/
const COMMIT_RE = /^[-*\s]*`(\w+)` (\d{2}:\d{2}) (.+)$/
const STAT_RE = /^[-*\s]*(?:\*\*)?(后端|前端)(?:\*\*)?[：:]\s*(.+)$/
const REPO_LABEL_RE = /^[-*\s]*(?:\*\*)?(后端|前端)(?:\*\*)?[：:]/

function parseStat(text: string): Stat | null {
  if (!text || text.trim() === '无' || text.trim() === '- 无') return null
  const files = text.match(/(\d+)\s*个文件/)
  const ins = text.match(/\+(\d+)\s*行/)
  const del = text.match(/-(\d+)\s*行/)
  if (!files && !ins && !del) return null
  return {
    files: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0
  }
}

/**
 * 解析 `*_work_report.md` 全文，按 `## YYYY-MM-DD` 切分。
 * 容错原则：解析不出的内容保留在 raw 中原文展示，绝不抛错。
 */
export function parseReport(md: string): ParsedDay[] {
  const lines = md.split(/\r?\n/)
  const days: ParsedDay[] = []
  let cur: ParsedDay | null = null
  let section = '' // summary | commits | stat | ''
  let repo: 'backend' | 'frontend' | null = null

  const flush = () => {
    if (cur) days.push(cur)
    cur = null
  }

  for (const line of lines) {
    const dm = line.match(DATE_RE)
    if (dm) {
      flush()
      cur = {
        date: dm[1],
        summary: [],
        commits: [],
        stat_backend: null,
        stat_frontend: null,
        raw: line
      }
      section = ''
      repo = null
      continue
    }
    if (!cur) continue
    cur.raw += '\n' + line

    if (line.startsWith('### ')) {
      const title = line.slice(4).trim()
      if (title.includes('总结')) section = 'summary'
      else if (title.includes('提交明细')) section = 'commits'
      else if (title.includes('变更统计')) section = 'stat'
      else section = ''
      repo = null
      continue
    }

    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    if (section === 'summary' && /^[*-]\s/.test(trimmed)) {
      cur.summary.push(trimmed.replace(/^[*-]\s*/, '').trim())
      continue
    }

    if (section === 'commits') {
      const cm = trimmed.match(COMMIT_RE)
      if (cm) {
        if (repo) cur.commits.push({ hash: cm[1], time: cm[2], message: cm[3], repo })
        continue
      }
      if (REPO_LABEL_RE.test(trimmed)) {
        repo = trimmed.includes('后端') ? 'backend' : 'frontend'
        continue
      }
    }

    if (section === 'stat') {
      const sm = trimmed.match(STAT_RE)
      if (sm) {
        const stat = parseStat(sm[2])
        if (sm[1] === '后端') cur.stat_backend = stat
        else cur.stat_frontend = stat
      }
    }
  }
  flush()
  return days
}
