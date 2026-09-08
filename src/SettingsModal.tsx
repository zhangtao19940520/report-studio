import { useEffect, useState } from 'react'
import { FONT_SIZES, THEME_COLORS, type Settings } from './settings'
import { api } from './api'

type ApiProfile = { api_url: string | null; api_key: string | null; model: string | null }
type LlmCfg = {
  mode: 'cli' | 'api'
  protocol: 'openai' | 'anthropic'
  openai: ApiProfile
  anthropic: ApiProfile
}

function ApiProfileFields({
  title,
  active,
  profile,
  onActivate,
  onChange,
  onTest
}: {
  title: string
  active: boolean
  profile: ApiProfile
  onActivate: () => void
  onChange: (p: ApiProfile) => void
  onTest: () => Promise<{ ok: boolean; message: string }>
}) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const test = async () => {
    setTesting(true)
    setResult(null)
    const r = await onTest()
    setTesting(false)
    setResult(`${r.ok ? '✓' : '✕'} ${r.message}`)
  }

  return (
    <div className={`api-profile ${active ? 'active' : ''}`}>
      <div className="api-profile-head">
        <span className="api-profile-title">{title}</span>
        <button className={`seg mini ${active ? 'on' : ''}`} onClick={onActivate}>
          {active ? '使用中' : '激活'}
        </button>
      </div>
      <div className="llm-field">
        <input
          value={profile.api_url ?? ''}
          onChange={(e) => onChange({ ...profile, api_url: e.target.value })}
          placeholder="API 地址，如 https://xxx/v1"
        />
      </div>
      <div className="llm-field">
        <input
          type="password"
          value={profile.api_key ?? ''}
          onChange={(e) => onChange({ ...profile, api_key: e.target.value })}
          placeholder="API Key"
        />
      </div>
      <div className="llm-field">
        <input
          value={profile.model ?? ''}
          onChange={(e) => onChange({ ...profile, model: e.target.value })}
          placeholder="模型 ID"
        />
      </div>
      <div className="llm-test-row">
        <button
          className="btn"
          style={{ padding: '6px 14px', fontSize: 12 }}
          disabled={testing}
          onClick={() => void test()}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        {result && (
          <span
            style={{
              fontSize: 12,
              color: result.startsWith('✓') ? 'var(--green)' : 'var(--accent)'
            }}
          >
            {result}
          </span>
        )}
      </div>
    </div>
  )
}

function LlmSection() {
  const [cfg, setCfg] = useState<LlmCfg | null>(null)

  useEffect(() => {
    void api.llm.getConfig().then(setCfg)
  }, [])

  if (!cfg) return null

  const save = (next: LlmCfg) => {
    setCfg(next)
    void api.llm.saveConfig(next)
  }

  return (
    <div className="field">
      <label>AI 模型</label>
      <div className="seg-group" style={{ marginBottom: 12 }}>
        <button
          className={`seg ${cfg.mode === 'cli' ? 'on' : ''}`}
          onClick={() => save({ ...cfg, mode: 'cli' })}
        >
          Claude CLI（本机）
        </button>
        <button
          className={`seg ${cfg.mode === 'api' ? 'on' : ''}`}
          onClick={() => save({ ...cfg, mode: 'api' })}
        >
          自定义 API
        </button>
      </div>
      {cfg.mode === 'api' && (
        <div className="api-profiles">
          <ApiProfileFields
            title="OpenAI 兼容"
            active={cfg.protocol !== 'anthropic'}
            profile={cfg.openai}
            onActivate={() => save({ ...cfg, protocol: 'openai' })}
            onChange={(p) => save({ ...cfg, openai: p })}
            onTest={() => api.llm.test(cfg, 'openai')}
          />
          <ApiProfileFields
            title="Anthropic"
            active={cfg.protocol === 'anthropic'}
            profile={cfg.anthropic}
            onActivate={() => save({ ...cfg, protocol: 'anthropic' })}
            onChange={(p) => save({ ...cfg, anthropic: p })}
            onTest={() => api.llm.test(cfg, 'anthropic')}
          />
        </div>
      )}
    </div>
  )
}

export function SettingsModal({
  settings,
  onClose,
  onChange
}: {
  settings: Settings
  onClose: () => void
  onChange: (s: Settings) => void
}) {
  const [draft, setDraft] = useState<Settings>(settings)

  const update = (patch: Partial<Settings>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    onChange(next) // 实时预览
  }

  return (
    <div className="modal-mask show">
      <div className="modal">
        <h3>设置</h3>

        <div className="field">
          <label>字体大小</label>
          <div className="seg-group">
            {FONT_SIZES.map((f) => (
              <button
                key={f.key}
                className={`seg ${draft.fontSize === f.key ? 'on' : ''}`}
                onClick={() => update({ fontSize: f.key })}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>外观</label>
          <div className="seg-group">
            <button
              className={`seg ${draft.theme === 'dark' ? 'on' : ''}`}
              onClick={() => update({ theme: 'dark' })}
            >
              🌙 暗黑
            </button>
            <button
              className={`seg ${draft.theme === 'light' ? 'on' : ''}`}
              onClick={() => update({ theme: 'light' })}
            >
              ☀️ 明亮
            </button>
          </div>
        </div>

        <div className="field">
          <label>主题色</label>
          <div className="theme-group">
            {THEME_COLORS.map((t) => (
              <button
                key={t.value}
                className={`theme-dot ${draft.themeColor === t.value ? 'on' : ''}`}
                style={{ background: t.value }}
                title={t.label}
                onClick={() => update({ themeColor: t.value })}
              />
            ))}
          </div>
        </div>

        <LlmSection />

        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
