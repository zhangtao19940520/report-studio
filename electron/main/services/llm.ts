import type Database from 'better-sqlite3'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface ApiProfile {
  api_url: string | null
  api_key: string | null
  model: string | null
}

export interface LlmConfig {
  mode: 'cli' | 'api'
  /** API 模式下当前激活的协议 */
  protocol: 'openai' | 'anthropic'
  openai: ApiProfile
  anthropic: ApiProfile
}

const COLS: Record<'openai' | 'anthropic', [keyof ApiProfile, string][]> = {
  openai: [
    ['api_url', 'openai_url'],
    ['api_key', 'openai_key'],
    ['model', 'openai_model']
  ],
  anthropic: [
    ['api_url', 'anthropic_url'],
    ['api_key', 'anthropic_key'],
    ['model', 'anthropic_model']
  ]
}

export function activeProfile(cfg: LlmConfig): ApiProfile {
  return cfg.protocol === 'anthropic' ? cfg.anthropic : cfg.openai
}

/** 单协议视图：取激活协议的配置（供 runner 使用） */
export function toSingleConfig(cfg: LlmConfig): {
  mode: 'api'
  protocol: 'openai' | 'anthropic'
} & ApiProfile {
  const p = activeProfile(cfg)
  return { mode: 'api', protocol: cfg.protocol, ...p }
}

export type LlmRunner = (prompt: string, onLog: (line: string) => void) => Promise<string>

/** Claude CLI 实现：claude -p --output-format json */
export function claudeCliRunner(prompt: string, onLog: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
      timeout: 180_000
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => onLog(d.toString().trim()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`claude 退出码 ${code}`))
    })
  })
}

/** OpenAI 兼容 API 实现：POST {url}/chat/completions */
export function openAiCompatRunner(
  cfg: { api_url: string; api_key: string; model: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 120_000
): LlmRunner {
  return async (prompt) => {
    const url = cfg.api_url.replace(/\/+$/, '') + '/chat/completions'
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api_key}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`API 请求失败 HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ''}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('API 返回中没有内容')
    return JSON.stringify({ result: content })
  }
}

/** Anthropic 协议实现：POST {url}/v1/messages */
export function anthropicRunner(
  cfg: { api_url: string; api_key: string; model: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 120_000
): LlmRunner {
  return async (prompt) => {
    const base = cfg.api_url.replace(/\/+$/, '').replace(/\/v1$/, '')
    const url = base + '/v1/messages'
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.api_key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`API 请求失败 HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ''}`)
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[]
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('')
    if (!text) throw new Error('API 返回中没有内容')
    return JSON.stringify({ result: text })
  }
}

export function apiRunner(
  cfg: { protocol: 'openai' | 'anthropic' } & ApiProfile,
  fetchImpl?: typeof fetch,
  timeoutMs?: number
): LlmRunner {
  const apiCfg = { api_url: cfg.api_url!, api_key: cfg.api_key!, model: cfg.model! }
  return cfg.protocol === 'anthropic'
    ? anthropicRunner(apiCfg, fetchImpl, timeoutMs)
    : openAiCompatRunner(apiCfg, fetchImpl, timeoutMs)
}

export async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    await exec('which', ['claude'])
    return true
  } catch {
    return false
  }
}

export class LlmService {
  constructor(private db: Database.Database) {}

  getConfig(): LlmConfig {
    const row = this.db
      .prepare('SELECT * FROM llm_config WHERE id = 1')
      .get() as Record<string, unknown> | undefined
    if (!row) {
      return {
        mode: 'cli',
        protocol: 'openai',
        openai: { api_url: null, api_key: null, model: null },
        anthropic: { api_url: null, api_key: null, model: null }
      }
    }
    const pick = (proto: 'openai' | 'anthropic'): ApiProfile => ({
      api_url: (row[`${proto}_url`] as string) ?? null,
      api_key: (row[`${proto}_key`] as string) ?? null,
      model: (row[`${proto}_model`] as string) ?? null
    })
    return {
      mode: (row.mode as 'cli' | 'api') ?? 'cli',
      protocol: (row.protocol as 'openai' | 'anthropic') ?? 'openai',
      openai: pick('openai'),
      anthropic: pick('anthropic')
    }
  }

  saveConfig(cfg: LlmConfig): void {
    this.db
      .prepare(
        `UPDATE llm_config SET
           mode = ?, protocol = ?,
           openai_url = ?, openai_key = ?, openai_model = ?,
           anthropic_url = ?, anthropic_key = ?, anthropic_model = ?
         WHERE id = 1`
      )
      .run(
        cfg.mode,
        cfg.protocol,
        cfg.openai.api_url,
        cfg.openai.api_key,
        cfg.openai.model,
        cfg.anthropic.api_url,
        cfg.anthropic.api_key,
        cfg.anthropic.model
      )
  }

  /** 按当前配置返回 runner；CLI 模式下检测 claude 是否可用 */
  async runner(onLog: (line: string) => void): Promise<LlmRunner> {
    const cfg = this.getConfig()
    if (cfg.mode === 'api') {
      const p = activeProfile(cfg)
      if (!p.api_url || !p.api_key || !p.model) {
        throw new Error(
          `API 模式（${cfg.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}）未配置完整（URL / Key / 模型 ID），请在设置中补全或切换激活协议`
        )
      }
      onLog(`[llm] 使用 API 模式（${cfg.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'}）· ${p.model}`)
      return apiRunner({ protocol: cfg.protocol, ...p })
    }
    if (!(await isClaudeCliAvailable())) {
      throw new Error('未检测到 claude CLI，请在「设置 → AI 模型」中切换为 API 模式')
    }
    onLog('[llm] 使用 Claude CLI 模式')
    return claudeCliRunner
  }

  /** 测试连接：测试指定协议的配置（不落库）；mode=cli 时探测 claude CLI */
  async testConnection(
    cfg: LlmConfig,
    protocol: 'openai' | 'anthropic' = cfg.protocol
  ): Promise<{ ok: boolean; message: string }> {
    if (cfg.mode === 'cli') {
      const ok = await isClaudeCliAvailable()
      return ok
        ? { ok: true, message: '已检测到 claude CLI' }
        : { ok: false, message: '未检测到 claude CLI' }
    }
    const p = protocol === 'anthropic' ? cfg.anthropic : cfg.openai
    if (!p.api_url || !p.api_key || !p.model) {
      return { ok: false, message: '请先填写完整的 URL / Key / 模型 ID' }
    }
    try {
      const runner = apiRunner({ protocol, ...p }, undefined, 20_000)
      await runner('回复「ok」两个字母即可，不要输出其他内容。', () => {})
      return { ok: true, message: '连接正常，模型可用' }
    } catch (e) {
      return { ok: false, message: String(e) }
    }
  }
}
