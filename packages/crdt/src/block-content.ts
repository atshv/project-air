// P6-13: contract 0.5.0 block-content semantics for the document core.
//
// A block's content (checklist points, columns lanes and their entries, table
// columns, rows and cells) is decomposed into one record per entry, keyed by the
// entry's UUIDv7 id. Lists keep their order through a fractional position per
// entry (ties broken by key), so the order is a property of each entry and two
// clients inserting into the same list both keep their entry.
//
// `updateBlockContent` carries the whole new content and its inverse the whole
// previous content. Applying it writes only the delta between the two: entries
// that were removed, added, changed or moved. A concurrent edit of another entry
// is therefore never overwritten. An operation without an embedded inverse (a
// group inverse child) uses the current content as the previous one.
//
// An empty content (no entries besides the kind) canonicalises to "no content
// field", like an empty note body, so apply + inverse restores a block that never
// had content byte-identically.

import type { BlockContentPayload } from "../../contracts/generated/types.d.ts";

type RecordValue = Record<string, unknown>;

/** One decomposed entry: its list and position (ordered entries) and its fields. */
export interface ContentEntry {
  list?: string;
  pos?: string;
  [field: string]: unknown;
}

export type ContentEntries = Map<string, ContentEntry>;

const KINDS = ["checklist", "columns", "table"] as const;
type ContentKind = (typeof KINDS)[number];
const KIND_KEY = "k";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIMITS = { items: 200, columns: 8, laneItems: 50, rows: 100, cells: 8, text: 500, title: 120, cell: 200 };

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function reject(reason: string): never {
  throw new Error(`invalid block content: ${reason}`);
}

function fields(value: RecordValue, allowed: readonly string[], where: string): void {
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) reject(`${where} has unknown field ${JSON.stringify(field)}`);
  }
}

function id(value: unknown, where: string): string {
  if (typeof value !== "string" || !UUID_V7.test(value)) reject(`${where} needs a UUIDv7 id`);
  return value;
}

function text(value: unknown, max: number, where: string): string {
  if (typeof value !== "string") reject(`${where} needs a string`);
  if (value.length > max) reject(`${where} exceeds ${max} characters`);
  return value;
}

function list(value: unknown, max: number, where: string): unknown[] {
  if (!Array.isArray(value)) reject(`${where} must be an array`);
  if (value.length > max) reject(`${where} exceeds ${max} entries`);
  return value;
}

/** Validates one 0.5.0 block content against the schema rules; throws on a violation. */
export function validateBlockContent(value: unknown): BlockContentPayload {
  if (!isRecord(value)) reject("the content must be an object");
  const kind = value["kind"];
  if (!KINDS.includes(kind as ContentKind)) reject(`unknown kind ${JSON.stringify(kind)}`);
  if (kind === "checklist") {
    fields(value, ["kind", "items"], "checklist content");
    for (const [index, item] of list(value["items"], LIMITS.items, "items").entries()) {
      if (!isRecord(item)) reject(`item ${index} must be an object`);
      fields(item, ["id", "text", "done"], `item ${index}`);
      id(item["id"], `item ${index}`);
      text(item["text"], LIMITS.text, `item ${index} text`);
      if (typeof item["done"] !== "boolean") reject(`item ${index} needs a boolean done`);
    }
  } else if (kind === "columns") {
    fields(value, ["kind", "columns"], "columns content");
    for (const [index, lane] of list(value["columns"], LIMITS.columns, "columns").entries()) {
      if (!isRecord(lane)) reject(`column ${index} must be an object`);
      fields(lane, ["id", "title", "items"], `column ${index}`);
      id(lane["id"], `column ${index}`);
      text(lane["title"], LIMITS.title, `column ${index} title`);
      for (const [entry, item] of list(lane["items"] ?? [], LIMITS.laneItems, `column ${index} items`).entries()) {
        if (!isRecord(item)) reject(`column ${index} item ${entry} must be an object`);
        fields(item, ["id", "text"], `column ${index} item ${entry}`);
        id(item["id"], `column ${index} item ${entry}`);
        text(item["text"], LIMITS.text, `column ${index} item ${entry} text`);
      }
    }
  } else {
    fields(value, ["kind", "columns", "rows"], "table content");
    for (const [index, column] of list(value["columns"], LIMITS.columns, "columns").entries()) {
      if (!isRecord(column)) reject(`column ${index} must be an object`);
      fields(column, ["id", "title"], `table column ${index}`);
      id(column["id"], `column ${index}`);
      text(column["title"], LIMITS.title, `column ${index} title`);
    }
    for (const [index, row] of list(value["rows"], LIMITS.rows, "rows").entries()) {
      if (!isRecord(row)) reject(`row ${index} must be an object`);
      fields(row, ["id", "cells"], `row ${index}`);
      id(row["id"], `row ${index}`);
      for (const [entry, cell] of list(row["cells"], LIMITS.cells, `row ${index} cells`).entries()) {
        if (!isRecord(cell)) reject(`row ${index} cell ${entry} must be an object`);
        fields(cell, ["columnId", "text"], `row ${index} cell ${entry}`);
        id(cell["columnId"], `row ${index} cell ${entry} column`);
        text(cell["text"], LIMITS.cell, `row ${index} cell ${entry} text`);
      }
    }
  }
  return value as unknown as BlockContentPayload;
}

