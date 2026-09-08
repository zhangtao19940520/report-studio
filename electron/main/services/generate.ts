import type Database from 'better-sqlite3'
import type { CommitItem, Project, Stat } from '../../../shared/types'
import { ReportService } from './report'
import { collectCommits, collectStat } from './git'
import { claudeCliRunner, type LlmRunner } from './llm'

export type GenStatus = 'success' | 'failed' | 'skipped'
export interface GenResult {
  status: GenStatus
  message: string
}

/** 兼容别名：可注入的 LLM 执行器，测试时替换为 mock */
export type ClaudeRunner = LlmRunner

function statLine(s: Stat | null): string {
  return s ? `${s.files} 个文件变更，+${s.insertions} 行，-${s.deletions} 行` : '无'
}

/** 组装导出用 Markdown（与既有 md 日报格式一致） */
export function buildContentMd(
  date: string,
  summary: string[],
  commits: CommitItem[],
  statBackend: Stat | null,
  statFrontend: Stat | null
): string {
  const group = (repo: 'backend' | 'frontend', label: string) => {
    const rows = commits.filter((c) => c.repo === repo)
    if (rows.length === 0) return `- **${label}**：\n- 无`
    return `- **${label}**：\n${rows.map((c) => `- \`${c.hash}\` ${c.time} ${c.message}`).join('\n')}`
  }
  return [
    `## ${date}`,
    '',
    '### 今日工作总结',
    ...summary.map((s) => `- ${s}`),
    '',
    '### 代码提交明细',
    group('backend', '后端'),
    group('frontend', '前端'),
    '',
    '### 变更统计',
    `- 后端：${statLine(statBackend)}`,
    `- 前端：${statLine(statFrontend)}`
  ].join('\n')
}

function buildPrompt(project: Project, date: string, commits: CommitItem[]): string {
  const lines = commits.map((c) => `- \`${c.hash}\` ${c.time} ${c.message}（${c.repo === 'backend' ? '后端' : '前端'}）`)
  return `你是工作日报生成助手。以下是 ${project.name} 项目 ${date} 的代码提交数据（已由外部采集，无需执行任何 git 命令）：

${lines.join('\n') || '（无提交）'}

请将这批提交归纳为 2~6 条当日工作总结要点：每条说明做了什么、为什么，按模块/主题归纳合并，不要逐条罗列 commit，语言精炼、面向人阅读（用于后续写周报）。无提交时只给一条「无代码提交」。

只返回一个 JSON 对象，格式：{"summary": ["要点1", "要点2"]}，不要输出任何其他内容。`
}

function extractSummary(raw: string): string[] {
  // claude --output-format json 输出 {"result": "...", ...}，result 内是模型文本
  let text = raw
  try {
    const outer = JSON.parse(raw) as { result?: string }
    if (outer.result) text = outer.result
  } catch {
    // 非 JSON 包裹，直接按模型文本处理
  }
  // 剥出首个 JSON 对象（模型可能带 markdown 代码块）
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as { summary?: unknown }
      if (Array.isArray(parsed.summary)) {
        return parsed.summary.map(String).filter((s) => s.trim() !== '')
      }
    } catch {
      // 继续降级
    }
  }
  throw new Error(`AI 输出无法解析为 JSON：${text.slice(0, 200)}`)
}

export class GenerateService {
  constructor(
    private db: Database.Database,
    private reports: ReportService,
    private getProject: (id: number) => Project | undefined,
    private claudeRunner: ClaudeRunner = claudeCliRunner
  ) {}

  async run(
    projectId: number,
    date: string,
    onLog: (line: string) => void,
    force = false
  ): Promise<GenResult> {
    const project = this.getProject(projectId)
    if (!project) return { status: 'failed', message: '项目不存在' }

    const runId = this.startRun(projectId)

    if (this.reports.get(projectId, date)) {
      if (!force) {
        const msg = `[${project.key}] ${date} 日报已存在，跳过`
        onLog(msg)
        this.finishRun(runId, 'skipped', msg)
        return { status: 'skipped', message: msg }
      }
      onLog(`[${project.key}] ${date} 日报已存在，将重新生成并覆盖（失败保留旧版）`)
    }

    try {
      onLog(`[${project.key}] 采集后端仓库提交 · ${project.backend_repo ?? '未配置'}`)
      const backend = await collectCommits(project.backend_repo ?? '', project.git_author, date, 'backend')
      onLog(`[${project.key}] 采集前端仓库提交 · ${project.frontend_repo ?? '未配置'}`)
      const frontend = await collectCommits(project.frontend_repo ?? '', project.git_author, date, 'frontend')
      const commits = [...backend, ...frontend]
      onLog(`[${project.key}] 提交采集完成：后端 ${backend.length} 条，前端 ${frontend.length} 条`)

      const statBackend = await collectStat(
        project.backend_repo ?? '',
        backend.map((c) => c.hash)
      )
      const statFrontend = await collectStat(
        project.frontend_repo ?? '',
        frontend.map((c) => c.hash)
      )
      onLog(
        `[${project.key}] 变更统计完成：后端 ${statBackend ? `+${statBackend.insertions}/-${statBackend.deletions}` : '无'}，前端 ${
          statFrontend ? `+${statFrontend.insertions}/-${statFrontend.deletions}` : '无'
        }`
      )

      onLog(`[${project.key}] 调用 AI 生成总结…`)
      const raw = await this.claudeRunner(buildPrompt(project, date, commits), onLog)
      const summary = extractSummary(raw)
      onLog(`[${project.key}] 总结生成完成（${summary.length} 条）`)

      this.reports.upsert(projectId, {
        date,
        summary,
        commits,
        stat_backend: statBackend,
        stat_frontend: statFrontend,
        content_md: buildContentMd(date, summary, commits, statBackend, statFrontend)
      })

      const msg = `[${project.key}] 完成 → ${date} 日报已入库`
      onLog(msg)
      this.finishRun(runId, 'success', msg)
      return { status: 'success', message: msg }
    } catch (e) {
      const msg = `[${project.key}] 生成失败：${String(e)}`
      onLog(msg)
      this.finishRun(runId, 'failed', msg)
      return { status: 'failed', message: msg }
    }
  }

  private startRun(projectId: number): number {
    const info = this.db
      .prepare('INSERT INTO generation_run (project_id, started_at, status) VALUES (?, ?, ?)')
      .run(projectId, new Date().toISOString(), 'running')
    return Number(info.lastInsertRowid)
  }

  private finishRun(id: number, status: string, log: string): void {
    this.db
      .prepare('UPDATE generation_run SET finished_at = ?, status = ?, log = ? WHERE id = ?')
      .run(new Date().toISOString(), status, log, id)
  }
}
