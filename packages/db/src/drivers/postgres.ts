import { Pool } from 'pg';
import type { DatabaseDriver } from '../client';

export class PostgresDriver implements DatabaseDriver {
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL || process.env.DB_URL;

    if (!connectionString) {
      throw new Error(
        'DATABASE_URL or DB_URL environment variable is required for PostgreSQL driver'
      );
    }

    this.pool = new Pool({ connectionString });
    console.log('[DB] PostgreSQL driver initialized');
  }

  async run(sql: string, params?: unknown[]): Promise<void> {
    await this.pool.query(sql, params);
  }

  async get(sql: string, params?: unknown[]): Promise<any | null> {
    const result = await this.pool.query(sql, params);
    return result.rows[0] || null;
  }

  async all(sql: string, params?: unknown[]): Promise<any[]> {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
    console.log('[DB] PostgreSQL driver closed');
  }
}