// --- fractional positions -----------------------------------------------------

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A position strictly between `low` and `high` (null = open end). */
export function positionBetween(low: string | null, high: string | null): string {
  let result = "";
  let upper = high;
  for (let index = 0; ; index += 1) {
    const lowDigit = low !== null && index < low.length ? DIGITS.indexOf(low[index]!) : 0;
    const highDigit = upper !== null && index < upper.length ? DIGITS.indexOf(upper[index]!) : DIGITS.length;
    if (highDigit - lowDigit > 1) return result + DIGITS[Math.floor((lowDigit + highDigit) / 2)];
    result += DIGITS[lowDigit];
    if (highDigit - lowDigit === 1) upper = null;
  }
}

const byPosition = ([leftKey, left]: [string, ContentEntry], [rightKey, right]: [string, ContentEntry]): number => {
  const leftPos = String(left.pos ?? "");
  const rightPos = String(right.pos ?? "");
  if (leftPos !== rightPos) return leftPos < rightPos ? -1 : 1;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
};

// --- decomposition ------------------------------------------------------------

interface Flat {
  /** Entry fields without positions. */
  entries: Map<string, ContentEntry>;
  /** Every list in display order of entry keys. */
  lists: Map<string, string[]>;
}

function flatten(content: BlockContentPayload): Flat {
  const entries = new Map<string, ContentEntry>([[KIND_KEY, { kind: content.kind }]]);
  const lists = new Map<string, string[]>();
  const push = (listName: string, key: string, entry: ContentEntry): void => {
    entries.set(key, { list: listName, ...entry });
    lists.set(listName, [...(lists.get(listName) ?? []), key]);
  };
  for (const item of content.items ?? []) push("items", `i:${item.id}`, { text: item.text, done: item.done });
  for (const column of content.columns ?? []) {
    push("columns", `c:${column.id}`, { title: column.title });
    for (const item of column.items ?? []) push(`lane:${column.id}`, `i:${item.id}`, { text: item.text });
  }
  for (const row of content.rows ?? []) {
    push("rows", `r:${row.id}`, {});
    for (const cell of row.cells) entries.set(`x:${row.id}:${cell.columnId}`, { text: cell.text });
  }
  return { entries, lists };
}

/** The entries of a content, with deterministic positions in display order. */
export function decomposeContent(content: BlockContentPayload | undefined): ContentEntries {
  const result: ContentEntries = new Map();
  if (content === undefined) return result;
  const flat = flatten(content);
  const positions = new Map<string, string>();
  for (const keys of flat.lists.values()) {
    let previous: string | null = null;
    for (const key of keys) {
      previous = positionBetween(previous, null);
      positions.set(key, previous);
    }
  }
  for (const [key, entry] of flat.entries) {
    const position = positions.get(key);
    result.set(key, position === undefined ? { ...entry } : { ...entry, pos: position });
  }
  return result;
}

