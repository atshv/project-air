// P5-02: the board document core behind the own BoardDoc interface.
// The contract is the wire format; every change is one contract operation with
// its inverse (AD-1). Yjs (MIT) is an implementation detail of this package.

import type {
  Block,
  BoardContent,
  Card,
  Edge,
  Note,
  Operation,
  OperationInverse,
  Zone,
} from "../../contracts/generated/types.d.ts";
import {
  applyContentDelta,
  assertContentKind,
  composeContent,
  contentDelta,
  decomposeContent,
  readUpdateBlockContent,
  readUpdateZone,
  validateBlockContent,
  type ContentEntries,
  type ContentEntry,
} from "./block-content.ts";
import { readUpdateNoteBody } from "./note-body.ts";

export type BoardEntityKind = "card" | "zone" | "block" | "note" | "edge";
export type BoardOp = Operation | OperationInverse;

/** The own interface every CRDT adapter of this package implements. */
export interface BoardDoc {
  apply(operation: BoardOp): void;
  encodeUpdate(): string;
  applyUpdate(update: string): void;
  snapshot(): BoardContent;
  stateVector(): string;
  encodeState(): string;
  merge(other: BoardDoc): void;
}

export interface BoardDocOptions {
  content: BoardContent;
  contractVersion?: BoardContent["contractVersion"];
}

const KINDS: readonly BoardEntityKind[] = ["card", "zone", "block", "note", "edge"];
const KIND_KEY: Record<BoardEntityKind, keyof BoardContent> = {
  card: "cards", zone: "zones", block: "blocks", note: "notes", edge: "edges",
};

export interface EntityStore {
  board: Record<string, unknown>;
  entities: Map<string, Record<string, unknown>>;
  /** Block content entries (0.5.0) by block id; composed into `content` by storeSnapshot. */
  content: Map<string, ContentEntries>;
}

const keyOf = (kind: BoardEntityKind, id: string): string => `${kind}:${id}`;
const kindOfKey = (key: string): BoardEntityKind => key.slice(0, key.indexOf(":")) as BoardEntityKind;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function entityId(entity: Record<string, unknown>): string {
  const id = entity["id"];
  if (typeof id !== "string" || id.length === 0) throw new Error("a contract entity must carry a string id");
  return id;
}

function find(store: EntityStore, id: string): BoardEntityKind | null {
  for (const kind of KINDS) if (store.entities.has(keyOf(kind, id))) return kind;
  return null;
}

function change(store: EntityStore, id: string, changes: Record<string, unknown>): void {
  const kind = find(store, id);
  if (kind === null) return;
  const entity = store.entities.get(keyOf(kind, id))!;
  for (const [name, value] of Object.entries(changes)) if (value !== undefined) entity[name] = value;
}

/** Stores a block: its content becomes entries beside the entity (validated). */
function putBlock(store: EntityStore, block: Record<string, unknown>): void {
  const { content, ...fields } = block;
  const id = entityId(fields);
  store.entities.set(keyOf("block", id), fields);
  store.content.delete(id);
  if (content === undefined) return;
  const validated = validateBlockContent(content);
  assertContentKind(fields["type"], validated, id);
  store.content.set(id, decomposeContent(validated));
}

