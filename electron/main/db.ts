import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import { applyMigrations } from './schema'

export function openDb(dbPath?: string): Database.Database {
  const file = dbPath ?? path.join(app.getPath('userData'), 'report-studio.db')
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}
