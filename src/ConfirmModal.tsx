export function ConfirmModal({
  title,
  message,
  confirmText = '确认',
  onConfirm,
  onClose
}: {
  title: string
  message: string
  confirmText?: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="modal-mask show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 380 }}>
        <h3>{title}</h3>
        <p className="confirm-msg">{message}</p>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