/** Applies one entity-level operation change to a plain entity store. */
export function applyToStore(store: EntityStore, operation: BoardOp): void {
  type AnyPayload = Record<string, unknown>;
  const payload = operation.payload as unknown as AnyPayload;
  switch (operation.type) {
    case "createCard": store.entities.set(keyOf("card", entityId(payload["card"] as AnyPayload)), clone(payload["card"] as AnyPayload)); return;
    case "createZone": store.entities.set(keyOf("zone", entityId(payload["zone"] as AnyPayload)), clone(payload["zone"] as AnyPayload)); return;
    case "createBlock": putBlock(store, clone(payload["block"] as AnyPayload)); return;
    case "createNote": store.entities.set(keyOf("note", entityId(payload["note"] as AnyPayload)), clone(payload["note"] as AnyPayload)); return;
    case "createEdge": store.entities.set(keyOf("edge", entityId(payload["edge"] as AnyPayload)), clone(payload["edge"] as AnyPayload)); return;
    case "deleteCard": store.entities.delete(keyOf("card", entityId(payload["card"] as AnyPayload))); return;
    case "deleteBlock": {
      const id = entityId(payload["block"] as AnyPayload);
      store.entities.delete(keyOf("block", id));
      store.content.delete(id);
      return;
    }
    case "deleteEdge": store.entities.delete(keyOf("edge", entityId(payload["edge"] as AnyPayload))); return;
    case "deleteNote":
      store.entities.delete(keyOf("note", entityId(payload["note"] as AnyPayload)));
      for (const card of (payload["cards"] as AnyPayload[]) ?? []) store.entities.delete(keyOf("card", entityId(card)));
      return;
    case "deleteZone": {
      const zone = payload["zone"] as AnyPayload;
      store.entities.delete(keyOf("zone", entityId(zone)));
      if (payload["policy"] === "delete") {
        for (const card of (payload["cards"] as AnyPayload[]) ?? []) store.entities.delete(keyOf("card", entityId(card)));
        for (const block of (payload["blocks"] as AnyPayload[]) ?? []) {
          store.entities.delete(keyOf("block", entityId(block)));
          store.content.delete(entityId(block));
        }
      }
      return;
    }
    case "moveCard": change(store, String(payload["cardId"]), { x: payload["x"], y: payload["y"], zoneId: payload["zoneId"] }); return;
    case "moveBlock": change(store, String(payload["blockId"]), { x: payload["x"], y: payload["y"], zoneId: payload["zoneId"] }); return;
    case "moveZone": change(store, String(payload["zoneId"]), { x: payload["x"], y: payload["y"] }); return;
    case "resizeCard": change(store, String(payload["cardId"]), { width: payload["width"], height: payload["height"] }); return;
    case "resizeZone": change(store, String(payload["zoneId"]), { width: payload["width"], height: payload["height"] }); return;
    case "resizeBlock": change(store, String(payload["blockId"]), { width: payload["width"], height: payload["height"] }); return;
    case "updateBlock": change(store, String(payload["blockId"]), (payload["changes"] as AnyPayload) ?? {}); return;
    case "updateNote": change(store, String(payload["noteId"]), (payload["changes"] as AnyPayload) ?? {}); return;
    case "updateNoteBody": {
      // Contract 0.4.0 (AD-4): the note must already exist once in the board
      // content; a missing note is a rejected operation, never a silent create.
      // The operation payload carries no timestamp, so `updatedAt` is preserved
      // (the platform owns server timestamps): that is what makes apply+inverse
      // restore the previous note byte-identically.
      const update = readUpdateNoteBody(payload);
      const note = store.entities.get(keyOf("note", update.noteId));
      if (note === undefined) throw new Error(`updateNoteBody targets the missing note ${update.noteId}`);
      if (update.body === null) {
        delete note["body"];
        delete note["plainText"];
      } else {
        note["body"] = clone(update.body);
        note["plainText"] = update.plainText;
      }
      return;
    }
    case "updateBlockContent": {
      // Contract 0.5.0: the block must exist and match the content kind; only the
      // delta between the embedded previous content and the new one is written.
      const update = readUpdateBlockContent(payload, (operation as { inverse?: unknown }).inverse);
      const block = store.entities.get(keyOf("block", update.blockId));
      if (block === undefined) throw new Error(`updateBlockContent targets the missing block ${update.blockId}`);
      assertContentKind(block["type"], update.content, update.blockId);
      const entries: ContentEntries = store.content.get(update.blockId) ?? new Map<string, ContentEntry>();
      applyContentDelta(entries, contentDelta(entries, update.hasPrevious ? update.previous : composeContent(entries), update.content));
      store.content.set(update.blockId, entries);
      return;
    }
    case "updateZone": {
      const update = readUpdateZone(payload);
      const zone = store.entities.get(keyOf("zone", update.zoneId));
      if (zone === undefined) throw new Error(`updateZone targets the missing zone ${update.zoneId}`);
      zone["title"] = update.title;
      return;
    }
    case "reorder": change(store, String(payload["itemId"]), { z: payload["z"] }); return;
    case "group":
      for (const child of (payload["children"] as BoardOp[]) ?? []) applyToStore(store, child);
      return;
    default:
      throw new Error(`unsupported contract operation ${(operation as { type: string }).type}`);
  }
}

