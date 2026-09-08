import { useEffect, useRef } from 'react'
import type { GenResult } from '../electron/preload/index'

export function GenerateModal({
  project,
  date,
  lines,
  done,
  onClose,
  onRegenerate
}: {
  project: string
  date: string
  lines: string[]
  done: GenResult | null
  onClose: () => void
  onRegenerate?: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines])

  const statusText =
    done == null
      ? '⟳ 生成中…'
      : done.status === 'success'
        ? '✓ 生成完成'
        : done.status === 'skipped'
          ? '⤼ 已跳过（日报已存在）'
          : '✕ 生成失败'

  return (
    <div className="modal-mask show">
      <div className="modal gen-modal">
        <h3>
          生成日报 · {project} {date}
        </h3>
        <div className="gen-status">
          <span className={`gen-badge ${done?.status ?? 'running'}`}>{statusText}</span>
        </div>
        <div className="gen-log" ref={bodyRef}>
          {lines.length === 0 && <div className="dim">等待日志…</div>}
          {lines.map((l, i) => {
            const cls =
              l.includes('完成') || l.includes('✓')
                ? 'ok'
                : l.includes('失败')
                  ? 'err'
                  : 'dim'
            return (
              <div key={i} className={cls}>
                {l}
              </div>
            )
          })}
          {done == null && <div className="cursor-blink" />}
        </div>
        <div className="modal-foot">
          <button className="btn" disabled={done == null} onClick={onClose}>
            确认关闭
          </button>
          {onRegenerate && (
            <button className="btn primary" disabled={done == null} onClick={onRegenerate}>
              ↻ 重新生成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
