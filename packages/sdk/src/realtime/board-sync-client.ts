// P5-04: the SDK board-sync client. One client = one board = one BoardDoc
// (injected factory; the SDK sees only the CRDT interface), speaking contract
// 0.3.0 over an injected WebSocket-like connection with an ordered offline queue,
// ack/serverSeq tracking, backoff reconnect + resyncRequest, and idempotent close.

import type { BoardContent } from "../../../contracts/generated/types.ts";
import type { BoardDoc } from "../../../crdt/dist/packages/crdt/src/index.d.ts";
import { createRequestId } from "../uuid.ts";
import type { CreateSocket, SyncSocket } from "./connection.ts";
import { realTimers, type Timers } from "./timers.ts";

export const SYNC_CONTRACT_VERSION = "0.3.0";

export type BoardSyncStatus = "idle" | "connecting" | "joined" | "offline" | "closed";

export type BoardSyncEvent =
  | { readonly type: "status"; readonly status: BoardSyncStatus; readonly serverSeq: number }
  | { readonly type: "snapshot"; readonly serverSeq: number }
  | { readonly type: "remote"; readonly batchId: string; readonly serverSeq: number }
  | { readonly type: "error"; readonly error: unknown };

export interface BoardSyncClientOptions {
  readonly createSocket: CreateSocket;
  readonly boardId: string;
  readonly tokenRef: string;
  /**
   * The authenticated client id (UUIDv7). Defaults to one generated per
   * board-sync client via createRequestId(); stable across reconnects.
   */
  readonly clientId?: string;
  /** Injected BoardDoc factory (packages/crdt in production; fakes in tests). */
  readonly createDocument: (content: BoardContent) => BoardDoc;
  readonly initialContent: BoardContent;
  readonly contractVersion?: string;
  readonly timers?: Timers;
  readonly backoff?: { readonly initialMs: number; readonly maxMs: number };
  readonly onChange?: (event: BoardSyncEvent) => void;
}

export interface BoardSyncClient {
  start(): void;
  sendOperations(operations: readonly Record<string, unknown>[]): string | null;
  flush(): Promise<void>;
  close(): void;
  status(): BoardSyncStatus;
  serverSeq(): number;
  document(): BoardDoc;
  offlineCount(): number;
  pendingCount(): number;
  lastError(): unknown;
}

const ISO_NOW = (): string => new Date().toISOString();
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function resolveClientId(candidate: string | undefined): string {
  const clientId = candidate ?? createRequestId();
  if (!UUID_V7.test(clientId)) {
    throw new RangeError("clientId must be a UUIDv7 (contract 0.3.0 sync message envelope)");
  }
  return clientId;
}

