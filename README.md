# Live Traffic – Real-time Dutch Traffic Data Collection & Visualization

A TypeScript monorepo built with Bun and Turborepo for collecting, storing, and visualizing live traffic data from NDW (Netherlands). Includes a background collector service, REST/WebSocket API, and a MapLibre-based web dashboard.

## Architecture

```
┌─────────────────┐
│  NDW opendata   │
│  (XML/gzip)     │
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│    Collector        │  (apps/collector)
│    (NDW Adapter)    │  - Pulls feeds
│                     │  - Parses DATEX II
│                     │  - Normalizes events
└────────┬────────────┘
         │
         ▼
┌──────────────────────────┐
│   SQLite / PostgreSQL    │  (packages/db)
│   - Events table         │  - Normalized events
│   - Sources table        │  - Adapter state
│   - Retention policies   │
└────────┬─────────────────┘
         │
    ┌────┴─────────────────────────┐
    ▼                              ▼
┌──────────────┐         ┌──────────────┐
│ API Service  │         │ Web App      │
│ (apps/api)   │◄────────│(apps/web)    │
│ - REST API   │         │ - MapLibre   │
│ - WebSocket  │         │ - Layers     │
└──────────────┘         └──────────────┘
```

## Features

- **Data Collection**: Polls NDW feeds (incidents, speeds, travel times, road work, DRIPS/signs)
- **Normalized Schema**: Five event types (TrafficIncident, SpeedMeasurement, TravelTime, RoadWork, MessageSign)
- **Local Dev Storage**: SQLite via Bun; production-ready PostgreSQL support
- **Data Retention**: Configurable TTL per event type; automatic cleanup
- **REST API**: `GET /api/events` with type, bbox, time, and limit filters
- **WebSocket API**: Query/subscribe protocol for live updates (no auto-send on connect)
- **Web Dashboard**: Real-time map visualization with MapLibre GL JS, layer toggles, popups

## Project Structure

```
live-traffic/
├── apps/
│   ├── collector/          # NDW data collection service
│   │   └── src/
│   │       ├── index.ts    # Entry point
│   │       ├── runner.ts   # Adapter runner + retention scheduler
│   │       ├── types.ts    # Adapter interface
│   │       └── adapters/ndw/
│   │           └── index.ts  # NDW adapter (fetch, parse, normalize)
│   ├── api/                # REST + WebSocket API
│   │   └── src/
│   │       └── index.ts
│   └── web/                # Vite + MapLibre web app
│       ├── index.html
│       ├── src/
│       │   ├── main.ts
│       │   ├── ws-client.ts
│       │   └── types.ts
│       └── vite.config.ts
├── packages/
│   ├── types/              # Shared TypeScript types & Zod schemas
│   │   └── src/
│   │       └── index.ts
│   └── db/                 # Database client & schema
│       └── src/
│           ├── schema.ts   # Drizzle schema
│           └── client.ts   # Query helpers, retention
├── package.json
├── turbo.json
├── tsconfig.json
└── README.md
```

## Prerequisites

