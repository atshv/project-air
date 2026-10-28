// Narrow document port of the engine logic layer (P4-05).
//
// The logic layer reads and writes the board working copy only through this
// port (AD-2). Two implementations exist: a pure in-memory fake for Node tests
// and an adapter over the TypeScript bridge for the browser. The port speaks
// contract entities and stable contract UUIDs, never engine slot indices; the
// adapter owns the id-to-slot mapping that docs/engine.md describes. The logic
// layer and its tests therefore never import the WASM module.

import type { Block, Card, Zone } from "../../../contracts/generated/types.ts";
import type { Engine, EngineRectangle } from "../bridge/engine.ts";
import type { LayerName, ToneName } from "../bridge/engine.ts";
import { OperationError } from "./operations.ts";

/** The three board-object kinds the engine holds a working copy of. */
export type BoardObjectKind = "card" | "zone" | "block";

/** Contract entity per object kind. */
export interface BoardObjectByKind {
  readonly card: Card;
  readonly zone: Zone;
  readonly block: Block;
}

/** The contract entity of one object kind. */
export type BoardObjectFor<K extends BoardObjectKind> = BoardObjectByKind[K];

/**
 * The data port the logic layer calls: read one object, add one, change its
 * geometry, change its fractional z index, remove it. Membership changes (zone
 * reparenting, P4-23/24) and note content are outside this port.
 */
export interface DocumentPort {
  /**
   * A copy of the current working copy of one object, or `undefined` when it is
   * gone. Mutating the returned entity never writes the working copy; writes go
   * through `add`/`move`/`resize`/`remove`/`updateZ` only.
   */
  read<K extends BoardObjectKind>(kind: K, id: string): BoardObjectFor<K> | undefined;
  /** Adds one object; a duplicate id is rejected. */
  add<K extends BoardObjectKind>(kind: K, object: BoardObjectFor<K>): void;
  /** Moves one object to a world position; unknown ids are rejected. */
  move(kind: BoardObjectKind, id: string, x: number, y: number): void;
  /** Resizes one object; unknown ids are rejected. */
  resize(kind: BoardObjectKind, id: string, width: number, height: number): void;
  /** Removes one object; unknown ids are rejected. */
  remove(kind: BoardObjectKind, id: string): void;
  /** Sets the fractional z index of one object; unknown ids are rejected. */
  updateZ(kind: BoardObjectKind, id: string, z: string): void;
  /**
   * The kind of the object with this contract id, or `undefined`. A `reorder`
   * payload names only the item id (card, block or zone), so applying it needs
   * this lookup.
   */
  kindOf(id: string): BoardObjectKind | undefined;
  /**
   * The `z` values of every object of one kind, i.e. of one design layer (cards
   * = note cards, blocks, zones). Order is unspecified; callers compare the keys.
   */
  zIndices(kind: BoardObjectKind): readonly string[];
}

/** The browser adapter also maps an engine handle (from `hitTest`) back to its object. */
export interface EngineDocumentPort extends DocumentPort {
  /** The object drawn at an engine handle, or `undefined` for a miss or a stale handle. */
  objectAt(handle: number): { readonly kind: BoardObjectKind; readonly id: string } | undefined;
  /**
   * The live engine handle of one object id, or `undefined` for an unknown id.
   * Used by the selection chrome and the joint drag (P4-16).
   */
  slotOf(kind: BoardObjectKind, id: string): number | undefined;
}

/** In-memory port plus a canonical byte snapshot for the round-trip tests. */
export interface InMemoryDocument extends DocumentPort {
  /** Canonical JSON of the whole working copy, sorted by object id. */
  snapshot(): string;
}

const compareIds = (left: { readonly id: string }, right: { readonly id: string }): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

/**
 * Shallow copy of a contract entity. Every contract field is a primitive or
 * null, so a shallow copy fully isolates the port from operation payloads and
 * history entries.
 */
function cloneObject<K extends BoardObjectKind>(
  kind: K,
  object: BoardObjectFor<K>,
): BoardObjectFor<K> {
  if (kind === "card") {
    return { ...object };
  }
  if (kind === "zone") {
    return { ...object };
  }
  return { ...object };
}

/** A deterministic, pure in-memory working copy for tests. */
export function createInMemoryDocument(): InMemoryDocument {
  const cards = new Map<string, Card>();
  const zones = new Map<string, Zone>();
  const blocks = new Map<string, Block>();

  const bucket = <K extends BoardObjectKind>(kind: K): Map<string, BoardObjectFor<K>> => {
    const selected = kind === "card" ? cards : kind === "zone" ? zones : blocks;
    return selected as unknown as Map<string, BoardObjectFor<K>>;
  };

  const required = <K extends BoardObjectKind>(
    kind: K,
    id: string,
  ): BoardObjectFor<K> => {
    const object = bucket(kind).get(id);
    if (object === undefined) {
      throw new OperationError(`the document contains no ${kind} ${id}`);
    }
    return object;
  };

  return {
    read<K extends BoardObjectKind>(kind: K, id: string): BoardObjectFor<K> | undefined {
      const object = bucket(kind).get(id);
      return object === undefined ? undefined : cloneObject(kind, object);
    },
    add<K extends BoardObjectKind>(kind: K, object: BoardObjectFor<K>): void {
      const target = bucket(kind);
      if (target.has(object.id)) {
        throw new OperationError(`the document already contains ${kind} ${object.id}`);
      }
      target.set(object.id, cloneObject(kind, object));
    },
    move(kind: BoardObjectKind, id: string, x: number, y: number): void {
      const object = required(kind, id);
      object.x = x;
      object.y = y;
    },
    resize(kind: BoardObjectKind, id: string, width: number, height: number): void {
      const object = required(kind, id);
      object.width = width;
      object.height = height;
    },
    remove(kind: BoardObjectKind, id: string): void {
      const target = bucket(kind);
      if (!target.has(id)) {
        throw new OperationError(`the document contains no ${kind} ${id}`);
      }
      target.delete(id);
    },
    updateZ(kind: BoardObjectKind, id: string, z: string): void {
      required(kind, id).z = z;
    },
    kindOf(id: string): BoardObjectKind | undefined {
      return cards.has(id) ? "card" : zones.has(id) ? "zone" : blocks.has(id) ? "block" : undefined;
    },
    zIndices(kind: BoardObjectKind): readonly string[] {
      return [...bucket(kind).values()].map((object) => object.z);
    },
    snapshot(): string {
      return JSON.stringify({
        blocks: [...blocks.values()].sort(compareIds),
        cards: [...cards.values()].sort(compareIds),
        zones: [...zones.values()].sort(compareIds),
      });
    },
  };
}

