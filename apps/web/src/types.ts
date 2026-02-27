import type { AnyEvent } from '@live-traffic/types';

export interface MapState {
  events: Map<string, AnyEvent>;
  layerVisibility: Record<string, boolean>;
  selectedEventType: string | null;
  wsConnected: boolean;
  subscribed: boolean;
}
