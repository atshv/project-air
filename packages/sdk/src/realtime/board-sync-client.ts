// P5-04: the SDK board-sync client. One client = one board = one BoardDoc
// (injected factory; the SDK sees only the CRDT interface), speaking contract
// 0.5.0 over an injected WebSocket-like connection with an ordered offline queue,
// ack/serverSeq tracking, backoff reconnect + resyncRequest, and idempotent close.

import type { BoardContent } from "../../../contracts/generated/types.ts";
import { createYjsBoardDoc } from "@project-air/crdt";
import type { BoardDoc } from "@project-air/crdt";
import { createRequestId } from "../uuid.ts";
import type { CreateSocket, SyncSocket } from "./connection.ts";
import { realTimers, type Timers } from "./timers.ts";

export const SYNC_CONTRACT_VERSION = "0.5.0";
export const PRESENCE_THROTTLE_MS = 50;

export type BoardSyncStatus = "idle" | "connecting" | "joined" | "offline" | "closed";

export type BoardSyncEvent =
  | { readonly type: "status"; readonly status: BoardSyncStatus; readonly serverSeq: number }
  | { readonly type: "snapshot"; readonly serverSeq: number }
  | { readonly type: "remote"; readonly batchId: string; readonly serverSeq: number }
  | { readonly type: "ack"; readonly batchId: string; readonly serverSeq: number }
  | { readonly type: "error"; readonly error: unknown };

export interface PresenceCursor {
  readonly x: number;
  readonly y: number;
}

export interface RemoteParticipant {
  readonly clientId: string;
  readonly nameRef: string;
  readonly colorRef: string;
  readonly cursor: PresenceCursor;
  readonly selection: readonly string[];
}

export interface BoardSyncClientOptions {
  readonly createSocket: CreateSocket;
  readonly boardId: string;
  readonly tokenRef: string;
  /**
   * The authenticated client id (UUIDv7). Defaults to one generated per
   * board-sync client via createRequestId(); stable across reconnects.
   */
  readonly clientId?: string;
  /** Optional BoardDoc factory; defaults to the real Yjs document from packages/crdt (fakes for tests). */
  readonly createDocument?: ((content: BoardContent) => BoardDoc) | undefined;
  readonly initialContent: BoardContent;
  readonly contractVersion?: string;
  readonly timers?: Timers;
  readonly backoff?: { readonly initialMs: number; readonly maxMs: number };
  readonly onChange?: (event: BoardSyncEvent) => void;
  readonly presenceThrottleMs?: number;
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
  /**
   * P6-10: the browser went offline. Closes the (possibly half-open) socket,
   * keeps unacknowledged operations for the reconnect and reports `offline`
   * instead of reconnecting in a loop; `goOnline` resumes the connection.
   */
  goOffline(): void;
  /** P6-10: the browser is online again; reconnect and flush the kept operations. */
  goOnline(): void;
  /** P5-05: throttled outbound cursor/selection (name/colour are server-derived). */
  updatePresence(presence: { cursor: PresenceCursor; selection: readonly string[] }): void;
  participants(): readonly RemoteParticipant[];
  onPresence(listener: (participants: readonly RemoteParticipant[]) => void): () => void;
  /** L11 realtime: undo exactly the client's own newest operation (never remote ones). */
  undoOwn(): boolean;
  /** L11 realtime: redo the last undo locally (client's own operation only). */
  redoOwn(): boolean;
  ownUndoCount(): number;
  ownRedoCount(): number;
}

const ISO_NOW = (): string => new Date().toISOString();
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function resolveClientId(candidate: string | undefined): string {
  const clientId = candidate ?? createRequestId();
  if (!UUID_V7.test(clientId)) {
    throw new RangeError("clientId must be a UUIDv7 (contract 0.5.0 sync message envelope)");
  }
  return clientId;
}