export function createBoardSyncClient(options: BoardSyncClientOptions): BoardSyncClient {
  const timers = options.timers ?? realTimers;
  const contractVersion = options.contractVersion ?? SYNC_CONTRACT_VERSION;
  const clientId = resolveClientId(options.clientId);
  const backoff = options.backoff ?? { initialMs: 100, maxMs: 2000 };
  let doc = options.createDocument(options.initialContent);
  let socket: SyncSocket | null = null;
  let status: BoardSyncStatus = "idle";
  let serverSeq = 0;
  let clientSeq = 0;
  let pending = new Map<string, number>();
  let queue: Record<string, unknown>[] = [];
  let seenBatches = new Set<string>();
  let reconnectAttempt = 0;
  let reconnectTimer: number | null = null;
  let closedByUser = false;
  let resumeFrom = 0;
  let lastError: unknown = null;
  let flushWaiters: (() => void)[] = [];

  const emit = (event: BoardSyncEvent): void => options.onChange?.(event);
  const setStatus = (next: BoardSyncStatus): void => {
    status = next;
    emit({ type: "status", status, serverSeq });
  };
  const clearReconnect = (): void => {
    if (reconnectTimer !== null) {
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
  const sendJson = (message: Record<string, unknown>): void => {
    if (socket === null) return;
    socket.send(JSON.stringify(message));
  };

  const sendBatch = (operations: readonly Record<string, unknown>[]): string => {
    const batchId = createRequestId();
    clientSeq += 1;
    pending.set(batchId, clientSeq);
    sendJson({
      id: createRequestId(), type: "operationBatch", clientId: clientId, boardId: options.boardId,
      sentAt: ISO_NOW(), seq: clientSeq,
      payload: { batchId, operations },
    });
    return batchId;
  };

  const flushQueue = (): void => {
    if (status !== "joined" || socket === null) return;
    const queued = queue;
    queue = [];
    for (const chunk of groupIntoBatches(queued)) {
      sendBatch(chunk);
    }
    if (queued.length > 0) emit({ type: "status", status, serverSeq });
    for (const resolve of flushWaiters.splice(0)) resolve();
  };

  const onWelcome = (message: Record<string, unknown>): void => {
    const seq = Number(message.serverSeq ?? 0);
    if (Number.isInteger(seq) && seq > serverSeq) serverSeq = seq;
    if (status === "offline" || status === "connecting") {
      // Reconnect: ask for the updates after the last known durable sequence.
      if (resumeFrom > 0) {
        clientSeq += 1;
        sendJson({
          id: createRequestId(), type: "resyncRequest", clientId: clientId, boardId: options.boardId,
          sentAt: ISO_NOW(), seq: clientSeq, payload: { fromServerSeq: resumeFrom },
        });
      }
      setStatus("joined");
      flushQueue();
    }
  };

  const onSnapshot = (message: Record<string, unknown>): void => {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const content = payload["boardContent"] as BoardContent | undefined;
    if (content !== undefined && content !== null) {
      doc = options.createDocument(content);
    }
    const seq = Number(message.serverSeq ?? 0);
    if (Number.isInteger(seq) && seq > serverSeq) serverSeq = seq;
    emit({ type: "snapshot", serverSeq });
    if (status !== "joined") setStatus("joined");
    flushQueue();
  };

  const onAck = (message: Record<string, unknown>): void => {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const batchId = String(payload["batchId"] ?? "");
    pending.delete(batchId);
    const seq = Number(message.serverSeq ?? 0);
    // Only a newer durable sequence advances the client; stale acks are ignored.
    if (Number.isInteger(seq) && seq > serverSeq) serverSeq = seq;
    emit({ type: "status", status, serverSeq });
  };

  const onRemoteBatch = (message: Record<string, unknown>): void => {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const batchId = String(payload["batchId"] ?? "");
    if (batchId.length === 0 || seenBatches.has(batchId)) return; // duplicate suppression
    seenBatches.add(batchId);
    const operations = (payload["operations"] as Record<string, unknown>[]) ?? [];
    for (const operation of operations) {
      try {
        doc.apply(operation as never);
      } catch (error) {
        lastError = error;
        emit({ type: "error", error });
        return;
      }
    }
    const seq = Number(message.serverSeq ?? 0);
    if (Number.isInteger(seq) && seq > serverSeq) serverSeq = seq;
    emit({ type: "remote", batchId, serverSeq });
  };

  const onMessage = (raw: unknown): void => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      emit({ type: "error", error });
      return;
    }
    switch (message["type"]) {
      case "welcome": onWelcome(message); return;
      case "snapshot": onSnapshot(message); return;
      case "ack": onAck(message); return;
      case "operationBatch": onRemoteBatch(message); return;
      case "reject":
        lastError = message["payload"] ?? null;
        emit({ type: "error", error: lastError });
        return;
      default: return;
    }
  };

  const scheduleReconnect = (): void => {
    if (closedByUser || reconnectTimer !== null) return;
    const delay = Math.min(backoff.maxMs, backoff.initialMs * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const onClose = (): void => {
    socket = null;
    pending.clear();
    if (closedByUser) return;
    resumeFrom = serverSeq;
    setStatus("offline");
    scheduleReconnect();
  };

  const connect = (): void => {
    if (closedByUser) return;
    setStatus("connecting");
    const next = options.createSocket();
    socket = next;
    next.addEventListener("open", () => {
      // The handshake starts once the socket is open (real sockets emit open;
      // fake sockets call it immediately after creation).
    });
    next.addEventListener("message", (event) => onMessage(event.data));
    next.addEventListener("close", () => onClose());
    next.addEventListener("error", (error) => {
      lastError = error;
      emit({ type: "error", error });
    });
    // Contract 0.3.0: hello first, then joinBoard.
    clientSeq += 1;
    sendJson({
      id: createRequestId(), type: "hello", clientId: clientId, sentAt: ISO_NOW(), seq: clientSeq,
      payload: { tokenRef: options.tokenRef, contractVersion },
    });
    clientSeq += 1;
    sendJson({
      id: createRequestId(), type: "joinBoard", clientId: clientId, boardId: options.boardId, sentAt: ISO_NOW(), seq: clientSeq,
      payload: {},
    });
    reconnectAttempt = 0;
  };

  return {
    start(): void {
      if (closedByUser || status !== "idle") return;
      connect();
    },
    sendOperations(operations): string | null {
      if (operations.length === 0) return null;
      if (status !== "joined" || socket === null) {
        queue.push(...operations);
        return null;
      }
      return sendBatch(operations);
    },
    async flush(): Promise<void> {
      if (status === "joined") {
        flushQueue();
        return;
      }
      await new Promise<void>((resolve) => flushWaiters.push(resolve));
    },
    close(): void {
      if (closedByUser) return;
      closedByUser = true;
      clearReconnect();
      if (socket !== null && status === "joined") {
        clientSeq += 1;
        sendJson({ id: createRequestId(), type: "leaveBoard", clientId: clientId, boardId: options.boardId, sentAt: ISO_NOW(), seq: clientSeq, payload: {} });
      }
      socket?.close();
      socket = null;
      pending.clear();
      queue = [];
      setStatus("closed");
    },
    status: () => status,
    serverSeq: () => serverSeq,
    document: () => doc,
    offlineCount: () => queue.length,
    pendingCount: () => pending.size,
    lastError: () => lastError,
  };
}

function groupIntoBatches(operations: readonly Record<string, unknown>[]): Record<string, unknown>[][] {
  // The offline queue keeps its order; send it as one batch when possible.
  if (operations.length === 0) return [];
  return [operations as Record<string, unknown>[]];
}
