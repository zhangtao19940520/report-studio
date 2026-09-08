import { useState } from 'react'
import type { Project, ProjectInput } from '../shared/types'
import { api } from './api'

export function ProjectModal({
  initial,
  onClose,
  onSaved
}: {
  initial?: Project // 传入为编辑模式
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [be, setBe] = useState(initial?.backend_repo ?? '')
  const [fe, setFe] = useState(initial?.frontend_repo ?? '')
  const [author, setAuthor] = useState(initial?.git_author ?? 'demo-user')
  const [error, setError] = useState('')

  const save = async () => {
    if (!name.trim()) {
      setError('请填写项目名称')
      return
    }
    const input: ProjectInput = {
      key: initial?.key ?? name.trim().toLowerCase(),
      name: name.trim(),
      backend_repo: be.trim() || null,
      frontend_repo: fe.trim() || null,
      git_author: author.trim() || 'demo-user'
    }
    try {
      if (initial) await api.project.update(initial.id, input)
      else await api.project.create(input)
      onSaved()
    } catch (e) {
      setError(`保存失败：${String(e)}`)
    }
  }

  return (
    <div className="modal-mask show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{initial ? '编辑项目' : '新增项目'}</h3>
        <div className="field">
          <label>项目名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：WAF" />
        </div>
        <div className="field">
          <label>后端仓库路径</label>
          <input value={be ?? ''} onChange={(e) => setBe(e.target.value)} placeholder="~/Projects/xxx-backend" />
        </div>
        <div className="field">
          <label>前端仓库路径</label>
          <input value={fe ?? ''} onChange={(e) => setFe(e.target.value)} placeholder="~/Projects/xxx-web" />
        </div>
        <div className="field">
          <label>Git 作者</label>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        {error && <div className="field-error">{error}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