export function storeSnapshot(store: EntityStore, contractVersion: BoardContent["contractVersion"]): BoardContent {
  const groups: Record<string, Record<string, unknown>[]> = { cards: [], zones: [], blocks: [], notes: [], edges: [] };
  for (const [key, entity] of [...store.entities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const copy = clone(entity);
    if (kindOfKey(key) === "block") {
      const entries = store.content.get(String(copy["id"]));
      const content = entries === undefined ? undefined : composeContent(entries);
      if (content !== undefined) copy["content"] = content;
    }
    groups[KIND_KEY[kindOfKey(key)]]!.push(copy);
  }
  return {
    contractVersion,
    board: clone(store.board) as unknown as BoardContent["board"],
    cards: groups.cards as unknown as Card[],
    zones: groups.zones as unknown as Zone[],
    blocks: groups.blocks as unknown as Block[],
    notes: groups.notes as unknown as Note[],
    edges: groups.edges as unknown as Edge[],
  };
}

export function loadStore(content: BoardContent): EntityStore {
  const store: EntityStore = { board: clone(content.board) as unknown as Record<string, unknown>, entities: new Map(), content: new Map() };
  for (const zone of content.zones) store.entities.set(keyOf("zone", zone.id), clone(zone as unknown as Record<string, unknown>));
  for (const block of content.blocks) putBlock(store, clone(block as unknown as Record<string, unknown>));
  for (const card of content.cards) store.entities.set(keyOf("card", card.id), clone(card as unknown as Record<string, unknown>));
  for (const note of content.notes) store.entities.set(keyOf("note", note.id), clone(note as unknown as Record<string, unknown>));
  for (const edge of content.edges) store.entities.set(keyOf("edge", edge.id), clone(edge as unknown as Record<string, unknown>));
  return store;
}

export function encodeStore(store: EntityStore, contractVersion: BoardContent["contractVersion"]): string {
  return JSON.stringify(storeSnapshot(store, contractVersion));
}

const toBase64 = (value: string): string =>
  (globalThis as unknown as { btoa(value: string): string }).btoa(value);

/** The fake adapter: an operation log merged by id and replayed in sorted order. */
export class FakeBoardDoc implements BoardDoc {
  #operations = new Map<string, BoardOp>();
  readonly #content: BoardContent;
  readonly #contractVersion: BoardContent["contractVersion"];

  constructor(options: BoardDocOptions) {
    this.#contractVersion = options.contractVersion ?? options.content.contractVersion;
    this.#content = clone(options.content);
  }

  apply(operation: BoardOp): void {
    const id = (operation as { id?: string }).id;
    if (typeof id === "string") this.#operations.set(id, clone(operation));
  }

  encodeUpdate(): string {
    return JSON.stringify([...this.#operations.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  applyUpdate(update: string): void {
    for (const [id, operation] of JSON.parse(update) as [string, BoardOp][]) {
      if (!this.#operations.has(id)) this.#operations.set(id, operation);
    }
  }

  /** Deterministic replay: the merged log sorted by id is the document state. */
  #store(): EntityStore {
    const store = loadStore(this.#content);
    for (const operation of [...this.#operations.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      applyToStore(store, operation[1]);
    }
    return store;
  }

  snapshot(): BoardContent { return storeSnapshot(this.#store(), this.#contractVersion); }
  stateVector(): string { return toBase64([...this.#operations.keys()].sort().join("|")); }
  encodeState(): string { return encodeStore(this.#store(), this.#contractVersion); }
  merge(other: BoardDoc): void { this.applyUpdate(other.encodeUpdate()); }
}

export function createFakeBoardDoc(options: BoardDocOptions): BoardDoc {
  return new FakeBoardDoc(options);
}

export { YjsBoardDoc, createYjsBoardDoc } from "./yjs-doc.ts";
