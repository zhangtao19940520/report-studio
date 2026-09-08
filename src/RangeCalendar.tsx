import { useMemo, useState } from 'react'

const WEEK_HEADER = ['日', '一', '二', '三', '四', '五', '六']
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const todayStr = () => {
  const t = new Date()
  return ymd(t.getFullYear(), t.getMonth(), t.getDate())
}

export function RangeCalendar({
  initialStart,
  initialEnd,
  onChange
}: {
  initialStart: string | null
  initialEnd: string | null
  onChange: (start: string | null, end: string | null) => void
}) {
  const today = todayStr()
  const now = new Date()
  // 初始月份显示起点所在月（或当前月）
  const init = initialStart ? new Date(initialStart + 'T00:00:00') : now
  const [year, setYear] = useState(init.getFullYear())
  const [month, setMonth] = useState(init.getMonth())
  const [start, setStart] = useState<string | null>(initialStart)
  const [end, setEnd] = useState<string | null>(initialEnd)

  const cells = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const startWeekday = new Date(year, month, 1).getDay()
    const arr: ({ date: string; day: number } | null)[] = Array(startWeekday).fill(null)
    for (let d = 1; d <= daysInMonth; d++) arr.push({ date: ymd(year, month, d), day: d })
    return arr
  }, [year, month])

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const nextDisabled = year === now.getFullYear() && month === now.getMonth()

  const pick = (date: string) => {
    // 未选起点 / 已完成一段区间 → 重新开始
    if (!start || (start && end)) {
      setStart(date)
      setEnd(null)
      onChange(date, null)
      return
    }
    // 已有起点：点更早的日期 → 重置起点；否则闭合区间
    if (date < start) {
      setStart(date)
      setEnd(null)
      onChange(date, null)
    } else if (date === start) {
      setEnd(date)
      onChange(date, date)
    } else {
      setEnd(date)
      onChange(start, date)
    }
  }

  const inRange = (date: string) => start != null && end != null && date >= start && date <= end

  return (
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
              className={`cal-day ${c.date === today ? 'today' : ''} ${
                inRange(c.date) ? 'in-range' : ''
              } ${c.date === start || c.date === end ? 'on' : ''} ${
                c.date > today ? 'off' : ''
              }`}
              disabled={c.date > today}
              title={c.date > today ? '未来日期' : undefined}
              onClick={() => pick(c.date)}
            >
              {c.day}
            </button>
          )
        )}
      </div>
      <div className="cal-legend">
        {start && end
          ? `已选区间：${start} → ${end}`
          : start
            ? '请再选择结束日期（点击更早日期可重设起点）'
            : '请选择开始日期'}
      </div>
    </div>
  )
}
