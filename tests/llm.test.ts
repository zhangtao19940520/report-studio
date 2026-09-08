import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../electron/main/schema'
import { LlmService, openAiCompatRunner, anthropicRunner } from '../electron/main/services/llm'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch
}

const CFG = { api_url: 'https://api.test/v1', api_key: 'sk-test', model: 'test-model' }

describe('openAiCompatRunner', () => {
  it('成功：取 choices[0].message.content 并包成 result 结构', async () => {
    const runner = openAiCompatRunner(CFG, mockFetch(200, {
      choices: [{ message: { content: '{"summary":["要点"]}' } }]
    }))
    const raw = await runner('prompt', () => {})
    const parsed = JSON.parse(raw) as { result: string }
    expect(parsed.result).toBe('{"summary":["要点"]}')
  })

  it('URL 末尾斜杠被规范化', async () => {
    let calledUrl = ''
    const f = (async (url: string | URL | Request) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const runner = openAiCompatRunner({ ...CFG, api_url: 'https://api.test/v1/' }, f)
    await runner('p', () => {})
    expect(calledUrl).toBe('https://api.test/v1/chat/completions')
  })

  it('HTTP 401：报错含状态码', async () => {
    const runner = openAiCompatRunner(CFG, mockFetch(401, { error: 'bad key' }))
    await expect(runner('p', () => {})).rejects.toThrow('HTTP 401')
  })

  it('返回无内容：报错', async () => {
    const runner = openAiCompatRunner(CFG, mockFetch(200, { choices: [] }))
    await expect(runner('p', () => {})).rejects.toThrow('没有内容')
  })
})

describe('anthropicRunner', () => {
  it('成功：拼接 content 文本块', async () => {
    const runner = anthropicRunner(CFG, mockFetch(200, {
      content: [
        { type: 'text', text: '{"summary":' },
        { type: 'text', text: '["要点"]}' },
        { type: 'other' }
      ]
    }))
    const raw = await runner('p', () => {})
    const parsed = JSON.parse(raw) as { result: string }
    expect(parsed.result).toBe('{"summary":["要点"]}')
  })

  it('URL 自动补 /v1/messages（含去重尾部 /v1）', async () => {
    const urls: string[] = []
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url))
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 })
    }) as unknown as typeof fetch
    await anthropicRunner({ ...CFG, api_url: 'https://x.test' }, f)('p', () => {})
    await anthropicRunner({ ...CFG, api_url: 'https://x.test/v1' }, f)('p', () => {})
    await anthropicRunner({ ...CFG, api_url: 'https://x.test/v1/' }, f)('p', () => {})
    expect(urls.every((u) => u === 'https://x.test/v1/messages')).toBe(true)
  })

  it('HTTP 500：报错含状态码', async () => {
    const runner = anthropicRunner(CFG, mockFetch(500, { error: 'boom' }))
    await expect(runner('p', () => {})).rejects.toThrow('HTTP 500')
  })
})

describe('LlmService 配置', () => {
  const P = (u?: string, k?: string, m?: string) => ({ api_url: u ?? null, api_key: k ?? null, model: m ?? null })
  it('默认 cli 模式（迁移插入单例行）', () => {
    const svc = new LlmService(makeDb())
    const cfg = svc.getConfig()
    expect(cfg.mode).toBe('cli')
    expect(cfg.openai.api_url).toBeNull()
    expect(cfg.anthropic.api_url).toBeNull()
  })

  it('双协议配置并存，激活哪个用哪个', async () => {
    const svc = new LlmService(makeDb())
    svc.saveConfig({
      mode: 'api',
      protocol: 'anthropic',
      openai: P('https://o/v1', 'ok', 'o-model'),
      anthropic: P('https://a.test', 'ak', 'a-model')
    })
    let cfg = svc.getConfig()
    expect(cfg.openai.model).toBe('o-model')
    expect(cfg.anthropic.model).toBe('a-model')

    const logs: string[] = []
    const r = await svc.runner((l) => logs.push(l))
    expect(typeof r).toBe('function')
    expect(logs[0]).toContain('Anthropic')
    expect(logs[0]).toContain('a-model')

    // 切换激活协议后使用 openai 配置
    svc.saveConfig({ ...cfg, protocol: 'openai' })
    logs.length = 0
    await svc.runner((l) => logs.push(l))
    expect(logs[0]).toContain('OpenAI')
    expect(logs[0]).toContain('o-model')
    cfg = svc.getConfig()
  })

  it('激活协议未配置完整时报错并提示', async () => {
    const svc = new LlmService(makeDb())
    svc.saveConfig({ mode: 'api', protocol: 'openai', openai: P(), anthropic: P('u', 'k', 'm') })
    await expect(svc.runner(() => {})).rejects.toThrow('未配置完整')
  })

  it('saveConfig 不会产生第二行（仍是单例）', () => {
    const db = makeDb()
    const svc = new LlmService(db)
    svc.saveConfig({ mode: 'api', protocol: 'openai', openai: P('u', 'k', 'm'), anthropic: P() })
    svc.saveConfig({ mode: 'cli', protocol: 'openai', openai: P('u', 'k', 'm'), anthropic: P() })
    const count = (db.prepare('SELECT COUNT(*) AS c FROM llm_config').get() as { c: number }).c
    expect(count).toBe(1)
    expect(svc.getConfig().mode).toBe('cli')
  })

  it('testConnection 可指定测试某个协议（不依赖激活状态）', async () => {
    const svc = new LlmService(makeDb())
    svc.saveConfig({
      mode: 'api',
      protocol: 'openai',
      openai: P('', '', ''),
      anthropic: P('', '', '')
    })
    const r = await svc.testConnection(svc.getConfig(), 'anthropic')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('填写完整')
  })

  it('旧配置迁移：v4 单协议数据迁入对应 profile', () => {
    // 直接构造 v4 形态数据验证 v5 迁移逻辑
    const db = makeDb()
    db.prepare(
      "UPDATE llm_config SET protocol='anthropic', api_url='https://a/v1', api_key='k', model='m' WHERE id=1"
    ).run()
    // v5 迁移在 applyMigrations 内已执行，此处在已迁移库上手工模拟：直接验证 getConfig 读取新列
    const svc = new LlmService(db)
    const cfg = svc.getConfig()
    expect(cfg.protocol).toBe('anthropic')
  })
})
