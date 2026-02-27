import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import type { DatabaseDriver } from '../client';

export class SqliteDriver implements DatabaseDriver {
  private db: Database;

  constructor() {
    let dbPath = process.env.DB_PATH || ':memory:';
    
    // Resolve relative paths from workspace root
    // File structure: packages/db/src/drivers/sqlite.ts
    // From __dirname, go up 4 levels to reach workspace root
    if (dbPath !== ':memory:' && !dbPath.startsWith('/')) {
      const workspaceRoot = resolve(__dirname, '../../../../');
      dbPath = resolve(workspaceRoot, dbPath);
    }
    
    this.db = new Database(dbPath);
    
    // For file-based DB with multiple processes:
    // - WAL mode is good for concurrent access (readers don't block writers)
    // - Increase timeout to handle lock contention
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000'); // 5 second timeout
    this.db.exec('PRAGMA synchronous = NORMAL'); // Better performance for dev
    
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
