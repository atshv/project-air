// P5-05: the presence hub. Presence is ephemeral: validated, identity-derived
// server-side (the client name/colour are ignored), throttled/coalesced per
// connection, isolated per board, never persisted. The contract has no separate
// participant-list or leave message, so the list is delivered as individual
// `presence` messages and a removal is signalled by a presence message with an
// empty selection and the cursor at the origin (documented open point).

import { createHash } from "node:crypto";

export const PRESENCE_THROTTLE_MS = 50;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PresenceMessage {
  readonly id: string;
  readonly type: "presence";
  readonly clientId: string;
  readonly boardId: string;
  readonly sentAt: string;
  readonly seq: number;
  readonly payload: {
    readonly colorRef: string;
    readonly cursor: { readonly x: number; readonly y: number };
    readonly nameRef: string;
    readonly selection: readonly string[];
  };
}

export interface PresenceHubOptions {
  readonly broadcast: (boardId: string, message: PresenceMessage, exceptClientId: string) => void;
  readonly now?: () => number;
  readonly throttleMs?: number;
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
}

interface Participant {
  readonly clientId: string;
  readonly userId: string;
  readonly nameRef: string;
  readonly colorRef: string;
  cursor: { x: number; y: number };
  selection: string[];
  lastSentAt: number;
  timer: unknown;
  pending: PresenceMessage | null;
}

export interface PresenceState {
  readonly clientId: string;
  readonly nameRef: string;
  readonly colorRef: string;
  readonly cursor: { x: number; y: number };
  readonly selection: string[];
}

/** Server-derived identity: nameRef from the session user, colour from its hash. */
export function deriveIdentity(userId: string, clientId: string): { nameRef: string; colorRef: string } {
  const nameRef = `user:${userId}`;
  const digest = createHash("sha256").update(`${userId}:${clientId}`).digest();
  return { nameRef, colorRef: `tone-${"abcde"[digest[0]! % 5]}` };
}

export class PresenceHub {
  readonly #options: PresenceHubOptions;
  readonly #boards = new Map<string, Map<string, Participant>>();

  constructor(options: PresenceHubOptions) {
    this.#options = options;
  }

  #now(): number { return this.#options.now?.() ?? Date.now(); }
  #participants(boardId: string): Map<string, Participant> {
    let board = this.#boards.get(boardId);
    if (board === undefined) { board = new Map(); this.#boards.set(boardId, board); }
    return board;
  }