- [Bun](https://bun.sh/) (>=1.0.0)
- Node.js (for TypeScript tooling; optional if using Bun directly)

## Setup

### 1. Install Dependencies

```bash
cd /Users/joram/Code/live-traffic
bun install
```

### 2. Database

#### Local Development (SQLite)

Default; no setup required. Database is stored in `.sqlite` by default.

```bash
export DB_PATH=./live-traffic.db
```

Or use in-memory (default for tests):

```bash
export DB_PATH=:memory:
```

#### Production (PostgreSQL)

```bash
export DB_KIND=postgres
export DATABASE_URL=postgresql://user:password@localhost:5432/live_traffic
```

(Requires manual table creation or migration tooling; see [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview) for migrations.)

### 3. Environment Variables

Create a `.env` file or export:

```bash
# Database
export DB_PATH=./live-traffic.db
export DB_KIND=sqlite  # or 'postgres'

# API
export PORT=3000
export CORS_ORIGIN=http://localhost:5173

# Web
export VITE_API_BASE=http://localhost:3000
export VITE_WS_URL=ws://localhost:3000/ws
```

## Running

### Development (All Services)

Start all apps in parallel with Turborepo:

```bash
bun run dev
```

This runs:
- **Collector** on background (logs to stdout)
- **API** on `http://localhost:3000`
- **Web** on `http://localhost:5173`

### Individual Services

#### Collector

```bash
cd apps/collector
bun src/index.ts
```

#### API

```bash
cd apps/api
bun src/index.ts
```

#### Web

```bash
cd apps/web
bun run dev
```

## API Usage

### REST

```bash
# Get all events
curl http://localhost:3000/api/events

# Filter by type
curl http://localhost:3000/api/events?type=incident

# Filter by bounding box (minLon,minLat,maxLon,maxLat)
curl 'http://localhost:3000/api/events?bbox=3.5,50.5,7.2,53.5'

# Filter by time range (Unix ms)
curl 'http://localhost:3000/api/events?since=1700000000000&until=1700100000000'

# Limit results
curl 'http://localhost:3000/api/events?limit=50'

# Health check
curl http://localhost:3000/health
```

### WebSocket

Connect to `ws://localhost:3000/ws`.

#### Query Events

```json
{
  "method": "query",
  "params": {
    "type": "incident",
    "bbox": "3.5,50.5,7.2,53.5",
    "limit": 50
  }
}
```

Response:

```json
{
  "method": "query_response",
  "data": {
    "events": [...],
    "total": 42,
    "limit": 50
  }
}
```

#### Subscribe to Live Updates

```json
{
  "method": "subscribe",
  "params": {
    "type": "incident"
  }
}
```

Server will push new/updated events:

```json
{
  "method": "event",
  "data": { ... event object ... }
}
```

#### Unsubscribe

```json
{
  "method": "unsubscribe"
}
```

## Data Retention

By default, events are retained based on type:

| Type | TTL |
|------|-----|
| incident | 7 days |
| speed | 1 day |
| travel_time | 1 day |
| road_work | 14 days |
| message_sign | 3 days |
| (default) | 30 days |

Configure in `apps/collector/src/runner.ts` or via env (TODO: make configurable).

The retention job runs daily and deletes old events.

## Event Types

### TrafficIncident

```typescript
{
  "id": "uuid",
  "type": "incident",
  "source": "ndw",
  "sourceId": "unique-id-from-ndw",
  "geometry": { "type": "Point", "coordinates": [lon, lat] },
  "timestamp": 1700000000000,
  "validFrom": 1700000000000,
  "validTo": 1700010000000,
  "attributes": {
    "severity": "high",
    "description": "Accident on A4",
    "category": "accident"
  }
}
```

### SpeedMeasurement

```typescript
{
  "type": "speed",
  "attributes": {
    "speed": 75,
    "averageSpeed": 70,
    "flowRate": 1200
  }
}
```

### TravelTime

```typescript
{
  "type": "travel_time",
  "attributes": {
    "duration": 1800,
    "distance": 45000,
    "confidence": 85
  }
}
```

### RoadWork

```typescript
{
  "type": "road_work",
  "attributes": {
    "description": "Pavement works A4",
    "impact": "moderate",
    "lanesClosed": 1,
    "lanesTotal": 3
  }
}
```

### MessageSign

```typescript
{
  "type": "message_sign",
  "attributes": {
    "message": "Reduced speed due to rain",
    "displayDuration": 3600
  }
}
```

## NDW Data Source

- **Base URL**: [https://opendata.ndw.nu/](https://opendata.ndw.nu/)
- **Format**: DATEX II XML (gzipped)
- **Update Frequency**: Every 5–15 minutes
- **Docs**: [NDW DATEX II](https://docs.ndw.nu/dataformaten/)

Feeds used:
- `incidents.xml.gz` → TrafficIncident
- `trafficspeed.xml.gz` → SpeedMeasurement
- `traveltime.xml.gz` → TravelTime
- `wegwerkzaamheden.xml.gz` → RoadWork
- `DRIPS.xml.gz` → MessageSign

## Development

### TypeScript & Linting

```bash
# Type check
bun run typecheck

# Lint (if configured)
bun run lint
```

### Build

```bash
bun run build
```

### Testing

(TODO: add test setup)

## Future Enhancements

- [ ] Real-world DATEX II parsing (currently skeleton)
- [ ] PostgreSQL/TimescaleDB integration
- [ ] Data export (CSV, GeoJSON)
- [ ] Historical analysis & statistics
- [ ] Multiple data sources (HERE, Google Maps API, etc.)
- [ ] Mobile app
- [ ] Docker deployment

## License

MIT

## Contributing

1. Create a feature branch
2. Make changes
3. Test locally
4. Submit PR

## Contact

For issues or questions, open a GitHub issue.
