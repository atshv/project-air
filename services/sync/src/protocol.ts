// P5-03: protocol 0.3.0 session over one WebSocket connection.
// hello-first, once-per-connection version negotiation, authorized joinBoard,
// durable operationBatch (append committed before ack) and catch-up/resync.
// The authorizer, store and document factory are injected, so tests fake them.

import type { BoardContent } from "./types.ts";

export const SYNC_CONTRACT_VERSION = "0.3.0";

export interface SessionIdentity {
  readonly userId: string;
}

export interface SessionAuthenticator {
  /** Validates the hello token reference; null means unauthorized. */
  authenticate(tokenRef: string): Promise<SessionIdentity | null>;
}

export interface BoardAuthorizer {
  canJoin(userId: string, boardId: string): Promise<boolean>;
}

export interface StoredUpdate {
  readonly serverSeq: number;
  readonly update: string;
}

export interface BoardState {
  readonly serverSeq: number;
  /** Sequence of the snapshot the content was loaded from; updates after it replay. */
  readonly snapshotSeq: number;
  readonly docState?: string | null;
  readonly boardContent: BoardContent;
}

export interface SyncStore {
  /** Current durable per-board serverSeq (0 when the board has no rows yet). */
  serverSeq(boardId: string): Promise<number>;
  loadBoard(boardId: string): Promise<BoardState | null>;
  saveSnapshotDocState?(input: { boardId: string; snapshotSeq: number; docState: string }): Promise<void>;
  /**
   * Appends one encoded update and returns its per-board serverSeq in one
   * transaction; it must commit before the caller may ack.
   */
  appendUpdate(input: { boardId: string; clientId: string; messageId: string; update: string }): Promise<number>;
  updatesAfter(boardId: string, fromServerSeq: number, limit?: number): Promise<StoredUpdate[]>;
}

export interface BoardDocument {
  apply(operation: unknown): void;
  encodeUpdate(): string;
  applyUpdate(update: string): void;
  snapshot(): BoardContent;
  stateVector(): string;
}

export interface BoardDocumentFactory {
  fromContent(content: BoardContent): BoardDocument;
  fromEmpty(): BoardDocument;
}

export interface SyncMessage {
  readonly id: string;
  readonly type: string;
  readonly clientId: string;
  readonly boardId?: string;
  readonly seq?: number;
  readonly sentAt?: string;
  readonly serverSeq?: number;
  readonly payload?: Record<string, unknown>;
}

export interface SendMessage {
  (message: Record<string, unknown>): void;
}

export interface CreateSyncSessionOptions {
  readonly send: SendMessage;
  readonly authenticator: SessionAuthenticator;
  readonly authorizer: BoardAuthorizer;
  readonly store: SyncStore;
  readonly documents: BoardDocumentFactory;
  readonly now?: () => string;
  readonly broadcast?: (boardId: string, message: Record<string, unknown>, exceptClientId: string) => void;
  /** P5-06: graceful shutdown — when false, no ack is sent after the update committed. */
  readonly shouldAck?: () => boolean;
  /** P5-05: ephemeral presence hub (no persistence). */
  readonly presence?: {
    publish(input: { boardId: string; clientId: string; userId: string; messageId: string; seq: number; sentAt: string; payload: unknown }): boolean;
    join(input: { boardId: string; clientId: string; userId: string; send: (message: Record<string, unknown>) => void }): void;
    remove(boardId: string, clientId: string): void;
  };
}

interface SessionState {
  identity: SessionIdentity | null;
  helloSeen: boolean;
  contractVersion: string;
  joinedBoard: string | null;
  doc: BoardDocument | null;
  lastServerSeq: number;
  snapshotSent: boolean;
  clientId: string;
}

// Contract 0.3.0 wire error codes (sync.schema.json #/$defs/errorCode).
const REJECT_CODES = {
  unauthorized: "AUTH_REQUIRED",
  helloRequired: "VALIDATION",
  versionMismatch: "VALIDATION",
  forbidden: "FORBIDDEN",
  notJoined: "VALIDATION",
  invalidMessage: "VALIDATION",
  persistenceFailed: "INTERNAL",
} as const;

