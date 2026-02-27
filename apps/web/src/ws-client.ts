import type { WSClientMessage, WSServerMessage } from '@live-traffic/types';

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onMessage: (msg: WSServerMessage) => void = () => {};
  private onOpen: () => void = () => {};
  private onClose: () => void = () => {};
  private onError: (err: Error) => void = () => {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

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
            this.onMessage(msg);
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

  send(message: WSClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(message));
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

  onMessageHandler(handler: (msg: WSServerMessage) => void): void {
    this.onMessage = handler;
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