/** The bridge methods the browser adapter needs; the rest of `Engine` is unused here. */
export type EngineDocumentBackend = Pick<
  Engine,
  "addRectangle" | "updateGeometry" | "updateZ" | "removeObject"
>;

/** Design-rules layer per object kind (docs/engine.md); not a contract field. */
const LAYERS: Readonly<Record<BoardObjectKind, LayerName>> = {
  card: "note-cards",
  zone: "zones",
  block: "blocks",
};

interface StoredObject<T> {
  readonly slot: number;
  readonly object: T;
}

/** Optional projection choices of the browser adapter. */
export interface EngineDocumentPortOptions {
  /**
   * Tone of an object when it is added. Tones are not contract data, so the
   * scene that loads the objects owns the choice (P4-02); without a selector
   * every object is projected with the neutral tone.
   */
  readonly toneOf?: (kind: BoardObjectKind, id: string) => ToneName;
}

/**
 * Browser adapter over the typed WASM bridge. Contract UUIDs are mapped to the
 * engine's live slot handles here; the C ABI never sees a UUID (P4-01, P4-02).
 */
export function createEngineDocumentPort(
  backend: EngineDocumentBackend,
  options: EngineDocumentPortOptions = {},
): EngineDocumentPort {
  const cards = new Map<string, StoredObject<Card>>();
  const zones = new Map<string, StoredObject<Zone>>();
  const blocks = new Map<string, StoredObject<Block>>();

  const bucket = <K extends BoardObjectKind>(kind: K): Map<string, StoredObject<BoardObjectFor<K>>> => {
    const selected = kind === "card" ? cards : kind === "zone" ? zones : blocks;
    return selected as unknown as Map<string, StoredObject<BoardObjectFor<K>>>;
  };

  const required = <K extends BoardObjectKind>(
    kind: K,
    id: string,
  ): StoredObject<BoardObjectFor<K>> => {
    const stored = bucket(kind).get(id);
    if (stored === undefined) {
      throw new OperationError(`the document contains no ${kind} ${id}`);
    }
    return stored;
  };

  return {
    read<K extends BoardObjectKind>(
      kind: K,
      id: string,
    ): BoardObjectFor<K> | undefined {
      const stored = bucket(kind).get(id);
      return stored === undefined ? undefined : cloneObject(kind, stored.object);
    },
    add<K extends BoardObjectKind>(kind: K, object: BoardObjectFor<K>): void {
      const target = bucket(kind);
      if (target.has(object.id)) {
        throw new OperationError(`the document already contains ${kind} ${object.id}`);
      }
      const rectangle: EngineRectangle = {
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        layer: LAYERS[kind],
        tone: options.toneOf === undefined ? "neutral" : options.toneOf(kind, object.id),
      };
      const slot = backend.addRectangle(rectangle);
      // The engine rectangle carries geometry, layer and tone; the fractional z
      // is a separate contract field, so it is projected in its own call.
      backend.updateZ(slot, object.z);
      target.set(object.id, { slot, object: cloneObject(kind, object) });
    },
    move(kind: BoardObjectKind, id: string, x: number, y: number): void {
      const stored = required(kind, id);
      backend.updateGeometry(stored.slot, {
        x,
        y,
        width: stored.object.width,
        height: stored.object.height,
      });
      stored.object.x = x;
      stored.object.y = y;
    },
    resize(kind: BoardObjectKind, id: string, width: number, height: number): void {
      const stored = required(kind, id);
      backend.updateGeometry(stored.slot, {
        x: stored.object.x,
        y: stored.object.y,
        width,
        height,
      });
      stored.object.width = width;
      stored.object.height = height;
    },
    remove(kind: BoardObjectKind, id: string): void {
      const stored = required(kind, id);
      backend.removeObject(stored.slot);
      bucket(kind).delete(id);
    },
    updateZ(kind: BoardObjectKind, id: string, z: string): void {
      const stored = required(kind, id);
      backend.updateZ(stored.slot, z);
      stored.object.z = z;
    },
    kindOf(id: string): BoardObjectKind | undefined {
      return cards.has(id) ? "card" : zones.has(id) ? "zone" : blocks.has(id) ? "block" : undefined;
    },
    zIndices(kind: BoardObjectKind): readonly string[] {
      return [...bucket(kind).values()].map((stored) => stored.object.z);
    },
    slotOf(kind: BoardObjectKind, id: string): number | undefined {
      return bucket(kind).get(id)?.slot;
    },
    objectAt(handle: number): { readonly kind: BoardObjectKind; readonly id: string } | undefined {
      if (!Number.isInteger(handle) || handle < 0) {
        return undefined;
      }
      for (const kind of ["card", "block", "zone"] as const) {
        for (const [id, stored] of bucket(kind)) {
          if (stored.slot === handle) {
            return { kind, id };
          }
        }
      }
      return undefined;
    },
  };
}
