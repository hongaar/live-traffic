import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { initDb, queryEvents, closeDb } from '@live-traffic/db';
import {
  EventQueryParamsSchema,
  WSClientMessageSchema,
  type WSClientSetFiltersMessage,
  type EventQueryParams,
} from '@live-traffic/types';

const app = new Hono();
const wsConnections = new Map<any, EventQueryParams | null>();

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  })
);

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// REST API: GET /api/events
app.get('/api/events', async (c) => {
  try {
    const query = c.req.query();
    const params = EventQueryParamsSchema.parse({
      type: query.type,
      bbox: query.bbox,
      since: query.since ? parseInt(query.since) : undefined,
      until: query.until ? parseInt(query.until) : undefined,
      limit: query.limit ? parseInt(query.limit) : 100,
    });

    const result = await queryEvents(params);

    return c.json(result);
  } catch (err) {
    console.error('Error querying events:', err);
    return c.json({ error: 'Invalid query parameters' }, 400);
  }
});

// Start server
const PORT = parseInt(process.env.PORT || '3000', 10);

async function start() {
  console.log('🚀 API Server starting...');

  try {
    // Initialize database
    await initDb();
    console.log('✅ Database initialized');

    const server = Bun.serve({
      port: PORT,
      fetch: (req, server) => {
        // Check if this is a WebSocket upgrade request to /ws
        if (req.url.includes('/ws') && req.headers.get('upgrade') === 'websocket') {
          const success = server.upgrade(req);
          if (success) return undefined;
          return new Response('WebSocket upgrade failed', { status: 400 });
        }

        // Route all other requests through Hono
        return app.fetch(req);
      },
      websocket: {
        open: (ws: any) => {
          console.log('[WS] Client connected');
          wsConnections.set(ws, null);
        },

        message: async (ws: any, message: any) => {
          try {
            const data = JSON.parse(message.toString());
            const parsed = WSClientMessageSchema.parse(data);

            if (parsed.method === 'set_filters') {
              const filterMsg = parsed as WSClientSetFiltersMessage;
              const filters = filterMsg.filters;
              wsConnections.set(ws, filters);

              console.log(`[WS] Client set filters:`, filters);

              // Fetch and send historical events
              try {
                const result = await queryEvents(filters);

                ws.send(
                  JSON.stringify({
                    type: 'historical_events',
                    inResponseTo: filterMsg.id,
                    events: result.events,
                    total: result.total,
                    limit: result.limit,
                  })
                );
              } catch (queryErr) {
                console.error('[WS] Error querying events:', queryErr);
                ws.send(
                  JSON.stringify({
                    type: 'error',
                    inResponseTo: filterMsg.id,
                    message: 'Failed to query events',
                  })
                );
              }
            }
          } catch (err) {
            console.error('[WS] Error processing message:', err);
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Invalid message format',
              })
            );
          }
        },

        close: (ws: any) => {
          wsConnections.delete(ws);
          console.log('[WS] Client disconnected');
        },
      },
    });

    console.log(`✅ API listening on http://localhost:${PORT}`);
    console.log(`   REST: GET /api/events`);
    console.log(`   WebSocket: /ws (set_filters method)`);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n📴 Shutting down...');
      server.stop();
      closeDb();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  }
}

start();
