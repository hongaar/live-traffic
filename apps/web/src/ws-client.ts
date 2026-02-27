import type { WSClientMessage, WSServerMessage, EventQueryParams } from '@live-traffic/types';

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onEvent: (data: any) => void = () => {};
  private onOpen: () => void = () => {};
  private onClose: () => void = () => {};
  private onError: (err: Error) => void = () => {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pendingRequests = new Map<string, { resolve: (data: any) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }>();

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.onOpen();
          resolve();
        };

        this.ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string) as WSServerMessage;
            
            // Handle responses to pending requests
            const inResponseTo = (msg as any).inResponseTo;
            if (inResponseTo && this.pendingRequests.has(inResponseTo)) {
              const pending = this.pendingRequests.get(inResponseTo)!;
              clearTimeout(pending.timeout);
              
              if ((msg as any).type === 'error') {
                pending.reject(new Error((msg as any).message));
              } else {
                pending.resolve(msg);
              }
              
              this.pendingRequests.delete(inResponseTo);
              return;
            }

            // Otherwise handle event messages (push notifications)
            if ((msg as any).type === 'event') {
              this.onEvent((msg as any).data);
            }
          } catch (err) {
            console.error('Failed to parse WS message:', err);
          }
        };

        this.ws.onclose = () => {
          this.onClose();
          this.attemptReconnect();
        };

        this.ws.onerror = () => {
          const err = new Error('WebSocket error');
          this.onError(err);
          reject(err);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private send(message: WSClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Set filters to receive historical events and subscribe to new ones
   * @param filters - Query filters (type, bbox, since, until, limit)
   * @returns Promise resolving to historical events
   */
  setFilters(filters: EventQueryParams): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const requestId = `filters-${crypto.randomUUID()}`;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Set filters timeout'));
      }, 10000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      const message = {
        method: 'set_filters',
        id: requestId,
        filters,
      } as any;

      this.send(message);
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  onOpenHandler(handler: () => void): void {
    this.onOpen = handler;
  }

  onEventHandler(handler: (data: any) => void): void {
    this.onEvent = handler;
  }

  onCloseHandler(handler: () => void): void {
    this.onClose = handler;
  }

  onErrorHandler(handler: (err: Error) => void): void {
    this.onError = handler;
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`Attempting to reconnect in ${delay}ms...`);

      setTimeout(() => {
        this.connect().catch((err) => {
          console.error('Reconnection failed:', err);
        });
      }, delay);
    }
  }
}
