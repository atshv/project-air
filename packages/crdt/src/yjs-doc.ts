// The Yjs (MIT) adapter: Yjs types are used only here, never in the public API
// (ADR-0011). Each contract entity is one Y.Map of its contract fields; the
// document is the only CRDT state and updates travel through encodeUpdate().

import * as Y from "yjs";

import type { BoardContent } from "../../contracts/generated/types.d.ts";
import type { BoardDoc, BoardDocOptions, BoardEntityKind, BoardOp, EntityStore } from "./index.ts";
import { encodeStore, storeSnapshot } from "./index.ts";
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
  readonly #contractVersion: BoardContent["contractVersion"];
  readonly #contentBoard: Record<string, unknown>;

  constructor(options: BoardDocOptions) {
    this.#contractVersion = options.contractVersion ?? options.content.contractVersion;
    this.#contentBoard = JSON.parse(JSON.stringify(options.content.board)) as Record<string, unknown>;
    this.#doc = new Y.Doc();
    this.#objects = this.#doc.getMap<Y.Map<unknown>>("objects");
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
    for (const [name, value] of Object.entries(entity)) map.set(name, value);
    this.#objects.set(keyOf(kind, String(entity["id"])), map);
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

  #delete(kind: BoardEntityKind, id: string): void { this.#objects.delete(keyOf(kind, id)); }

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

  snapshot(): BoardContent {
    const store: EntityStore = { board: { ...this.#contentBoard }, entities: new Map() };
    for (const [key, map] of this.#objects.entries()) {
      const entity: AnyPayload = {};
      for (const [name, value] of map.entries()) entity[name] = value as unknown;
      store.entities.set(key, entity);
    }
    return storeSnapshot(store, this.#contractVersion);
  }

  encodeState(): string {
    return encodeStore(
      (() => {
        const store: EntityStore = { board: { ...this.#contentBoard }, entities: new Map() };
        for (const [key, map] of this.#objects.entries()) {
          const entity: AnyPayload = {};
          for (const [name, value] of map.entries()) entity[name] = value as unknown;
          store.entities.set(key, entity);
        }
        return store;
      })(),
      this.#contractVersion,
    );
  }

  merge(other: BoardDoc): void { this.applyUpdate(other.encodeUpdate()); }
}

export function createYjsBoardDoc(options: BoardDocOptions): BoardDoc {
  return new YjsBoardDoc(options);
}
