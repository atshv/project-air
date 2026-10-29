// The Yjs (MIT) adapter: Yjs types are used only here, never in the public API
// (ADR-0011). Each contract entity is one Y.Map of its contract fields; the
// document is the only CRDT state and updates travel through encodeUpdate().
// Block content (0.5.0) lives beside the entities: one Y.Map per content entry
// in the "content" map, keyed `<blockId>|<entryKey>`, so concurrent edits of
// different points, lanes, rows or cells merge (see block-content.ts).

import * as Y from "yjs";

import type { BoardContent } from "../../contracts/generated/types.d.ts";
import type { BoardDoc, BoardDocOptions, BoardEntityKind, BoardOp, EntityStore } from "./index.ts";
import { encodeStore, storeSnapshot } from "./index.ts";
import {
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

const KINDS: readonly BoardEntityKind[] = ["card", "zone", "block", "note", "edge"];
const keyOf = (kind: BoardEntityKind, id: string): string => `${kind}:${id}`;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return (globalThis as unknown as { btoa(value: string): string }).btoa(binary);
};
const fromBase64 = (value: string): Uint8Array => {
  const binary = (globalThis as unknown as { atob(value: string): string }).atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

type AnyPayload = Record<string, unknown>;

export class YjsBoardDoc implements BoardDoc {
  readonly #doc: Y.Doc;
  readonly #objects: Y.Map<Y.Map<unknown>>;
  readonly #content: Y.Map<Y.Map<unknown>>;
  readonly #contractVersion: BoardContent["contractVersion"];
  readonly #contentBoard: Record<string, unknown>;

  constructor(options: BoardDocOptions) {
    this.#contractVersion = options.contractVersion ?? options.content.contractVersion;
    this.#contentBoard = JSON.parse(JSON.stringify(options.content.board)) as Record<string, unknown>;
    this.#doc = new Y.Doc();
    this.#objects = this.#doc.getMap<Y.Map<unknown>>("objects");
    this.#content = this.#doc.getMap<Y.Map<unknown>>("content");
    this.#doc.transact(() => {
      for (const [kind, entities] of [
        ["zone", options.content.zones], ["block", options.content.blocks], ["card", options.content.cards],
        ["note", options.content.notes], ["edge", options.content.edges],
      ] as [BoardEntityKind, unknown[]][]) {
        for (const entity of entities) this.#write(kind, entity as AnyPayload);
      }
    });
  }

  #write(kind: BoardEntityKind, entity: AnyPayload): void {
    const map = new Y.Map<unknown>();
    const { content, ...fields } = entity;
    for (const [name, value] of Object.entries(kind === "block" ? fields : entity)) map.set(name, value);
    this.#objects.set(keyOf(kind, String(entity["id"])), map);
    if (kind === "block" && content !== undefined) {
      const validated = validateBlockContent(content);
      assertContentKind(entity["type"], validated, String(entity["id"]));
      for (const [key, entry] of decomposeContent(validated)) this.#setEntry(String(entity["id"]), key, entry);
    }
  }

  #entries(blockId: string): ContentEntries {
    const entries: ContentEntries = new Map();
    const prefix = `${blockId}|`;
    for (const [key, map] of this.#content.entries()) {
      if (!key.startsWith(prefix)) continue;
      const entry: ContentEntry = {};
      for (const [name, value] of map.entries()) entry[name] = value;
      entries.set(key.slice(prefix.length), entry);
    }
    return entries;
  }

  #setEntry(blockId: string, key: string, changes: ContentEntry): void {
    const id = `${blockId}|${key}`;
    let map = this.#content.get(id);
    if (map === undefined) {
      map = new Y.Map<unknown>();
      this.#content.set(id, map);
    }
    for (const [name, value] of Object.entries(changes)) map.set(name, value);
  }

  #deleteContent(blockId: string): void {
    const prefix = `${blockId}|`;
    for (const key of [...this.#content.keys()]) if (key.startsWith(prefix)) this.#content.delete(key);
  }

  /** Every entity as a plain object and the block content entries (storeSnapshot composes them). */
  #store(): EntityStore {
    const store: EntityStore = { board: { ...this.#contentBoard }, entities: new Map(), content: new Map() };
    for (const [key, map] of this.#objects.entries()) {
      const entity: AnyPayload = {};
      for (const [name, value] of map.entries()) entity[name] = value;
      store.entities.set(key, entity);
      if (key.startsWith("block:")) store.content.set(String(entity["id"]), this.#entries(String(entity["id"])));
    }
    return store;
  }

  #find(id: string): { key: string; kind: BoardEntityKind; map: Y.Map<unknown> } | null {
    for (const kind of KINDS) {
      const key = keyOf(kind, id);
      const map = this.#objects.get(key);
      if (map !== undefined) return { key, kind, map };
    }
    return null;
  }

  #change(id: string, changes: AnyPayload): void {
    const found = this.#find(id);
    if (found === null) return;
    for (const [name, value] of Object.entries(changes)) if (value !== undefined) found.map.set(name, value);
  }

  #delete(kind: BoardEntityKind, id: string): void {
    this.#objects.delete(keyOf(kind, id));
    if (kind === "block") this.#deleteContent(id);
  }

  #applyOperation(operation: BoardOp): void {
    const payload = operation.payload as unknown as AnyPayload;
    switch (operation.type) {
      case "createCard": this.#write("card", payload["card"] as AnyPayload); return;
      case "createZone": this.#write("zone", payload["zone"] as AnyPayload); return;
      case "createBlock": this.#write("block", payload["block"] as AnyPayload); return;
      case "createNote": this.#write("note", payload["note"] as AnyPayload); return;
      case "createEdge": this.#write("edge", payload["edge"] as AnyPayload); return;
      case "deleteCard": this.#delete("card", String((payload["card"] as AnyPayload)["id"])); return;
      case "deleteBlock": this.#delete("block", String((payload["block"] as AnyPayload)["id"])); return;
      case "deleteEdge": this.#delete("edge", String((payload["edge"] as AnyPayload)["id"])); return;
      case "deleteNote":
        this.#delete("note", String((payload["note"] as AnyPayload)["id"]));
        for (const card of (payload["cards"] as AnyPayload[]) ?? []) this.#delete("card", String(card["id"]));
        return;
      case "deleteZone": {
        const zone = payload["zone"] as AnyPayload;
        this.#delete("zone", String(zone["id"]));
        if (payload["policy"] === "delete") {
          for (const card of (payload["cards"] as AnyPayload[]) ?? []) this.#delete("card", String(card["id"]));
          for (const block of (payload["blocks"] as AnyPayload[]) ?? []) this.#delete("block", String(block["id"]));
        }
        return;
      }
      case "moveCard": this.#change(String(payload["cardId"]), { x: payload["x"], y: payload["y"], zoneId: payload["zoneId"] }); return;
      case "moveBlock": this.#change(String(payload["blockId"]), { x: payload["x"], y: payload["y"], zoneId: payload["zoneId"] }); return;
      case "moveZone": this.#change(String(payload["zoneId"]), { x: payload["x"], y: payload["y"] }); return;
      case "resizeCard": this.#change(String(payload["cardId"]), { width: payload["width"], height: payload["height"] }); return;
      case "resizeZone": this.#change(String(payload["zoneId"]), { width: payload["width"], height: payload["height"] }); return;
      case "resizeBlock": this.#change(String(payload["blockId"]), { width: payload["width"], height: payload["height"] }); return;
      case "updateBlock": this.#change(String(payload["blockId"]), (payload["changes"] as AnyPayload) ?? {}); return;
      case "updateNote": this.#change(String(payload["noteId"]), (payload["changes"] as AnyPayload) ?? {}); return;
      case "updateNoteBody": {
        // Contract 0.4.0 (AD-4): the note exists once; a missing note rejects the
        // operation. The body (a nested plain JSON value) and its derived plain
        // text are atomic map values, so snapshots/updates carry them unchanged.
        const update = readUpdateNoteBody(payload);
        const found = this.#find(update.noteId);
        if (found === null || found.kind !== "note") {
          throw new Error(`updateNoteBody targets the missing note ${update.noteId}`);
        }
        if (update.body === null) {
          found.map.delete("body");
          found.map.delete("plainText");
        } else {
          found.map.set("body", JSON.parse(JSON.stringify(update.body)) as unknown);
          found.map.set("plainText", update.plainText);
        }
        return;
      }
      case "updateBlockContent": {
        // Contract 0.5.0: write only the delta between the embedded previous
        // content and the new one, entry by entry (block-content.ts).
        const update = readUpdateBlockContent(payload, (operation as { inverse?: unknown }).inverse);
        const found = this.#find(update.blockId);
        if (found === null || found.kind !== "block") throw new Error(`updateBlockContent targets the missing block ${update.blockId}`);
        assertContentKind(found.map.get("type"), update.content, update.blockId);
        const entries = this.#entries(update.blockId);
        const previous = update.hasPrevious ? update.previous : composeContent(entries);
        const delta = contentDelta(entries, previous, update.content);
        for (const key of delta.remove) this.#content.delete(`${update.blockId}|${key}`);
        for (const [key, changes] of delta.set) this.#setEntry(update.blockId, key, changes);
        return;
      }
      case "updateZone": {
        const update = readUpdateZone(payload);
        const found = this.#find(update.zoneId);
        if (found === null || found.kind !== "zone") throw new Error(`updateZone targets the missing zone ${update.zoneId}`);
        found.map.set("title", update.title);
        return;
      }
      case "reorder": this.#change(String(payload["itemId"]), { z: payload["z"] }); return;
      case "group":
        for (const child of (payload["children"] as BoardOp[]) ?? []) this.#applyOperation(child);
        return;
      default:
        throw new Error(`unsupported contract operation ${(operation as { type: string }).type}`);
    }
  }

  apply(operation: BoardOp): void {
    this.#doc.transact(() => this.#applyOperation(operation));
  }

  encodeUpdate(): string { return toBase64(Y.encodeStateAsUpdate(this.#doc)); }
  applyUpdate(update: string): void { Y.applyUpdate(this.#doc, fromBase64(update)); }
  stateVector(): string { return toBase64(Y.encodeStateVector(this.#doc)); }

  snapshot(): BoardContent { return storeSnapshot(this.#store(), this.#contractVersion); }

  encodeState(): string { return encodeStore(this.#store(), this.#contractVersion); }

  merge(other: BoardDoc): void { this.applyUpdate(other.encodeUpdate()); }
}

export function createYjsBoardDoc(options: BoardDocOptions): BoardDoc {
  return new YjsBoardDoc(options);
}
