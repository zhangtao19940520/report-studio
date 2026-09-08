import type Database from 'better-sqlite3'

export function applyMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

export const MIGRATIONS: string[] = [
  // v1: 初始三表
  `
  CREATE TABLE IF NOT EXISTS project (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    subtitle TEXT,
    backend_repo TEXT,
    frontend_repo TEXT,
    git_author TEXT NOT NULL DEFAULT 'demo-user',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS report (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    report_date TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '[]',
    commits TEXT NOT NULL DEFAULT '[]',
    stat_backend TEXT,
    stat_frontend TEXT,
    content_md TEXT,
    commit_count INTEGER DEFAULT 0,
    files INTEGER,
    insertions INTEGER,
    deletions INTEGER,
    UNIQUE(project_id, report_date)
  );
  CREATE TABLE IF NOT EXISTS generation_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    log TEXT
  );
  `,
  // v2: 汇总报告（周报/月报/自定义区间）
  `
  CREATE TABLE IF NOT EXISTS summary_report (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '[]',
    detail_md TEXT NOT NULL DEFAULT '',
    daily_count INTEGER NOT NULL DEFAULT 0,
    commit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_summary_range
    ON summary_report(project_id, kind, date_from, date_to);
  `,
  // v3: AI 生成器配置（全局单例）
  `
  CREATE TABLE IF NOT EXISTS llm_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL DEFAULT 'cli',
    api_url TEXT,
    api_key TEXT,
    model TEXT
  );
  INSERT OR IGNORE INTO llm_config (id, mode) VALUES (1, 'cli');
  `,
  // v4: API 协议类型（openai 兼容 / anthropic）
  `
  ALTER TABLE llm_config ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai';
  `,
  // v5: 双协议配置并存（protocol 表示当前激活哪个）
  `
  ALTER TABLE llm_config ADD COLUMN openai_url TEXT;
  ALTER TABLE llm_config ADD COLUMN openai_key TEXT;
  ALTER TABLE llm_config ADD COLUMN openai_model TEXT;
  ALTER TABLE llm_config ADD COLUMN anthropic_url TEXT;
  ALTER TABLE llm_config ADD COLUMN anthropic_key TEXT;
  ALTER TABLE llm_config ADD COLUMN anthropic_model TEXT;
  UPDATE llm_config SET
    openai_url = CASE WHEN protocol = 'openai' THEN api_url END,
    openai_key = CASE WHEN protocol = 'openai' THEN api_key END,
    openai_model = CASE WHEN protocol = 'openai' THEN model END,
    anthropic_url = CASE WHEN protocol = 'anthropic' THEN api_url END,
    anthropic_key = CASE WHEN protocol = 'anthropic' THEN api_key END,
    anthropic_model = CASE WHEN protocol = 'anthropic' THEN model END
  WHERE id = 1;
  `
]