  participantCount(boardId: string): number { return this.#boards.get(boardId)?.size ?? 0; }

  /** Validates and publishes one client presence update (identity overwritten). */
  publish(input: { boardId: string; clientId: string; userId: string; messageId: string; seq: number; sentAt: string; payload: unknown }): boolean {
    if (!UUID_V7.test(input.clientId) || !UUID_V7.test(input.userId)) return false;
    if (input.seq < 1 || !Number.isInteger(input.seq)) return false;
    const payload = input.payload as Record<string, unknown> | null;
    if (payload === null || typeof payload !== "object") return false;
    const cursor = payload["cursor"] as Record<string, unknown> | null;
    const selection = payload["selection"];
    if (cursor === null || typeof cursor !== "object") return false;
    if (typeof cursor["x"] !== "number" || !Number.isFinite(cursor["x"]) || typeof cursor["y"] !== "number" || !Number.isFinite(cursor["y"])) return false;
    if (!Array.isArray(selection) || selection.length > 500) return false;
    for (const id of selection) if (typeof id !== "string" || !UUID_V7.test(id)) return false;
    if (new Set(selection).size !== selection.length) return false;
    const identity = deriveIdentity(input.userId, input.clientId);
    const board = this.#participants(input.boardId);
    let participant = board.get(input.clientId);
    if (participant === undefined) {
      participant = { clientId: input.clientId, userId: input.userId, ...identity, cursor: { x: 0, y: 0 }, selection: [], lastSentAt: 0, timer: null, pending: null };
      board.set(input.clientId, participant);
    }
    const message: PresenceMessage = {
      id: input.messageId, type: "presence", clientId: input.clientId, boardId: input.boardId,
      sentAt: input.sentAt, seq: input.seq, payload: {
        nameRef: identity.nameRef, colorRef: identity.colorRef,
        cursor: { x: cursor["x"], y: cursor["y"] },
        selection: selection as string[],
      },
    };
    this.#deliver(participant, message);
    return true;
  }

  #deliver(participant: Participant, message: PresenceMessage): void {
    const now = this.#now();
    const throttle = this.#options.throttleMs ?? PRESENCE_THROTTLE_MS;
    const flush = (): void => {
      participant.timer = null;
      const next = participant.pending;
      participant.pending = null;
      if (next === null) return;
      participant.lastSentAt = this.#now();
      this.#options.broadcast(next.boardId, next, next.clientId);
    };
    if (now - participant.lastSentAt >= throttle) {
      participant.lastSentAt = now;
      this.#options.broadcast(message.boardId, message, message.clientId);
      return;
    }
    // Coalesce: only the newest update within the throttle window is sent later.
    participant.pending = message;
    if (participant.timer === null) participant.timer = (this.#options.setTimeout ?? ((cb, ms) => setTimeout(cb, ms)))(flush, throttle);
  }

  /** Sends the current participant list to a newcomer, then announces the newcomer. */
  join(input: { boardId: string; clientId: string; userId: string; send: (message: Record<string, unknown>) => void }): void {
    const board = this.#participants(input.boardId);
    const snapshot: PresenceState[] = [];
    for (const participant of board.values()) snapshot.push(this.#state(participant));
    for (const participant of snapshot) {
      input.send({
        id: cryptoRandomUuid(), type: "presence", clientId: participant.clientId, boardId: input.boardId,
        sentAt: new Date().toISOString(), seq: 1,
        payload: { nameRef: participant.nameRef, colorRef: participant.colorRef, cursor: participant.cursor, selection: [...participant.selection] },
      });
    }
    const identity = deriveIdentity(input.userId, input.clientId);
    const participant = board.get(input.clientId) ?? {
      clientId: input.clientId, userId: input.userId, ...identity, cursor: { x: 0, y: 0 }, selection: [], lastSentAt: 0, timer: null, pending: null,
    };
    board.set(input.clientId, participant);
    this.#options.broadcast(input.boardId, {
      id: cryptoRandomUuid(), type: "presence", clientId: input.clientId, boardId: input.boardId,
      sentAt: new Date().toISOString(), seq: 1,
      payload: { nameRef: participant.nameRef, colorRef: participant.colorRef, cursor: participant.cursor, selection: [] },
    }, input.clientId);
  }

  #state(participant: Participant): PresenceState {
    return { clientId: participant.clientId, nameRef: participant.nameRef, colorRef: participant.colorRef, cursor: participant.cursor, selection: participant.selection };
  }

  /** Removes one participant and notifies the others with the removal sentinel. */
  remove(boardId: string, clientId: string): void {
    const board = this.#boards.get(boardId);
    const participant = board?.get(clientId);
    if (participant === undefined) return;
    if (participant.timer !== null) clearTimeout(participant.timer as never);
    board!.delete(clientId);
    this.#options.broadcast(boardId, {
      id: cryptoRandomUuid(), type: "presence", clientId, boardId,
      sentAt: new Date().toISOString(), seq: 1,
      payload: { nameRef: participant.nameRef, colorRef: participant.colorRef, cursor: { x: 0, y: 0 }, selection: [] },
    }, clientId);
  }

  /** Shutdown: remove every participant of every board (no persistence). */
  clear(): void {
    for (const [boardId, board] of this.#boards) {
      for (const participant of board.values()) {
        if (participant.timer !== null) clearTimeout(participant.timer as never);
        this.#options.broadcast(boardId, {
          id: cryptoRandomUuid(), type: "presence", clientId: participant.clientId, boardId,
          sentAt: new Date().toISOString(), seq: 1,
          payload: { nameRef: participant.nameRef, colorRef: participant.colorRef, cursor: { x: 0, y: 0 }, selection: [] },
        }, participant.clientId);
      }
    }
    this.#boards.clear();
  }
}

let uuidCounter = 0;
function cryptoRandomUuid(): string {
  uuidCounter += 1;
  const random = createHash("sha256").update(`${Date.now()}:${uuidCounter}:${Math.random()}`).digest("hex");
  const timestamp = Date.now().toString(16).padStart(12, "0").slice(-12);
  const variant = ((Number.parseInt(random.slice(0, 2), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(3, 5)}-${random.slice(5, 17)}`;
}