/** Rebuilds the contract content from its entries; undefined for an empty content. */
export function composeContent(entries: ContentEntries): BlockContentPayload | undefined {
  const kind = entries.get(KIND_KEY)?.["kind"] as ContentKind | undefined;
  if (kind === undefined) return undefined;
  const lists = new Map<string, [string, ContentEntry][]>();
  for (const [key, entry] of entries) {
    if (typeof entry.list !== "string") continue;
    lists.set(entry.list, [...(lists.get(entry.list) ?? []), [key, entry]]);
  }
  const ordered = (name: string): [string, ContentEntry][] => [...(lists.get(name) ?? [])].sort(byPosition);
  const idOf = (key: string): string => key.slice(key.indexOf(":") + 1);
  let content: RecordValue;
  if (kind === "checklist") {
    const items = ordered("items").map(([key, entry]) => ({ id: idOf(key), text: entry["text"], done: entry["done"] }));
    if (items.length === 0) return undefined;
    content = { kind, items };
  } else if (kind === "columns") {
    const columns = ordered("columns").map(([key, entry]) => ({
      id: idOf(key),
      title: entry["title"],
      items: ordered(`lane:${idOf(key)}`).map(([itemKey, item]) => ({ id: idOf(itemKey), text: item["text"] })),
    }));
    if (columns.length === 0) return undefined;
    content = { kind, columns };
  } else {
    const columns = ordered("columns").map(([key, entry]) => ({ id: idOf(key), title: entry["title"] }));
    const rows = ordered("rows").map(([key]) => {
      const rowId = idOf(key);
      const cells = columns
        .filter((column) => entries.has(`x:${rowId}:${column.id}`))
        .map((column) => ({ columnId: column.id, text: entries.get(`x:${rowId}:${column.id}`)!["text"] }));
      return { id: rowId, cells };
    });
    if (columns.length === 0 && rows.length === 0) return undefined;
    content = { kind, columns, rows };
  }
  return content as unknown as BlockContentPayload;
}

// --- delta ----------------------------------------------------------------------

/** The writes of one delta: full or partial entries to set, keys to delete. */
export interface ContentDelta {
  set: Map<string, ContentEntry>;
  remove: Set<string>;
}

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * The delta that turns `previous` into `next`, placed onto the `current` entries:
 * removed entries are deleted, new entries are inserted after their nearest
 * predecessor that exists in `current`, changed fields are written alone, and an
 * entry whose list or relative order changed gets a new position. An entry that
 * `current` no longer has (a concurrent delete) stays deleted.
 */
