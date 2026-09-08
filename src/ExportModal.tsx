import { useState } from 'react'
import { api } from './api'
import { RangeCalendar } from './RangeCalendar'

type Mode = 'day' | 'range'
type Format = 'md' | 'excel' | 'pdf'

const FORMATS: { key: Format; label: string }[] = [
  { key: 'md', label: 'Markdown' },
  { key: 'excel', label: 'Excel' },
  { key: 'pdf', label: 'PDF' }
]

export function ExportModal({
  projectId,
  currentDate,
  earliest,
  onClose
}: {
  projectId: number
  currentDate: string | null
  earliest: string | null
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('day')
  const [range, setRange] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null
  })
  const [format, setFormat] = useState<Format>('md')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const run = async () => {
    const from = mode === 'day' ? currentDate! : range.start
    const to = mode === 'day' ? currentDate! : range.end
    if (!from || !to) {
      setResult('请先选择日期区间')
      return
    }
    setBusy(true)
    setResult(null)
    const r = await api.export.run(projectId, from, to, format)
    setBusy(false)
    setResult(r.ok ? `已导出 → ${r.path}` : `导出失败：${r.message}`)
  }

  const canExport = mode === 'day' ? !!currentDate : !!(range.start && range.end)

  return (
    <div className="modal-mask show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 420 }}>
        <h3>导出日报</h3>

        <div className="field">
          <label>范围</label>
          <div className="seg-group">
            <button className={`seg ${mode === 'day' ? 'on' : ''}`} onClick={() => setMode('day')}>
              当前日（{currentDate ?? '无'}）
            </button>
            <button className={`seg ${mode === 'range' ? 'on' : ''}`} onClick={() => setMode('range')}>
              日期区间
            </button>
          </div>
        </div>

        {mode === 'range' && (
          <div className="field">
            <RangeCalendar
              initialStart={earliest}
              initialEnd={currentDate}
              onChange={(start, end) => setRange({ start, end })}
            />
          </div>
        )}

        <div className="field">
          <label>格式</label>
          <div className="seg-group">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                className={`seg ${format === f.key ? 'on' : ''}`}
                onClick={() => setFormat(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {result && <div className="field-error">{result}</div>}

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button
            className="btn primary"
            disabled={busy || !canExport}
            onClick={() => void run()}
          >
            {busy ? '导出中…' : '⬇ 导出'}
          </button>
        </div>
      </div>
    </div>
  )
}