const sentAt = (): string => new Date().toISOString();

export class SyncSession {
  readonly #options: CreateSyncSessionOptions;
  #state: SessionState = {
    identity: null,
    helloSeen: false,
    contractVersion: SYNC_CONTRACT_VERSION,
    joinedBoard: null,
    doc: null,
    lastServerSeq: 0,
    snapshotSent: false,
    clientId: "",
  };

  constructor(options: CreateSyncSessionOptions) {
    this.#options = options;
  }

  get joinedBoard(): string | null { return this.#state.joinedBoard; }
  get helloSeen(): boolean { return this.#state.helloSeen; }
  get lastServerSeq(): number { return this.#state.lastServerSeq; }
  get clientId(): string { return this.#state.clientId; }

  /** Handles one decoded text frame; returns the messages sent (for assertions). */
  async receive(text: string): Promise<Record<string, unknown>[]> {
    const sent: Record<string, unknown>[] = [];
    const send = (message: Record<string, unknown>): void => {
      sent.push(message);
      this.#options.send(message);
    };
    let message: SyncMessage;
    try {
      message = JSON.parse(text) as SyncMessage;
    } catch {
      this.#reject(send, null, REJECT_CODES.invalidMessage, "message is not valid JSON");
      return sent;
    }
    if (message === null || typeof message !== "object" || typeof message.type !== "string" || typeof message.id !== "string") {
      this.#reject(send, message, REJECT_CODES.invalidMessage, "message envelope is missing id/type/clientId");
      return sent;
    }
    if (!this.#state.helloSeen) {
      if (message.type !== "hello") {
        this.#reject(send, message, REJECT_CODES.helloRequired, "the first message must be hello");
        return sent;
      }
      return this.#hello(message, send);
    }
    switch (message.type) {
      case "hello":
        this.#reject(send, message, REJECT_CODES.invalidMessage, "hello may only be sent once per connection");
        return sent;
      case "joinBoard":
        await this.#joinBoard(message, send);
        return sent;
      case "operationBatch":
        await this.#operationBatch(message, send);
        return sent;
      case "resyncRequest":
        await this.#resync(message, send);
        return sent;
      case "leaveBoard":
        this.#leaveBoard(message, send);
        return sent;
      case "presence": {
        if (this.#state.joinedBoard === null || this.#state.identity === null) {
          this.#reject(send, message, REJECT_CODES.notJoined, "presence requires joinBoard first");
          return sent;
        }
        if (this.#options.presence === undefined) {
          this.#reject(send, message, REJECT_CODES.invalidMessage, "presence is not enabled");
          return sent;
        }
        const accepted = this.#options.presence.publish({
          boardId: this.#state.joinedBoard, clientId: message.clientId, userId: this.#state.identity.userId,
          messageId: message.id, seq: Number(message.seq ?? 0), sentAt: String(message.sentAt ?? ""), payload: message.payload,
        });
        if (!accepted) this.#reject(send, message, REJECT_CODES.invalidMessage, "invalid presence payload");
        return sent;
      }
      default:
        this.#reject(send, message, REJECT_CODES.invalidMessage, `unsupported message type ${JSON.stringify(message.type)}`);
        return sent;
    }
  }

  async #hello(message: SyncMessage, send: SendMessage): Promise<Record<string, unknown>[]> {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const tokenRef = payload["tokenRef"];
    const version = payload["contractVersion"] ?? this.#state.contractVersion;
    if (typeof tokenRef !== "string" || tokenRef.length === 0) {
      this.#reject(send, message, REJECT_CODES.unauthorized, "hello carries no tokenRef");
      return [];
    }
    if (version !== SYNC_CONTRACT_VERSION) {
      this.#reject(send, message, REJECT_CODES.versionMismatch, `contractVersion must be ${SYNC_CONTRACT_VERSION}`, version);
      return [];
    }
    const identity = await this.#options.authenticator.authenticate(tokenRef);
    if (identity === null) {
      this.#reject(send, message, REJECT_CODES.unauthorized, "session token rejected");
      return [];
    }
    this.#state.identity = identity;
    this.#state.helloSeen = true;
    this.#state.clientId = message.clientId;
    this.#state.contractVersion = SYNC_CONTRACT_VERSION;
    return [];
  }

  async #joinBoard(message: SyncMessage, send: SendMessage): Promise<void> {
    const boardId = message.boardId ?? String((message.payload ?? {})["boardId"] ?? "");
    if (this.#state.identity === null || boardId.length === 0) {
      this.#reject(send, message, REJECT_CODES.invalidMessage, "joinBoard needs a boardId");
      return;
    }
    const allowed = await this.#options.authorizer.canJoin(this.#state.identity.userId, boardId);
    if (!allowed) {
      this.#reject(send, message, REJECT_CODES.forbidden, "the session has no access to this board");
      return;
    }
    await this.#loadBoard(boardId);
    this.#state.joinedBoard = boardId;
    const seq = this.#state.lastServerSeq;
    send({
      id: message.id, type: "welcome", clientId: message.clientId, boardId,
      sentAt: sentAt(), serverSeq: seq,
      payload: { contractVersion: SYNC_CONTRACT_VERSION, snapshotRef: `${boardId}:${seq}` },
    });
    this.#options.presence?.join({
      boardId, clientId: message.clientId, userId: this.#state.identity.userId,
      send: (presenceMessage) => send(presenceMessage),
    });
    if (this.#state.doc !== null && !this.#state.snapshotSent) {
      this.#state.snapshotSent = true;
      send({
        id: message.id, type: "snapshot", clientId: message.clientId, boardId, sentAt: sentAt(), serverSeq: seq,
        payload: { snapshotRef: `${boardId}:${seq}`, boardContent: this.#state.doc.snapshot() },
      });
    }
  }

  async #loadBoard(boardId: string): Promise<void> {
    const state = await this.#options.store.loadBoard(boardId);
    if (state === null) {
      // The contract starts every fresh board at serverSeq 1 (empty catch-up).
      this.#state.lastServerSeq = 1;
      this.#state.doc = this.#options.documents.fromEmpty();
      return;
    }
    this.#state.lastServerSeq = state.serverSeq;
    // Rebuild the exact CRDT history: a stored encoded doc state is applied to a
    // document with no entity structs, so updates committed after the snapshot
    // merge deterministically (constructing entities from JSON first would create
    // concurrent duplicate structs and could lose committed updates).
    const boardOnly = { ...state.boardContent, zones: [], blocks: [], cards: [], notes: [], edges: [] };
    const doc = state.docState != null
      ? this.#options.documents.fromContent(boardOnly)
      : this.#options.documents.fromContent(state.boardContent);
    if (state.docState != null) doc.applyUpdate(state.docState);
    const hasEntities = [state.boardContent.zones, state.boardContent.blocks, state.boardContent.cards, state.boardContent.notes, state.boardContent.edges].some((entities) => entities.length > 0);
    if (state.docState == null && hasEntities && typeof this.#options.store.saveSnapshotDocState === "function") {
      await this.#options.store.saveSnapshotDocState({ boardId, snapshotSeq: state.snapshotSeq, docState: doc.encodeUpdate() });
    }
    const updates = await this.#options.store.updatesAfter(boardId, state.snapshotSeq);
    for (const update of updates) doc.applyUpdate(update.update);
    this.#state.doc = doc;
  }

  async #operationBatch(message: SyncMessage, send: SendMessage): Promise<void> {
    if (this.#state.joinedBoard === null || this.#state.doc === null) {
      this.#reject(send, message, REJECT_CODES.notJoined, "operationBatch requires joinBoard first");
      return;
    }
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const operations = payload["operations"];
    const batchId = payload["batchId"];
    if (!Array.isArray(operations) || operations.length === 0 || typeof batchId !== "string") {
      this.#reject(send, message, REJECT_CODES.invalidMessage, "operationBatch needs a batchId and operations");
      return;
    }
    let update: string;
    try {
      for (const operation of operations) this.#state.doc.apply(operation);
      update = this.#state.doc.encodeUpdate();
    } catch (error) {
      this.#reject(send, message, REJECT_CODES.invalidMessage, `operation rejected: ${String((error as Error).message)}`);
      return;
    }
    // Durability ordering (AD-2): append and commit the encoded update with the
    // next per-board serverSeq BEFORE the ack is sent; a failed append produces a
    // reject and never an ack.
    let serverSeq: number;
    try {
      serverSeq = await this.#options.store.appendUpdate({
        boardId: this.#state.joinedBoard, clientId: message.clientId, messageId: message.id, update,
      });
    } catch {
      this.#reject(send, message, REJECT_CODES.persistenceFailed, "the update could not be persisted");
      return;
    }
    this.#state.lastServerSeq = serverSeq;
    // Graceful shutdown: the update may already be durable, but once shutdown has
    // started no ack is sent (the client retries; the contract ack is the only
    // success signal).
    if (this.#options.shouldAck !== undefined && !this.#options.shouldAck()) {
      return;
    }
    send({
      id: message.id, type: "ack", clientId: message.clientId, boardId: this.#state.joinedBoard, sentAt: sentAt(), serverSeq,
      payload: { batchId, opIds: operations.map((operation) => String((operation as { id?: string }).id ?? "")) },
    });
    this.#options.broadcast?.(this.#state.joinedBoard, {
      id: message.id, type: "operationBatch", clientId: message.clientId, boardId: this.#state.joinedBoard, sentAt: sentAt(), serverSeq,
      payload: { batchId, operations },
    }, message.clientId);
  }

  async #resync(message: SyncMessage, send: SendMessage): Promise<void> {
    if (this.#state.joinedBoard === null || this.#state.doc === null) {
      this.#reject(send, message, REJECT_CODES.notJoined, "resyncRequest requires joinBoard first");
      return;
    }
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    const fromServerSeq = Number(payload["fromServerSeq"] ?? 0);
    if (!Number.isInteger(fromServerSeq) || fromServerSeq < 0 || fromServerSeq > this.#state.lastServerSeq) {
      this.#reject(send, message, REJECT_CODES.invalidMessage, "fromServerSeq must be between 0 and the board serverSeq");
      return;
    }
    const updates = await this.#options.store.updatesAfter(this.#state.joinedBoard, fromServerSeq);
    for (const update of updates) this.#state.doc.applyUpdate(update.update);
    send({
      id: message.id, type: "welcome", clientId: message.clientId, boardId: this.#state.joinedBoard,
      sentAt: sentAt(), serverSeq: this.#state.lastServerSeq,
      payload: { contractVersion: SYNC_CONTRACT_VERSION, snapshotRef: `${this.#state.joinedBoard}:${this.#state.lastServerSeq}` },
    });
    send({
      id: message.id, type: "snapshot", clientId: message.clientId, boardId: this.#state.joinedBoard,
      sentAt: sentAt(), serverSeq: this.#state.lastServerSeq,
      payload: { snapshotRef: `${this.#state.joinedBoard}:${this.#state.lastServerSeq}`, boardContent: this.#state.doc.snapshot() },
    });
  }

  #leaveBoard(message: SyncMessage, send: SendMessage): void {
    if (this.#state.joinedBoard !== null) {
      this.#options.broadcast?.(this.#state.joinedBoard, {
        id: message.id, type: "presence", clientId: message.clientId, boardId: this.#state.joinedBoard, serverSeq: this.#state.lastServerSeq,
        payload: { state: "leave" },
      }, message.clientId);
    }
    this.#state.joinedBoard = null;
    this.#state.doc = null;
    send({
      id: message.id, type: "reject", clientId: message.clientId, boardId: this.#state.joinedBoard ?? undefined,
      sentAt: sentAt(),
      payload: { code: "VALIDATION", detail: "left the board" },
    });
  }

  #reject(send: SendMessage, message: SyncMessage | null, code: string, detail: string, version?: unknown): void {
    void version;
    send({
      id: message?.id ?? "",
      type: "reject",
      clientId: message?.clientId ?? "",
      boardId: message?.boardId,
      sentAt: sentAt(),
      payload: { code, detail },
    });
  }
}

export function createSyncSession(options: CreateSyncSessionOptions): SyncSession {
  return new SyncSession(options);
}
