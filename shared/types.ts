export interface Project {
  id: number
  key: string
  name: string
  subtitle: string | null
  backend_repo: string | null
  frontend_repo: string | null
  git_author: string
  created_at: string
}

export interface ProjectInput {
  key: string
  name: string
  subtitle?: string | null
  backend_repo?: string | null
  frontend_repo?: string | null
  git_author?: string
}

export interface CommitItem {
  hash: string
  time: string
  message: string
  repo: 'backend' | 'frontend'
}

export interface Stat {
  files: number
  insertions: number
  deletions: number
}

export interface ReportIndex {
  id: number
  project_id: number
  report_date: string
  commit_count: number
  files: number | null
  insertions: number | null
  deletions: number | null
}

export interface ReportDetail {
  id: number
  project_id: number
  report_date: string
  summary: string[]
  commits: CommitItem[]
  stat_backend: Stat | null
  stat_frontend: Stat | null
  content_md: string
  commit_count: number
  files: number | null
  insertions: number | null
  deletions: number | null
}

export type SummaryKind = 'week' | 'month' | 'lastMonth' | 'custom'

export interface SummaryReport {
  id: number
  project_id: number
  kind: SummaryKind
  date_from: string
  date_to: string
  summary: string[]
  detail_md: string
  daily_count: number
  commit_count: number
  created_at: string
}
