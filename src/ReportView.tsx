import { useState } from 'react'
import type { CommitItem, ReportDetail, Stat } from '../shared/types'

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function commitTag(msg: string): { tag: string; cls: string } {
  const m = msg.match(/^(\w+)\(/) ?? msg.match(/^(\w+):/)
  const t = m?.[1] ?? ''
  if (t === 'feat') return { tag: 'feat', cls: 'feat' }
  if (t === 'fix') return { tag: 'fix', cls: 'fix' }
  if (t) return { tag: t, cls: 'chore' }
  return { tag: '', cls: '' }
}

function CommitRow({ c }: { c: CommitItem }) {
  const { tag, cls } = commitTag(c.message)
  return (
    <div className="commit">
      <span className="hash">{c.hash}</span>
      <span className="time">{c.time}</span>
      {tag && <span className={`tag ${cls}`}>{tag}</span>}
      <span className="msg">{c.message}</span>
    </div>
  )
}

function StatCard({ label, s }: { label: string; s: Stat | null }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="nums">
        {s ? (
          <>
            <span className="ins">+{s.insertions}</span>{' '}
            <span className="del">-{s.deletions}</span> <small>/ {s.files} 文件</small>
          </>
        ) : (
          <small>无变更</small>
        )}
      </div>
    </div>
  )
}

function CopySummaryButton({ summary }: { summary: string[] }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(summary.map((s, i) => `${i + 1}. ${s}`).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button className="copy-btn" onClick={() => void copy()} title="复制今日工作总结">
      {copied ? '✓ 已复制' : '⧉ 复制总结'}
    </button>
  )
}

export function ReportView({
  detail,
  generating,
  onRegenerate
}: {
  detail: ReportDetail
  generating: boolean
  onRegenerate: () => void
}) {
  const wd = WEEKDAY[new Date(detail.report_date + 'T00:00:00').getDay()]
  const backend = detail.commits.filter((c) => c.repo === 'backend')
  const frontend = detail.commits.filter((c) => c.repo === 'frontend')

  return (
    <div className="report">
      <div className="report-date">
        {detail.report_date}
        <span className="wd">{wd}</span>
        <button
          className="regen-btn"
          disabled={generating}
          onClick={onRegenerate}
          title="删除当前日报并重新采集生成"
        >
          {generating ? '⟳ 生成中…' : '↻ 重新生成'}
        </button>
      </div>
      <div className="report-sub">▸ {detail.commit_count} commits</div>

      <div className="sec">
        <div className="sec-title">
          <span className="idx">01</span>今日工作总结
          <CopySummaryButton summary={detail.summary} />
        </div>
        {detail.summary.length > 0 ? (
          detail.summary.map((s, i) => (
            <div className="sum-item" key={i}>
              <span className="sum-idx">{i + 1}.</span>
              {s}
            </div>
          ))
        ) : (
          <div className="sum-item">无代码提交</div>
        )}
      </div>

      <div className="sec">
        <div className="sec-title">
          <span className="idx">02</span>代码提交明细
        </div>
        <div className="repo-label">BACKEND · 后端</div>
        {backend.length > 0 ? backend.map((c) => <CommitRow key={c.hash} c={c} />) : (
          <div className="commit" style={{ opacity: 0.5 }}>
            <span className="msg">无</span>
          </div>
        )}
        <div className="repo-label">FRONTEND · 前端</div>
        {frontend.length > 0 ? frontend.map((c) => <CommitRow key={c.hash + c.time} c={c} />) : (
          <div className="commit" style={{ opacity: 0.5 }}>
            <span className="msg">无</span>
          </div>
        )}
      </div>

      <div className="sec">
        <div className="sec-title">
          <span className="idx">03</span>变更统计
        </div>
        <div className="stat-cards">
          <StatCard label="后端仓库" s={detail.stat_backend} />
          <StatCard label="前端仓库" s={detail.stat_frontend} />
        </div>
      </div>
    </div>
  )
}
