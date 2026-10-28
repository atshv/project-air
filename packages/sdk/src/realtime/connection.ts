// P5-04: the injected WebSocket-like connection. Browser/Node provide a real
// WebSocket; tests provide a fake pair. The SDK never opens a network itself.

export interface SocketMessageEvent {
  readonly data: unknown;
}

export interface SyncSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: SocketMessageEvent) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: (error: unknown) => void): void;
}

export type CreateSocket = () => SyncSocket;