export function contentDelta(
  current: ContentEntries,
  previous: BlockContentPayload | undefined,
  next: BlockContentPayload,
): ContentDelta {
  const before = previous === undefined ? { entries: new Map<string, ContentEntry>(), lists: new Map<string, string[]>() } : flatten(previous);
  const after = flatten(next);
  const delta: ContentDelta = { set: new Map(), remove: new Set() };

  for (const key of before.entries.keys()) {
    if (!after.entries.has(key) && current.has(key)) delta.remove.add(key);
  }
  if (!sameValue(before.entries.get(KIND_KEY), after.entries.get(KIND_KEY)) || !current.has(KIND_KEY)) {
    delta.set.set(KIND_KEY, { kind: next.kind });
  }

  const placed = new Map<string, string>();
  const positionOf = (key: string): string | null => placed.get(key) ?? (current.get(key)?.pos as string | undefined) ?? null;

  for (const [listName, keys] of after.lists) {
    const previousOrder = (before.lists.get(listName) ?? []).filter((key) => keys.includes(key));
    const nextCommon = keys.filter((key) => previousOrder.includes(key));
    const moved = new Set<string>();
    for (const key of keys) {
      const added = !before.entries.has(key);
      const changedList = !added && before.entries.get(key)?.list !== listName;
      const reordered = !added && !changedList && previousOrder.indexOf(key) !== nextCommon.indexOf(key);
      if (added || changedList || reordered) moved.add(key);
    }
    for (const [index, key] of keys.entries()) {
      if (!moved.has(key)) continue;
      if (!before.entries.has(key) || current.has(key)) {
        let low: string | null = null;
        for (let back = index - 1; back >= 0; back -= 1) {
          const candidate = keys[back]!;
          if (current.has(candidate) || placed.has(candidate)) { low = positionOf(candidate); break; }
        }
        let high: string | null = null;
        for (let ahead = index + 1; ahead < keys.length; ahead += 1) {
          const candidate = keys[ahead]!;
          if (!moved.has(candidate) && current.has(candidate)) { high = positionOf(candidate); break; }
        }
        if (low !== null && high !== null && low >= high) high = null;
        const position = positionBetween(low, high);
        placed.set(key, position);
        const { list: _list, ...entryFields } = after.entries.get(key)!;
        delta.set.set(key, { ...entryFields, list: listName, pos: position });
      }
    }
  }

  for (const [key, entry] of after.entries) {
    if (key === KIND_KEY || placed.has(key)) continue;
    const old = before.entries.get(key);
    if (old === undefined) {
      // A new unordered entry (a table cell).
      delta.set.set(key, { ...entry });
      continue;
    }
    if (!current.has(key)) continue;
    const changes: ContentEntry = {};
    for (const [field, value] of Object.entries(entry)) {
      if (field !== "list" && !sameValue(old[field], value)) changes[field] = value;
    }
    if (Object.keys(changes).length > 0) delta.set.set(key, changes);
  }
  return delta;
}

/** Applies a delta to a plain entry map (the fake adapter and tests). */
export function applyContentDelta(entries: ContentEntries, delta: ContentDelta): void {
  for (const key of delta.remove) entries.delete(key);
  for (const [key, changes] of delta.set) entries.set(key, { ...(entries.get(key) ?? {}), ...changes });
}

export interface BlockContentUpdate {
  readonly blockId: string;
  readonly content: BlockContentPayload;
  /** The previous content from the embedded inverse, when the operation has one. */
  readonly previous: BlockContentPayload | undefined;
  readonly hasPrevious: boolean;
}

/** Reads and validates an `updateBlockContent` operation (payload and embedded inverse). */
export function readUpdateBlockContent(payload: RecordValue, inverse: unknown): BlockContentUpdate {
  const blockId = payload["blockId"];
  if (typeof blockId !== "string" || blockId.length === 0) throw new Error("updateBlockContent needs a blockId");
  if (!("content" in payload)) throw new Error("updateBlockContent needs a content");
  const content = validateBlockContent(payload["content"]);
  if (isRecord(inverse) && inverse["type"] === "updateBlockContent" && isRecord(inverse["payload"])) {
    const previous = validateBlockContent((inverse["payload"] as RecordValue)["content"]);
    return { blockId, content, previous, hasPrevious: true };
  }
  return { blockId, content, previous: undefined, hasPrevious: false };
}

/** Checks that a content belongs to the block type it targets. */
export function assertContentKind(blockType: unknown, content: BlockContentPayload, blockId: string): void {
  if (content.kind !== blockType) {
    throw new Error(`updateBlockContent kind ${content.kind} does not match block ${blockId} of type ${String(blockType)}`);
  }
}

/** Reads an `updateZone` payload. */
export function readUpdateZone(payload: RecordValue): { zoneId: string; title: string } {
  const zoneId = payload["zoneId"];
  const title = payload["title"];
  if (typeof zoneId !== "string" || zoneId.length === 0) throw new Error("updateZone needs a zoneId");
  if (typeof title !== "string" || title.length < 1 || title.length > 200) throw new Error("updateZone needs a title of 1-200 characters");
  return { zoneId, title };
}
