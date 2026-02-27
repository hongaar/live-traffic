import { Database } from 'bun:sqlite';
import type { EventQueryParams, RetentionConfig } from '@live-traffic/types';
import type { EventInsert, Source, SourceInsert } from './schema';

// Initialize database
const dbPath = process.env.DB_PATH || ':memory:';
const sqlite = new Database(dbPath);
sqlite.exec('PRAGMA journal_mode = WAL');

export async function initDb() {
  // Create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      type TEXT NOT NULL,
      geometry TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      valid_from INTEGER NOT NULL,
      valid_to INTEGER NOT NULL,
      attributes TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS events_type_timestamp ON events(type, timestamp)
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS events_timestamp ON events(timestamp)
  `);

  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS events_source_source_id ON events(source, source_id)
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL UNIQUE,
      last_fetch_at INTEGER,
      last_success_at INTEGER,
      cursor TEXT,
      error_message TEXT,
      config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS sources_adapter_id ON sources(adapter_id)
  `);
}

// Event insertion/upsert
export async function upsertEvents(eventInserts: EventInsert[]) {
  const stmt = sqlite.prepare(`
    INSERT INTO events (id, source, source_id, type, geometry, timestamp, valid_from, valid_to, attributes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, source_id) DO UPDATE SET
      geometry = excluded.geometry,
      attributes = excluded.attributes,
      timestamp = excluded.timestamp,
      valid_from = excluded.valid_from,
      valid_to = excluded.valid_to
  `);

  for (const event of eventInserts) {
    stmt.run(
      event.id,
      event.source,
      event.sourceId,
      event.type,
      typeof event.geometry === 'string' ? event.geometry : JSON.stringify(event.geometry),
      event.timestamp,
      event.validFrom,
      event.validTo,
      typeof event.attributes === 'string' ? event.attributes : JSON.stringify(event.attributes),
      event.createdAt
    );
  }
}

// Query events
export async function queryEvents(params: EventQueryParams) {
  let query = 'SELECT * FROM events WHERE 1=1';
  const values: unknown[] = [];

  if (params.type) {
    query += ' AND type = ?';
    values.push(params.type);
  }

  if (params.since) {
    query += ' AND timestamp >= ?';
    values.push(params.since);
  }

  if (params.until) {
    query += ' AND timestamp <= ?';
    values.push(params.until);
  }

  // Handle bbox filter (minLon, minLat, maxLon, maxLat)
  if (params.bbox) {
    const [minLon, minLat, maxLon, maxLat] = params.bbox.split(',').map(Number);
    query += ` AND (
      json_extract(geometry, '$.coordinates[0]') >= ? AND
      json_extract(geometry, '$.coordinates[0]') <= ? AND
      json_extract(geometry, '$.coordinates[1]') >= ? AND
      json_extract(geometry, '$.coordinates[1]') <= ?
      OR type = 'travel_time'
    )`;
    values.push(minLon, maxLon, minLat, maxLat);
  }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  values.push(params.limit);

  const stmt = sqlite.prepare(query);
  const allResults = stmt.all(...(values as any[])) as any[];

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
  const stmt = sqlite.prepare('SELECT * FROM sources WHERE adapter_id = ?');
  const result = stmt.get(adapterId) as any;
  if (!result) return null;

  return {
    ...result,
    config: result.config ? JSON.parse(result.config) : {},
  };
}

export async function upsertSource(source: Omit<SourceInsert, 'config'> & { config?: Record<string, unknown> }) {
  const now = Date.now();
  const { config, ...rest } = source;

  const existing = await getSource(source.adapterId);

  if (existing) {
    const stmt = sqlite.prepare(`
      UPDATE sources SET
        last_fetch_at = ?,
        last_success_at = ?,
        cursor = ?,
        error_message = ?,
        config = ?,
        updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      ...[
        rest.lastFetchAt || null,
        rest.lastSuccessAt || null,
        rest.cursor || null,
        rest.errorMessage || null,
        config ? JSON.stringify(config) : existing.config,
        now,
        existing.id,
      ] as any[]
    );
  } else {
    const id = crypto.randomUUID();
    const stmt = sqlite.prepare(`
      INSERT INTO sources (id, adapter_id, last_fetch_at, last_success_at, cursor, error_message, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      source.adapterId,
      source.lastFetchAt || null,
      source.lastSuccessAt || null,
      source.cursor || null,
      source.errorMessage || null,
      config ? JSON.stringify(config) : null,
      now,
      now
    );
  }
}

// Data retention
export async function runRetention(config: RetentionConfig) {
  const now = Date.now();

  for (const policy of config.policies) {
    const cutoffTime = now - policy.ttlDays * 24 * 60 * 60 * 1000;
    const stmt = sqlite.prepare('DELETE FROM events WHERE type = ? AND timestamp <= ?');
    stmt.run(policy.type, cutoffTime);
  }

  const defaultCutoff = now - config.defaultTtlDays * 24 * 60 * 60 * 1000;
  const coveredTypes = config.policies.map((p) => p.type);
  if (coveredTypes.length < 5) {
    const placeholders = coveredTypes.map(() => '?').join(',');
    const stmt = sqlite.prepare(
      `DELETE FROM events WHERE type NOT IN (${placeholders}) AND timestamp <= ?`
    );
    stmt.run(...coveredTypes, defaultCutoff);
  }
}

// Close database
export function closeDb() {
  sqlite.close();
}

export { sqlite as db };
