import { initDb, closeDb, queryEvents } from '@live-traffic/db';
import { NDWAdapter } from '@live-traffic/adapter-ndw';
import { getLogger, setLogLevel } from '@live-traffic/logger';

const logger = getLogger('RunOnce');

async function main() {
  const logLevel = (process.env.LOG_LEVEL || 'info') as any;
  setLogLevel(logLevel);

  logger.info('Running adapter once...');

  try {
    // Initialize database
    await initDb();

    // Create and start adapter
    const adapter = new NDWAdapter();
    
    logger.info('Starting adapter...');
    await adapter.start();
    
    logger.info('Adapter finished, waiting 5 seconds for data processing...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Query and display results
    const result = await queryEvents({ limit: 1000 });
    const events = result.events;
    
    logger.info(`\n✅ Adapter completed. Total events in database: ${events.length}`);
    
    // Group by type
    const byType: Record<string, number> = {};
    for (const event of events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
    }
    
    logger.info('Events by type:');
    for (const [type, count] of Object.entries(byType)) {
      logger.info(`  ${type}: ${count}`);
    }
    
    // Show sample events
    logger.info('\nSample events (first 5):');
    for (const event of events.slice(0, 5)) {
      logger.info(`  - ${event.type}: ${event.attributes.description || event.attributes.category || event.attributes.message || 'N/A'}`);
    }

    await adapter.stop();
    closeDb();
    process.exit(0);
  } catch (err) {
    logger.error('Fatal error', err);
    closeDb();
    process.exit(1);
  }
}

main();
