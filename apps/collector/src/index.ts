import { initDb, closeDb } from '@live-traffic/db';
import { NDWAdapter } from '@live-traffic/adapter-ndw';
import { AdapterRunner } from './runner';
import { defaultAdapterConfig } from './types';
import { getLogger, setLogLevel } from '@live-traffic/logger';

const logger = getLogger('Collector');

async function main() {
  // Set log level from environment variable (default: info)
  const logLevel = (process.env.LOG_LEVEL || 'info') as any;
  setLogLevel(logLevel);

  logger.info('Live Traffic Collector starting...');

  try {
    // Initialize database
    logger.info('Initializing database...');
    await initDb();

    // Create and configure runner
    const runner = new AdapterRunner(defaultAdapterConfig);

    // Register adapters
    runner.register(new NDWAdapter());

    // Start runner
    await runner.start();

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await runner.stop();
      closeDb();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('Collector running');
  } catch (err) {
    logger.error('Fatal error', err);
    process.exit(1);
  }
}

main();
