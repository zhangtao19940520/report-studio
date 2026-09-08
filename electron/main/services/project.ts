import type Database from 'better-sqlite3'
import type { Project, ProjectInput } from '../../../shared/types'

export class ProjectService {
  constructor(private db: Database.Database) {}

  list(): Project[] {
    return this.db.prepare('SELECT * FROM project ORDER BY id').all() as Project[]
  }

  get(id: number): Project | undefined {
    return this.db.prepare('SELECT * FROM project WHERE id = ?').get(id) as Project | undefined
  }

  getByKey(key: string): Project | undefined {
    return this.db.prepare('SELECT * FROM project WHERE key = ?').get(key) as Project | undefined
  }

  create(input: ProjectInput): Project {
    const now = new Date().toISOString()
    const info = this.db
      .prepare(
        `INSERT INTO project (key, name, subtitle, backend_repo, frontend_repo, git_author, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.key,
        input.name,
        input.subtitle ?? null,
        input.backend_repo ?? null,
        input.frontend_repo ?? null,
        input.git_author ?? 'demo-user',
        now
      )
    return this.get(info.lastInsertRowid as number)!
  }

  update(id: number, input: Partial<ProjectInput>): Project | undefined {
    const cur = this.get(id)
    if (!cur) return undefined
    this.db
      .prepare(
        `UPDATE project SET key = ?, name = ?, subtitle = ?, backend_repo = ?, frontend_repo = ?, git_author = ?
         WHERE id = ?`
      )
      .run(
        input.key ?? cur.key,
        input.name ?? cur.name,
        input.subtitle ?? cur.subtitle,
        input.backend_repo ?? cur.backend_repo,
        input.frontend_repo ?? cur.frontend_repo,
        input.git_author ?? cur.git_author,
        id
      )
    return this.get(id)
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM project WHERE id = ?').run(id).changes > 0
  }

  /** 首次启动：若 project 表为空，写入内置默认项目 */
  seedDefaults(defaults: ProjectInput[]): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM project').get() as { c: number }).c
    if (count === 0) {
      const insert = this.db.transaction((rows: ProjectInput[]) => rows.forEach((r) => this.create(r)))
      insert(defaults)
    }
  }
}
