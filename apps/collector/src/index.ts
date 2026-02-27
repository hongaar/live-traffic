import { initDb, closeDb } from '@live-traffic/db';
import { NDWAdapter } from '@live-traffic/adapter-ndw';
import { AdapterRunner } from './runner';
import { defaultAdapterConfig } from './types';

async function main() {
  console.log('🚀 Live Traffic Collector starting...');

  try {
    // Initialize database
    console.log('📦 Initializing database...');
    await initDb();

    // Create and configure runner
    const runner = new AdapterRunner(defaultAdapterConfig);

    // Register adapters
    runner.register(new NDWAdapter());

    // Start runner
    await runner.start();

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n📴 Shutting down...');
      await runner.stop();
      closeDb();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('✅ Collector running');
  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  }
}

main();
