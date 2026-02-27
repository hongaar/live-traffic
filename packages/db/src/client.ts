import type { EventQueryParams, RetentionConfig } from '@live-traffic/types';
import type { EventInsert, Source, SourceInsert } from './schema';

// Database driver interface
export interface DatabaseDriver {
  run(sql: string, params?: unknown[]): Promise<void>;
  get(sql: string, params?: unknown[]): Promise<any | null>;
  all(sql: string, params?: unknown[]): Promise<any[]>;
  close(): Promise<void>;
}

// Factory function to create appropriate driver
async function createDriver(): Promise<DatabaseDriver> {
  const dbKind = process.env.DB_KIND || 'sqlite';

  if (dbKind === 'postgres') {
    const { PostgresDriver } = await import('./drivers/postgres');
    return new PostgresDriver();
  } else {
    const { SqliteDriver } = await import('./drivers/sqlite');
    return new SqliteDriver();
  }
}

let driver: DatabaseDriver | null = null;

async function getDriver(): Promise<DatabaseDriver> {
  if (!driver) {
    driver = await createDriver();
  }
  return driver;
}

export async function initDb() {
  const db = await getDriver();

  // Create tables (SQL is mostly compatible, with minor PostgreSQL differences)
  await db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      type TEXT NOT NULL,
      geometry TEXT NOT NULL,
      timestamp BIGINT NOT NULL,
      valid_from BIGINT NOT NULL,
      valid_to BIGINT NOT NULL,
      attributes TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS events_type_timestamp ON events(type, timestamp)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS events_timestamp ON events(timestamp)
  `);

  await db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS events_source_source_id ON events(source, source_id)
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL UNIQUE,
      last_fetch_at BIGINT,
      last_success_at BIGINT,
      cursor TEXT,
      error_message TEXT,
      config TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS sources_adapter_id ON sources(adapter_id)
  `);
}

// Event insertion/upsert
export async function upsertEvents(eventInserts: EventInsert[]) {
  const db = await getDriver();

  for (const event of eventInserts) {
    const geometry = typeof event.geometry === 'string' ? event.geometry : JSON.stringify(event.geometry);
    const attributes = typeof event.attributes === 'string' ? event.attributes : JSON.stringify(event.attributes);

    // Use database-specific upsert syntax
    const dbKind = process.env.DB_KIND || 'sqlite';

    if (dbKind === 'postgres') {
      await db.run(
        `INSERT INTO events (id, source, source_id, type, geometry, timestamp, valid_from, valid_to, attributes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(source, source_id) DO UPDATE SET
           geometry = EXCLUDED.geometry,
           attributes = EXCLUDED.attributes,
           timestamp = EXCLUDED.timestamp,
           valid_from = EXCLUDED.valid_from,
           valid_to = EXCLUDED.valid_to`,
        [event.id, event.source, event.sourceId, event.type, geometry, event.timestamp, event.validFrom, event.validTo, attributes, event.createdAt]
      );
    } else {
      await db.run(
        `INSERT INTO events (id, source, source_id, type, geometry, timestamp, valid_from, valid_to, attributes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source, source_id) DO UPDATE SET
           geometry = excluded.geometry,
           attributes = excluded.attributes,
           timestamp = excluded.timestamp,
           valid_from = excluded.valid_from,
           valid_to = excluded.valid_to`,
        [event.id, event.source, event.sourceId, event.type, geometry, event.timestamp, event.validFrom, event.validTo, attributes, event.createdAt]
      );
    }
  }
}

// Query events
export async function queryEvents(params: EventQueryParams) {
  const db = await getDriver();
  const dbKind = process.env.DB_KIND || 'sqlite';

  let query = 'SELECT * FROM events WHERE 1=1';
  const values: unknown[] = [];
  let paramIndex = 1; // For PostgreSQL

  if (params.type) {
    query += dbKind === 'postgres' ? ` AND type = $${paramIndex++}` : ' AND type = ?';
    values.push(params.type);
  }

  if (params.since) {
    query += dbKind === 'postgres' ? ` AND timestamp >= $${paramIndex++}` : ' AND timestamp >= ?';
    values.push(params.since);
  }

  if (params.until) {
    query += dbKind === 'postgres' ? ` AND timestamp <= $${paramIndex++}` : ' AND timestamp <= ?';
    values.push(params.until);
  }

  // Handle bbox filter (minLon, minLat, maxLon, maxLat)
  if (params.bbox) {
    const [minLon, minLat, maxLon, maxLat] = params.bbox.split(',').map(Number);

    if (dbKind === 'postgres') {
      query += ` AND (
        (geometry::jsonb->'coordinates'->>0)::float >= $${paramIndex} AND
        (geometry::jsonb->'coordinates'->>0)::float <= $${paramIndex + 1} AND
        (geometry::jsonb->'coordinates'->>1)::float >= $${paramIndex + 2} AND
        (geometry::jsonb->'coordinates'->>1)::float <= $${paramIndex + 3}
        OR type = 'travel_time'
      )`;
      paramIndex += 4;
    } else {
      query += ` AND (
        json_extract(geometry, '$.coordinates[0]') >= ? AND
        json_extract(geometry, '$.coordinates[0]') <= ? AND
        json_extract(geometry, '$.coordinates[1]') >= ? AND
        json_extract(geometry, '$.coordinates[1]') <= ?
        OR type = 'travel_time'
      )`;
    }
    values.push(minLon, maxLon, minLat, maxLat);
  }

  query += dbKind === 'postgres' ? ` ORDER BY timestamp DESC LIMIT $${paramIndex}` : ' ORDER BY timestamp DESC LIMIT ?';
  values.push(params.limit);

  const allResults = await db.all(query, values);

  return {
    events: allResults.map((e) => ({
      ...e,
      geometry: typeof e.geometry === 'string' ? JSON.parse(e.geometry) : e.geometry,
      attributes: typeof e.attributes === 'string' ? JSON.parse(e.attributes) : e.attributes,
    })),
    total: allResults.length,
    limit: params.limit,
  };
}

