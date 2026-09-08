import { useEffect, useState } from 'react'
import { api } from './api'
import { RangeCalendar } from './RangeCalendar'
import type { SummaryKind } from '../shared/types'

type Quick = SummaryKind | 'custom'

function lastNDays(n: number): [string, string] {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - n + 1)
  const f = (d: Date) => d.toISOString().slice(0, 10)
  return [f(from), f(to)]
}

/** 本月：1 号 ~ 今天（不包含未来日期） */
function thisMonth(): [string, string] {
  const now = new Date()
  const f = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return [f(new Date(now.getFullYear(), now.getMonth(), 1)), f(now)]
}

const QUICKS: { key: Quick; label: string; range: () => [string, string] }[] = [
  { key: 'week', label: '周报', range: () => lastNDays(7) },
  { key: 'month', label: '月报', range: () => thisMonth() }
]

export function SummaryGenerateModal({
  projectId,
  onClose,
  onDone
}: {
  projectId: number
  onClose: () => void
  onDone: () => void
}) {
  const [quick, setQuick] = useState<Quick>('week')
  const [custom, setCustom] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null
  })
  const [missing, setMissing] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const range: [string, string] | null =
    quick === 'custom'
      ? custom.start && custom.end
        ? [custom.start, custom.end]
        : null
      : (QUICKS.find((q) => q.key === quick)!.range() as [string, string])

  // 区间确定后查询缺失日
  useEffect(() => {
    if (!range) {
      setMissing(null)
      return
    }
    void api.summary.missing(projectId, range[0], range[1]).then(setMissing)
    setResult(null)
  }, [projectId, quick, custom.start, custom.end])

  const run = async () => {
    if (!range) return
    setBusy(true)
    setResult(null)
    const r = await api.summary.generate(projectId, quick as SummaryKind, range[0], range[1])
    setBusy(false)
    if (r.status === 'success') {
      onDone()
    } else {
      setResult(r.message)
    }
  }

  return (
    <div className="modal-mask show">
      <div className="modal" style={{ width: 460 }}>
        <h3>生成汇总报告</h3>

        <div className="field">
          <label>时间范围</label>
          <div className="seg-group">
            {QUICKS.map((q) => (
              <button
                key={q.key}
                className={`seg ${quick === q.key ? 'on' : ''}`}
                onClick={() => setQuick(q.key)}
              >
                {q.label}
              </button>
            ))}
            <button
              className={`seg ${quick === 'custom' ? 'on' : ''}`}
              onClick={() => setQuick('custom')}
            >
              自定义
            </button>
          </div>
        </div>

        {quick === 'custom' && (
          <div className="field">
            <RangeCalendar
              initialStart={null}
              initialEnd={null}
              onChange={(start, end) => setCustom({ start, end })}
            />
          </div>
        )}

        {range && (
          <div className="summary-range-info">
            区间：{range[0]} ~ {range[1]}
            {missing && missing.length > 0 && (
              <span className="missing-warn">
                　⚠ {missing.length} 天缺日报（{missing.slice(0, 3).join('、')}
                {missing.length > 3 ? ' 等' : ''}），将跳过
              </span>
            )}
            {missing && missing.length === 0 && <span>　✓ 区间内日报完整</span>}
          </div>
        )}

        {result && <div className="field-error">{result}</div>}

        <div className="modal-foot">
          <button className="btn" disabled={busy} onClick={onClose}>
            关闭
          </button>
          <button className="btn primary" disabled={busy || !range} onClick={() => void run()}>
            {busy ? '⟳ 生成中…' : '生成汇总'}
          </button>
        </div>
      </div>
    </div>
  )
}
