import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './schema';

export type Db = Database.Database;

/**
 * Opens (or creates) the single SQLite file that holds all state, and brings its schema up to date.
 * `:memory:` is used by tests. `reviewDeadlineMs` fills in the deadline of reviews from older versions.
 */
export function openDatabase(path: string, reviewDeadlineMs: number): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, reviewDeadlineMs);
  return db;
}
