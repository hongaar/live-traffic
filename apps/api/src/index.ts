import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { initDb, queryEvents, closeDb } from '@live-traffic/db';
import {
  EventQueryParamsSchema,
  WSClientMessageSchema,
  type WSQueryMessage,
  type WSSubscribeMessage,
} from '@live-traffic/types';

const app = new Hono();

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

// WebSocket: /ws
app.get('/ws', (c: any) => {
  return c.upgrade((ws: any) => {
    const subscriptions = new Map<string, { type?: string; bbox?: string }>();

    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message);
        const parsed = WSClientMessageSchema.parse(data);

        if (parsed.method === 'query') {
          const queryMsg = parsed as WSQueryMessage;
          const result = await queryEvents(queryMsg.params);

          ws.send(
            JSON.stringify({
              method: 'query_response',
              data: result,
            })
          );
        } else if (parsed.method === 'subscribe') {
          const subMsg = parsed as WSSubscribeMessage;
          const subId = crypto.randomUUID();
          subscriptions.set(subId, {
            type: subMsg.params.type,
            bbox: subMsg.params.bbox,
          });

          console.log(`[WS] Client subscribed with id ${subId}`, subMsg.params);

          ws.send(
            JSON.stringify({
              method: 'subscribed',
              subscriptionId: subId,
            })
          );
        } else if (parsed.method === 'unsubscribe') {
          subscriptions.clear();
          console.log('[WS] Client unsubscribed');
        }
      } catch (err) {
        console.error('[WS] Error processing message:', err);
        ws.send(
          JSON.stringify({
            method: 'error',
            message: 'Invalid message format',
          })
        );
      }
    });

    ws.on('close', () => {
      subscriptions.clear();
      console.log('[WS] Client disconnected');
    });
  });
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
      fetch: app.fetch,
    });

    console.log(`✅ API listening on http://localhost:${PORT}`);
    console.log(`   REST: GET /api/events`);
    console.log(`   WebSocket: /ws`);

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
