import type { Adapter, RetentionConfig } from '@live-traffic/types';
import { runRetention } from '@live-traffic/db';
import { getLogger } from '@live-traffic/logger';
import type { AdapterConfig } from './types';

const logger = getLogger('Runner');

export class AdapterRunner {
  private adapters: Map<string, Adapter> = new Map();
  private config: AdapterConfig;
  private retentionConfig: RetentionConfig;
  private retentionTimer: NodeJS.Timeout | null = null;

  constructor(config: AdapterConfig, retentionConfig?: RetentionConfig) {
    this.config = config;
    this.retentionConfig = retentionConfig || {
      policies: [
        { type: 'incident', ttlDays: 7 },
        { type: 'speed', ttlDays: 1 },
        { type: 'travel_time', ttlDays: 1 },
        { type: 'road_work', ttlDays: 14 },
        { type: 'message_sign', ttlDays: 3 },
      ],
      defaultTtlDays: 30,
    };
  }

  register(adapter: Adapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter with id "${adapter.id}" already registered`);
    }
    this.adapters.set(adapter.id, adapter);
    logger.debug(`Registered adapter: ${adapter.id}`);
  }

  async start(): Promise<void> {
    logger.info('Starting adapters...');
    logger.verbose('Adapter config', this.config);

    const promises = Array.from(this.adapters.values())
      .filter((adapter) => {
        const adapterConfig = this.config.adapters.find((a) => a.id === adapter.id);
        return adapterConfig?.enabled !== false;
      })
      .map((adapter) =>
        adapter.start().catch((err: unknown) => {
          logger.error(`Failed to start adapter ${adapter.id}`, err);
        })
      );

    await Promise.all(promises);

    // Schedule retention job (daily)
    this.retentionTimer = setInterval(() => {
      logger.info('Running retention job...');
      runRetention(this.retentionConfig).catch((err) => {
        logger.error('Retention job failed', err);
      });
    }, 24 * 60 * 60 * 1000); // 24 hours

    logger.info('All adapters started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping all adapters...');

    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
    }

    const promises = Array.from(this.adapters.values()).map((adapter) =>
      adapter.stop().catch((err: unknown) => {
        logger.error(`Error stopping adapter ${adapter.id}`, err);
      })
    );

    await Promise.all(promises);
    logger.info('All adapters stopped');
  }
}