export function createBoardSyncClient(options: BoardSyncClientOptions): BoardSyncClient {
  const timers = options.timers ?? realTimers;
  const contractVersion = options.contractVersion ?? SYNC_CONTRACT_VERSION;
  const clientId = resolveClientId(options.clientId);
  const backoff = options.backoff ?? { initialMs: 100, maxMs: 2000 };
  const makeDocument = options.createDocument ?? ((content: BoardContent): BoardDoc => createYjsBoardDoc({ content }));
  let doc = makeDocument(options.initialContent);
  let socket: SyncSocket | null = null;
  let status: BoardSyncStatus = "idle";
  let serverSeq = 0;
  let clientSeq = 0;
  let pending = new Map<string, { seq: number; operations: Record<string, unknown>[] }>();
  let queue: Record<string, unknown>[] = [];
  let seenBatches = new Set<string>();
  let reconnectAttempt = 0;
  let reconnectTimer: number | null = null;
  let closedByUser = false;
  let resumeFrom = 0;
  let suspended = false;
  let lastError: unknown = null;
  let flushWaiters: (() => void)[] = [];
  const participants = new Map<string, RemoteParticipant>();
  const presenceListeners = new Set<(participants: readonly RemoteParticipant[]) => void>();
  let presenceTimer: number | null = null;
  let pendingPresence: { cursor: PresenceCursor; selection: readonly string[] } | null = null;
  const presenceThrottle = options.presenceThrottleMs ?? PRESENCE_THROTTLE_MS;
  // L11 realtime: only the client's OWN operations are recorded with their
  // inverses; remote batches never enter this history.
  let ownUndo: { operation: Record<string, unknown>; inverse: Record<string, unknown> }[] = [];
  let ownRedo: { operation: Record<string, unknown>; inverse: Record<string, unknown> }[] = [];

  const emit = (event: BoardSyncEvent): void => options.onChange?.(event);
  const emitParticipants = (): void => {
    const list = [...participants.values()];
    for (const listener of presenceListeners) listener(list);
  };
  const clearParticipants = (): void => { if (participants.size > 0) { participants.clear(); emitParticipants(); } };
  const flushPresence = (): void => {
    presenceTimer = null;
    const pending = pendingPresence;
    pendingPresence = null;
    if (pending === null || status !== "joined" || socket === null) return;
    clientSeq += 1;
    sendJson({
      id: createRequestId(), type: "presence", clientId, boardId: options.boardId, sentAt: ISO_NOW(), seq: clientSeq,
      payload: { nameRef: "user:self", colorRef: "tone-a", cursor: pending.cursor, selection: pending.selection },
    });
  };
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
    // Local-first: the SDK applies its own operations optimistically through the
    // documented BoardDoc path so the client sees its edit immediately; the ack
    // then advances the durable serverSeq.
    for (const operation of operations) {
      try { doc.apply(operation as never); } catch (error) { lastError = error; emit({ type: "error", error }); }
    }
    const batchId = createRequestId();
    clientSeq += 1;
    pending.set(batchId, { seq: clientSeq, operations: [...operations] });
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
      // Do not flush the offline queue yet: the server sends the snapshot after
      // welcome; flushing before it would be overwritten by the snapshot.
    }
  };

  const onSnapshot = (message: Record<string, unknown>): void => {
    clearParticipants();
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const content = payload["boardContent"] as BoardContent | undefined;
    if (content !== undefined && content !== null) {
      doc = makeDocument(content);
      // Re-apply optimistic operations that are still awaiting their ack: a
      // catch-up snapshot may not include them yet, and they must not vanish
      // from the local document.
      for (const entry of pending.values()) {
        for (const operation of entry.operations) {
          try { doc.apply(operation as never); } catch (error) { lastError = error; emit({ type: "error", error }); }
        }
      }
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
    if (batchId.length > 0) emit({ type: "ack", batchId, serverSeq });
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
      case "presence": {
        const payload = (message.payload ?? {}) as Record<string, unknown>;
        const participantId = String(message.clientId ?? "");
        const cursor = (payload["cursor"] ?? {}) as Record<string, unknown>;
        const selection = (payload["selection"] as string[]) ?? [];
        const x = Number(cursor["x"] ?? 0);
        const y = Number(cursor["y"] ?? 0);
        if (participantId.length > 0) {
          // Removal sentinel: empty selection and cursor at the origin (the
          // contract 0.5.0 has no separate leave message; documented).
          if (selection.length === 0 && x === 0 && y === 0) {
            if (participants.delete(participantId)) emitParticipants();
          } else {
            participants.set(participantId, { clientId: participantId, nameRef: String(payload["nameRef"] ?? ""), colorRef: String(payload["colorRef"] ?? ""), cursor: { x, y }, selection });
            emitParticipants();
          }
        }
        return;
      }
      case "reject":
        lastError = message["payload"] ?? null;
        emit({ type: "error", error: lastError });
        return;
      default: return;
    }
  };

  const scheduleReconnect = (): void => {
    if (closedByUser || suspended || reconnectTimer !== null) return;
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
    clearParticipants();
    if (closedByUser) return;
    resumeFrom = serverSeq;
    setStatus("offline");
    scheduleReconnect();
  };

  const connect = (): void => {
    if (closedByUser || suspended) return;
    setStatus("connecting");
    const next = options.createSocket();
    socket = next;
    // Contract 0.5.0: hello first, then joinBoard. The handshake starts once the
    // socket is open (real WebSockets reject send() before open; fake sockets
    // without readyState send immediately).
    let handshakeStarted = false;
    const startHandshake = (): void => {
      if (handshakeStarted) return;
      handshakeStarted = true;
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
    };
    next.addEventListener("open", startHandshake);
    next.addEventListener("message", (event) => onMessage(event.data));
    next.addEventListener("close", () => onClose());
    next.addEventListener("error", (error) => {
      lastError = error;
      emit({ type: "error", error });
    });
    const readyState = (next as unknown as { readyState?: number }).readyState;
    if (readyState === undefined || readyState === 1) startHandshake();
    reconnectAttempt = 0;
  };

  return {
    start(): void {
      if (closedByUser || status !== "idle") return;
      connect();
    },
    sendOperations(operations): string | null {
      if (operations.length === 0) return null;
      for (const operation of operations) {
        const inverse = (operation as { inverse?: Record<string, unknown> }).inverse;
        if (inverse !== undefined) {
          ownUndo.push({ operation, inverse });
          ownRedo = [];
        }
      }
      if (status !== "joined" || socket === null) {
        // Offline: apply locally now, queue in order and send on reconnect.
        for (const operation of operations) {
          try { doc.apply(operation as never); } catch (error) { lastError = error; emit({ type: "error", error }); }
        }
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
    goOffline(): void {
      if (closedByUser) return;
      suspended = true;
      clearReconnect();
      // Operations sent on a connection the network just closed were not
      // acknowledged; keep them in order for the reconnect instead of losing
      // them with the pending map. Reapplying them is idempotent per operation
      // id on the server document.
      for (const entry of pending.values()) {
        queue.push(...entry.operations);
      }
      pending.clear();
      pendingPresence = null;
      if (socket !== null) {
        const closing = socket;
        socket = null;
        closing.close();
      }
      clearParticipants();
      if (status !== "offline") setStatus("offline");
    },
    goOnline(): void {
      if (closedByUser) return;
      suspended = false;
      if (status === "joined") return;
      clearReconnect();
      connect();
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
      if (presenceTimer !== null) { timers.clearTimeout(presenceTimer); presenceTimer = null; }
      pendingPresence = null;
      clearParticipants();
      setStatus("closed");
    },
    status: () => status,
    serverSeq: () => serverSeq,
    document: () => doc,
    offlineCount: () => queue.length,
    pendingCount: () => pending.size,
    lastError: () => lastError,
    updatePresence(presence): void {
      pendingPresence = { cursor: { x: presence.cursor.x, y: presence.cursor.y }, selection: [...presence.selection] };
      if (presenceTimer === null) presenceTimer = timers.setTimeout(() => flushPresence(), presenceThrottle);
    },
    participants: () => [...participants.values()],
    onPresence(listener): () => void {
      presenceListeners.add(listener);
      return () => presenceListeners.delete(listener);
    },
    undoOwn(): boolean {
      const entry = ownUndo.pop();
      if (entry === undefined) return false;
      // P6-13: the embedded inverse is the contract inverse shape (board, type,
      // payload) of the undone operation, not the whole operation envelope, so
      // the undo batch validates against sync.schema.json.
      const inverseOperation: Record<string, unknown> = {
        id: createRequestId(), boardId: options.boardId, actorId: clientId, createdAt: ISO_NOW(),
        type: entry.inverse["type"], payload: entry.inverse["payload"],
        inverse: { boardId: options.boardId, type: entry.operation["type"], payload: entry.operation["payload"] },
      };
      ownRedo.push(entry);
      // The inverse is a new local operation batch; remote operations are never
      // touched. Recording this inverse as an own op lets a later undo redo it.
      ownUndo.push({ operation: inverseOperation, inverse: entry.operation });
      if (status === "joined" && socket !== null) sendBatch([inverseOperation]);
      else queue.push(inverseOperation);
      return true;
    },
    redoOwn(): boolean {
      const entry = ownRedo.pop();
      if (entry === undefined) return false;
      ownUndo.push({ operation: entry.operation, inverse: entry.inverse });
      if (status === "joined" && socket !== null) sendBatch([entry.operation]);
      else queue.push(entry.operation);
      return true;
    },
    ownUndoCount: () => ownUndo.length,
    ownRedoCount: () => ownRedo.length,
  };
}

function groupIntoBatches(operations: readonly Record<string, unknown>[]): Record<string, unknown>[][] {
  // The offline queue keeps its order; send it as one batch when possible.
  if (operations.length === 0) return [];
  return [operations as Record<string, unknown>[]];
}
