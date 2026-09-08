import { useMemo, useState } from 'react'

const WEEK_HEADER = ['日', '一', '二', '三', '四', '五', '六']
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const todayStr = () => {
  const t = new Date()
  return ymd(t.getFullYear(), t.getMonth(), t.getDate())
}

export function BackfillModal({
  existingDates,
  onClose,
  onSubmit
}: {
  existingDates: Set<string>
  onClose: () => void
  onSubmit: (date: string) => void
}) {
  const today = todayStr()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-11
  const [selected, setSelected] = useState<string | null>(null)

  const { cells, nextDisabled } = useMemo(() => {
    const first = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const startWeekday = first.getDay()
    const arr: ({ date: string; day: number } | null)[] = Array(startWeekday).fill(null)
    for (let d = 1; d <= daysInMonth; d++) arr.push({ date: ymd(year, month, d), day: d })
    return {
      cells: arr,
      // 禁止翻到未来月份
      nextDisabled: year === now.getFullYear() && month === now.getMonth()
    }
  }, [year, month])

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
    setSelected(null)
  }

  const isDisabled = (date: string) => date > today || existingDates.has(date)

  return (
    <div className="modal-mask show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 360 }}>
        <h3>补生成日报</h3>

        <div className="cal">
          <div className="cal-head">
            <button className="cal-nav" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <span className="cal-title">
              {year} 年 {month + 1} 月
            </span>
            <button className="cal-nav" disabled={nextDisabled} onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <div className="cal-grid">
            {WEEK_HEADER.map((w) => (
              <div key={w} className="cal-week">
                {w}
              </div>
            ))}
            {cells.map((c, i) =>
              c === null ? (
                <div key={`e${i}`} />
              ) : (
                <button
                  key={c.date}
                  className={`cal-day ${selected === c.date ? 'on' : ''} ${
                    isDisabled(c.date) ? 'off' : ''
                  } ${c.date === today ? 'today' : ''}`}
                  disabled={isDisabled(c.date)}
                  title={
                    existingDates.has(c.date)
                      ? '该日日报已生成'
                      : c.date > today
                        ? '未来日期'
                        : '可补生成'
                  }
                  onClick={() => setSelected(c.date)}
                >
                  {c.day}
                </button>
              )
            )}
          </div>
          <div className="cal-legend">
            <span>· 灰色 = 已生成或不可选</span>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!selected}
            onClick={() => selected && onSubmit(selected)}
          >
            {selected ? `补生成 ${selected}` : '请选择日期'}
          </button>
        </div>
      </div>
    </div>
  )
}
