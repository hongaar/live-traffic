export interface Adapter {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AdapterConfig {
  schedule?: string; // cron-like or interval in ms
  mode?: 'poll' | 'subscribe';
  pollIntervalMs?: number;
}
