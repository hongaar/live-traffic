import { Database } from 'bun:sqlite';
import type { DatabaseDriver } from '../client';

export class SqliteDriver implements DatabaseDriver {
  private db: Database;

  constructor() {
    const dbPath = process.env.DB_PATH || ':memory:';
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    console.log(`[DB] SQLite driver initialized (path: ${dbPath})`);
  }

  async run(sql: string, params?: unknown[]): Promise<void> {
    const stmt = this.db.prepare(sql);
    stmt.run(...((params || []) as any[]));
  }

  async get(sql: string, params?: unknown[]): Promise<any | null> {
    const stmt = this.db.prepare(sql);
    return (stmt.get(...((params || []) as any[])) as any) || null;
  }

  async all(sql: string, params?: unknown[]): Promise<any[]> {
    const stmt = this.db.prepare(sql);
    return (stmt.all(...((params || []) as any[])) as any[]) || [];
  }

  async close(): Promise<void> {
    this.db.close();
    console.log('[DB] SQLite driver closed');
  }
}
