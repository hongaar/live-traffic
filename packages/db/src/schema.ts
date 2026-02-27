// Database schema types - flexible for both SQLite and PostgreSQL
export type Event = {
  id: string;
  source: string;
  sourceId: string;
  type: string;
  geometry: string | object;
  timestamp: number;
  validFrom: number;
  validTo: number;
  attributes: string | object;
  createdAt: number;
};

export type EventInsert = {
  id: string;
  source: string;
  sourceId: string;
  type: string;
  geometry: string | object;
  timestamp: number;
  validFrom: number;
  validTo: number;
  attributes: string | object;
  createdAt: number;
};

export type Source = {
  id: string;
  adapterId: string;
  lastFetchAt?: number | null;
  lastSuccessAt?: number | null;
  cursor?: string | null;
  errorMessage?: string | null;
  config?: object | null;
  createdAt: number;
  updatedAt: number;
};

export type SourceInsert = {
  adapterId: string;
  lastFetchAt?: number | null;
  lastSuccessAt?: number | null;
  cursor?: string | null;
  errorMessage?: string | null;
  config?: object | null;
};
