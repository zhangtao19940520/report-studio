import { useState } from 'react'
import type { SummaryReport } from '../shared/types'

function CopySummaryButton({ summary }: { summary: string[] }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(summary.map((s, i) => `${i + 1}. ${s}`).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button className="copy-btn" onClick={() => void copy()} title="复制汇总要点">
      {copied ? '✓ 已复制' : '⧉ 复制要点'}
    </button>
  )
}

const KIND_LABEL: Record<string, string> = {
  week: '周报',
  month: '月报',
  lastMonth: '月报',
  custom: '自定义'
}

export function SummaryListView({
  list,
  activeId,
  onSelect,
  onGenerate,
  onDelete,
  onRegenerate
}: {
  list: SummaryReport[]
  activeId: number | null
  onSelect: (id: number) => void
  onGenerate: () => void
  onDelete: (s: SummaryReport) => void
  onRegenerate: (s: SummaryReport) => void
}) {
  return (
    <div className="summary-list">
      <div className="nav-label" style={{ padding: '4px 14px 12px' }}>
        汇总报告
      </div>
      {list.length === 0 && (
        <div className="summary-empty">
          暂无汇总
          <br />
          点击下方按钮生成周报/月报
        </div>
      )}
      {list.map((s) => (
        <div
          key={s.id}
          className={`sum-card ${s.id === activeId ? 'active' : ''}`}
          onClick={() => onSelect(s.id)}
        >
          <div className="sum-card-top">
            <span className="sum-kind">{KIND_LABEL[s.kind] ?? s.kind}</span>
            <span className="sum-range">
              {s.date_from} ~ {s.date_to}
            </span>
          </div>
          <div className="sum-card-meta">
            {s.daily_count} 天 · {s.commit_count} 提交
          </div>
          <div className="sum-card-ops">
            <button
              className="op-btn"
              title="重新生成"
              onClick={(e) => {
                e.stopPropagation()
                onRegenerate(s)
              }}
            >
              ↻
            </button>
            <button
              className="op-btn danger"
              title="删除"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(s)
              }}
            >
              🗑
            </button>
          </div>
        </div>
      ))}
      <button className="add-sum-btn" onClick={onGenerate}>
        ＋ 生成汇总
      </button>
    </div>
  )
}

export function SummaryDetailView({ s }: { s: SummaryReport }) {
  const days = s.detail_md.split('\n').filter((l) => l.startsWith('- 20'))
  return (
    <div className="report">
      <div className="report-date">
        汇总报告
        <span className="wd">
          {s.date_from} ~ {s.date_to}
        </span>
      </div>
      <div className="report-sub">
        ▸ {s.daily_count} 天日报 · {s.commit_count} commits
      </div>

      <div className="sec">
        <div className="sec-title">
          <span className="idx">01</span>汇总要点
          <CopySummaryButton summary={s.summary} />
        </div>
        {s.summary.map((t, i) => (
          <div className="sum-item" key={i}>
            <span className="sum-idx">{i + 1}.</span>
            {t}
          </div>
        ))}
      </div>

      <div className="sec">
        <div className="sec-title">
          <span className="idx">02</span>分日概览
        </div>
        <div className="commit" style={{ display: 'block' }}>
          {days.length > 0 ? (
            days.map((d) => (
              <div key={d} style={{ padding: '4px 0' }}>
                {d.slice(2)}
              </div>
            ))
          ) : (
            <span style={{ opacity: 0.5 }}>无</span>
          )}
        </div>
      </div>
    </div>
  )
}