// Source management
export async function getSource(adapterId: string): Promise<Source | null> {
  const db = await getDriver();
  const dbKind = process.env.DB_KIND || 'sqlite';

  const query = dbKind === 'postgres' ? 'SELECT * FROM sources WHERE adapter_id = $1' : 'SELECT * FROM sources WHERE adapter_id = ?';
  const result = await db.get(query, [adapterId]);

  if (!result) return null;

  return {
    ...result,
    config: result.config ? JSON.parse(result.config) : {},
  };
}

export async function upsertSource(source: Omit<SourceInsert, 'config'> & { config?: Record<string, unknown> }) {
  const db = await getDriver();
  const dbKind = process.env.DB_KIND || 'sqlite';
  const now = Date.now();
  const { config, ...rest } = source;

  const existing = await getSource(source.adapterId);

  if (existing) {
    const configValue = config ? JSON.stringify(config) : existing.config;

    if (dbKind === 'postgres') {
      await db.run(
        `UPDATE sources SET
          last_fetch_at = $1,
          last_success_at = $2,
          cursor = $3,
          error_message = $4,
          config = $5,
          updated_at = $6
        WHERE id = $7`,
        [rest.lastFetchAt || null, rest.lastSuccessAt || null, rest.cursor || null, rest.errorMessage || null, configValue, now, existing.id]
      );
    } else {
      await db.run(
        `UPDATE sources SET
          last_fetch_at = ?,
          last_success_at = ?,
          cursor = ?,
          error_message = ?,
          config = ?,
          updated_at = ?
        WHERE id = ?`,
        [rest.lastFetchAt || null, rest.lastSuccessAt || null, rest.cursor || null, rest.errorMessage || null, configValue, now, existing.id]
      );
    }
  } else {
    const id = crypto.randomUUID();
    const configValue = config ? JSON.stringify(config) : null;

    if (dbKind === 'postgres') {
      await db.run(
        `INSERT INTO sources (id, adapter_id, last_fetch_at, last_success_at, cursor, error_message, config, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, source.adapterId, source.lastFetchAt || null, source.lastSuccessAt || null, source.cursor || null, source.errorMessage || null, configValue, now, now]
      );
    } else {
      await db.run(
        `INSERT INTO sources (id, adapter_id, last_fetch_at, last_success_at, cursor, error_message, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, source.adapterId, source.lastFetchAt || null, source.lastSuccessAt || null, source.cursor || null, source.errorMessage || null, configValue, now, now]
      );
    }
  }
}

// Data retention
export async function runRetention(config: RetentionConfig) {
  const db = await getDriver();
  const dbKind = process.env.DB_KIND || 'sqlite';
  const now = Date.now();

  for (const policy of config.policies) {
    const cutoffTime = now - policy.ttlDays * 24 * 60 * 60 * 1000;

    if (dbKind === 'postgres') {
      await db.run('DELETE FROM events WHERE type = $1 AND timestamp <= $2', [policy.type, cutoffTime]);
    } else {
      await db.run('DELETE FROM events WHERE type = ? AND timestamp <= ?', [policy.type, cutoffTime]);
    }
  }

  const defaultCutoff = now - config.defaultTtlDays * 24 * 60 * 60 * 1000;
  const coveredTypes = config.policies.map((p) => p.type);

  if (coveredTypes.length < 5) {
    if (dbKind === 'postgres') {
      const placeholders = coveredTypes.map((_, i) => `$${i + 1}`).join(',');
      await db.run(
        `DELETE FROM events WHERE type NOT IN (${placeholders}) AND timestamp <= $${coveredTypes.length + 1}`,
        [...coveredTypes, defaultCutoff]
      );
    } else {
      const placeholders = coveredTypes.map(() => '?').join(',');
      await db.run(
        `DELETE FROM events WHERE type NOT IN (${placeholders}) AND timestamp <= ?`,
        [...coveredTypes, defaultCutoff]
      );
    }
  }
}

// Close database
export async function closeDb() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
