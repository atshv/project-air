// Gesture-to-operation seam of the engine logic layer (P4-05).
//
// Every content gesture from `gestures.ts` becomes exactly one contract
// operation from `packages/contracts` together with its inverse (AD-1). The
// builders read the current working copy through the narrow `DocumentPort`,
// never through the WASM module, the DOM or the network, so the same code runs
// in Node tests and in the browser. A gesture that changes nothing (an empty
// group, a move onto the current position, a resize to the current size)
// yields no operation, so the caller records no history entry.
//
// Applying an operation or an inverse is also done here, through the same port:
// the history layer in `history.ts` uses these functions and the input layer
// writes nothing directly.

import { BLOCK_TYPE_VALUES } from "../../../contracts/generated/types.ts";
import type {
  Block,
  BlockType,
  Card,
  MoveBlockPayload,
  MoveCardPayload,
  MoveZonePayload,
  Operation,
  OperationInverse,
  Zone,
} from "../../../contracts/generated/types.ts";
import type { BoardObjectFor, BoardObjectKind, DocumentPort } from "./document-port.ts";
import type {
  CreateBlockDraft,
  CreateCardDraft,
  CreateObjectDraft,
  CreateZoneDraft,
  DragGroupGesture,
  DragSingleGesture,
  GestureResult,
  KeyboardNudgeGesture,
  ResizeGesture,
  WorldPoint,
  WorldSize,
} from "./gestures.ts";

type OperationType = Operation["type"];
type OperationOf<T extends OperationType> = Extract<Operation, { readonly type: T }>;
type InverseOf<T extends OperationType> = Extract<OperationInverse, { readonly type: T }>;

/** A contract operation and its exactly one inverse (AD-1). */
export interface OperationPair {
  readonly operation: Operation;
  readonly inverse: OperationInverse;
}

/**
 * Everything the seam needs from its host: the board and actor of the session,
 * a UUIDv7 factory for operation ids and the session clock. Injecting all four
 * keeps the builders deterministic in tests and free of ambient randomness.
 */
export interface OperationContext {
  readonly boardId: string;
  readonly actorId: string;
  /** Returns a new lowercase UUIDv7; called once per operation record. */
  readonly createOperationId: () => string;
  /** Returns the current ISO-8601 timestamp with timezone. */
  readonly now: () => string;
}

/** A gesture or operation the seam cannot convert or apply. */
export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const FRACTIONAL_INDEX = /^[0-9A-Za-z]{1,64}$/;

const CARD_MINIMUM: WorldSize = { width: 176, height: 80 };
const ZONE_MINIMUM: WorldSize = { width: 256, height: 192 };

/** Block minimum sizes from the if/then branches of block.schema.json. */
const BLOCK_MINIMUM: Readonly<Record<BlockType, WorldSize>> = {
  checklist: { width: 224, height: 128 },
  palette: { width: 224, height: 128 },
  columns: { width: 368, height: 192 },
  timeline: { width: 320, height: 160 },
  table: { width: 288, height: 160 },
};

function assertUuidV7(value: string, label: string): void {
  if (!UUID_V7.test(value)) {
    throw new OperationError(`${label} must be a lowercase UUIDv7, got ${JSON.stringify(value)}`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!ISO_TIMESTAMP.test(value)) {
    throw new OperationError(`${label} must be an ISO-8601 timestamp with timezone, got ${JSON.stringify(value)}`);
  }
}

function assertFractionalIndex(value: string, label: string): void {
  if (!FRACTIONAL_INDEX.test(value)) {
    throw new OperationError(`${label} must be a 1-64 character fractional index, got ${JSON.stringify(value)}`);
  }
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new OperationError(`${label} must be a finite number, got ${String(value)}`);
  }
}

function assertGeometry(size: WorldSize, label: string, minimum: WorldSize): void {
  assertFiniteNumber(size.width, `${label} width`);
  assertFiniteNumber(size.height, `${label} height`);
  if (size.width < minimum.width || size.height < minimum.height) {
    throw new OperationError(
      `${label} needs at least ${minimum.width}x${minimum.height} px, got ${size.width}x${size.height}`,
    );
  }
}

function assertBlockType(value: string): asserts value is BlockType {
  if (!(BLOCK_TYPE_VALUES as readonly string[]).includes(value)) {
    throw new OperationError(`unknown block type ${JSON.stringify(value)}`);
  }
}

function assertPoint(point: WorldPoint, label: string): void {
  assertFiniteNumber(point.x, `${label} x`);
  assertFiniteNumber(point.y, `${label} y`);
}

function nextOperationId(context: OperationContext): string {
  const id = context.createOperationId();
  assertUuidV7(id, "operation id");
  return id;
}

function nextTimestamp(context: OperationContext): string {
  const timestamp = context.now();
  assertTimestamp(timestamp, "operation timestamp");
  return timestamp;
}

function makeOperation<T extends OperationType>(
  context: OperationContext,
  type: T,
  payload: OperationOf<T>["payload"],
  inverse: InverseOf<T>,
): OperationOf<T> {
  const operation = {
    id: nextOperationId(context),
    boardId: context.boardId,
    actorId: context.actorId,
    createdAt: nextTimestamp(context),
    type,
    payload,
    inverse,
  };
  // TypeScript cannot prove a generic builder against the contract union; the
  // discriminated payload/inverse pair above is checked by the schema tests.
  return operation as unknown as OperationOf<T>;
}

function makeInverse<T extends OperationType>(
  context: OperationContext,
  type: T,
  payload: InverseOf<T>["payload"],
): InverseOf<T> {
  const inverse = { boardId: context.boardId, type, payload };
  return inverse as unknown as InverseOf<T>;
}

function requiredObject<K extends BoardObjectKind>(
  port: DocumentPort,
  kind: K,
  id: string,
): BoardObjectFor<K> {
  assertUuidV7(id, "gesture object id");
  const object = port.read(kind, id);
  if (object === undefined) {
    throw new OperationError(`the document contains no ${kind} ${id}`);
  }
  return object;
}

function moveCardPayload(card: Card, x: number, y: number): MoveCardPayload {
  return {
    cardId: card.id,
    x,
    y,
    ...(typeof card.zoneId === "string" ? { zoneId: card.zoneId } : {}),
  };
}

function moveBlockPayload(block: Block, x: number, y: number): MoveBlockPayload {
  return {
    blockId: block.id,
    x,
    y,
    ...(typeof block.zoneId === "string" ? { zoneId: block.zoneId } : {}),
  };
}

function moveZonePayload(zone: Zone, x: number, y: number): MoveZonePayload {
  // payload-move-zone identifies the moved zone in `zoneId`: the valid fixture
  // and its inverse rely on it, and contract 0.2.0 corrects the description to
  // name the moved zone instead of a parent zone.
  return { zoneId: zone.id, x, y };
}

function buildMoveOperation(
  port: DocumentPort,
  context: OperationContext,
  objectKind: BoardObjectKind,
  objectId: string,
  position: WorldPoint,
): Operation | null {
  assertPoint(position, "gesture position");
  switch (objectKind) {
    case "card": {
      const card = requiredObject(port, "card", objectId);
      if (card.x === position.x && card.y === position.y) {
        return null;
      }
      return makeOperation(
        context,
        "moveCard",
        moveCardPayload(card, position.x, position.y),
        makeInverse(context, "moveCard", moveCardPayload(card, card.x, card.y)),
      );
    }
    case "zone": {
      const zone = requiredObject(port, "zone", objectId);
      if (zone.x === position.x && zone.y === position.y) {
        return null;
      }
      return makeOperation(
        context,
        "moveZone",
        moveZonePayload(zone, position.x, position.y),
        makeInverse(context, "moveZone", moveZonePayload(zone, zone.x, zone.y)),
      );
    }
    case "block": {
      const block = requiredObject(port, "block", objectId);
      if (block.x === position.x && block.y === position.y) {
        return null;
      }
      return makeOperation(
        context,
        "moveBlock",
        moveBlockPayload(block, position.x, position.y),
        makeInverse(context, "moveBlock", moveBlockPayload(block, block.x, block.y)),
      );
    }
  }
}

function buildResizeOperation(
  port: DocumentPort,
  context: OperationContext,
  gesture: ResizeGesture,
): Operation | null {
  switch (gesture.objectKind) {
    case "card": {
      const card = requiredObject(port, "card", gesture.objectId);
      assertGeometry(gesture.size, `card ${card.id}`, CARD_MINIMUM);
      if (card.width === gesture.size.width && card.height === gesture.size.height) {
        return null;
      }
      return makeOperation(
        context,
        "resizeCard",
        { cardId: card.id, width: gesture.size.width, height: gesture.size.height },
        makeInverse(context, "resizeCard", {
          cardId: card.id,
          width: card.width,
          height: card.height,
        }),
      );
    }
    case "zone": {
      const zone = requiredObject(port, "zone", gesture.objectId);
      assertGeometry(gesture.size, `zone ${zone.id}`, ZONE_MINIMUM);
      if (zone.width === gesture.size.width && zone.height === gesture.size.height) {
        return null;
      }
      return makeOperation(
        context,
        "resizeZone",
        { zoneId: zone.id, width: gesture.size.width, height: gesture.size.height },
        makeInverse(context, "resizeZone", {
          zoneId: zone.id,
          width: zone.width,
          height: zone.height,
        }),
      );
    }
    case "block": {
      const block = requiredObject(port, "block", gesture.objectId);
      assertGeometry(gesture.size, `block ${block.id}`, BLOCK_MINIMUM[block.type]);
      if (block.width === gesture.size.width && block.height === gesture.size.height) {
        return null;
      }
      return makeOperation(
        context,
        "resizeBlock",
        {
          blockId: block.id,
          type: block.type,
          width: gesture.size.width,
          height: gesture.size.height,
        },
        makeInverse(context, "resizeBlock", {
          blockId: block.id,
          type: block.type,
          width: block.width,
          height: block.height,
        }),
      );
    }
  }
}

function cardFromDraft(context: OperationContext, draft: CreateCardDraft): Card {
  assertUuidV7(draft.id, "card id");
  assertUuidV7(draft.noteId, "card noteId");
  if (draft.zoneId !== undefined && draft.zoneId !== null) {
    assertUuidV7(draft.zoneId, "card zoneId");
  }
  assertFractionalIndex(draft.z, "card z");
  assertPoint(draft, `card ${draft.id}`);
  assertGeometry(draft, `card ${draft.id}`, CARD_MINIMUM);
  const timestamp = nextTimestamp(context);
  return {
    id: draft.id,
    boardId: context.boardId,
    noteId: draft.noteId,
    ...(draft.zoneId === undefined ? {} : { zoneId: draft.zoneId }),
    x: draft.x,
    y: draft.y,
    width: draft.width,
    height: draft.height,
    z: draft.z,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function zoneFromDraft(context: OperationContext, draft: CreateZoneDraft): Zone {
  assertUuidV7(draft.id, "zone id");
  if (draft.title.length < 1 || draft.title.length > 200) {
    throw new OperationError(`zone title must be 1-200 characters, got ${draft.title.length}`);
  }
  assertFractionalIndex(draft.z, "zone z");
  assertPoint(draft, `zone ${draft.id}`);
  assertGeometry(draft, `zone ${draft.id}`, ZONE_MINIMUM);
  const timestamp = nextTimestamp(context);
  return {
    id: draft.id,
    boardId: context.boardId,
    title: draft.title,
    x: draft.x,
    y: draft.y,
    width: draft.width,
    height: draft.height,
    z: draft.z,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function blockFromDraft(context: OperationContext, draft: CreateBlockDraft): Block {
  assertUuidV7(draft.id, "block id");
  assertBlockType(draft.type);
  if (draft.zoneId !== undefined && draft.zoneId !== null) {
    assertUuidV7(draft.zoneId, "block zoneId");
  }
  assertFractionalIndex(draft.z, "block z");
  assertPoint(draft, `block ${draft.id}`);
  assertGeometry(draft, `block ${draft.id}`, BLOCK_MINIMUM[draft.type]);
  const timestamp = nextTimestamp(context);
  return {
    id: draft.id,
    boardId: context.boardId,
    type: draft.type,
    ...(draft.zoneId === undefined ? {} : { zoneId: draft.zoneId }),
    x: draft.x,
    y: draft.y,
    width: draft.width,
    height: draft.height,
    z: draft.z,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildCreateOperation(
  context: OperationContext,
  draft: CreateObjectDraft,
): OperationPair {
  switch (draft.kind) {
    case "card": {
      const card = cardFromDraft(context, draft);
      const inverse = makeInverse(context, "deleteCard", { card });
      const operation = makeOperation(context, "createCard", { card }, inverse);
      return { operation, inverse: operation.inverse };
    }
    case "zone": {
      const zone = zoneFromDraft(context, draft);
      const inverse = makeInverse(context, "deleteZone", {
        zone,
        policy: "delete",
        cards: [],
        blocks: [],
      });
      const operation = makeOperation(context, "createZone", { zone }, inverse);
      return { operation, inverse: operation.inverse };
    }
    case "block": {
      const block = blockFromDraft(context, draft);
      const inverse = makeInverse(context, "deleteBlock", { block });
      const operation = makeOperation(context, "createBlock", { block }, inverse);
      return { operation, inverse: operation.inverse };
    }
  }
}

function buildDeleteOperation(
  port: DocumentPort,
  context: OperationContext,
  objectKind: "card" | "block",
  objectId: string,
): OperationPair {
  switch (objectKind) {
    case "card": {
      const card = { ...requiredObject(port, "card", objectId) };
      const inverse = makeInverse(context, "createCard", { card });
      const operation = makeOperation(context, "deleteCard", { card }, inverse);
      return { operation, inverse: operation.inverse };
    }
    case "block": {
      const block = { ...requiredObject(port, "block", objectId) };
      const inverse = makeInverse(context, "createBlock", { block });
      const operation = makeOperation(context, "deleteBlock", { block }, inverse);
      return { operation, inverse: operation.inverse };
    }
  }
}

function buildDragGroup(
  port: DocumentPort,
  context: OperationContext,
  gesture: DragGroupGesture,
): OperationPair | null {
  if (gesture.members.length === 0) {
    return null;
  }
  const seen = new Set<string>();
  const children: Operation[] = [];
  for (const member of gesture.members) {
    const key = `${member.objectKind}:${member.objectId}`;
    if (seen.has(key)) {
      throw new OperationError(`the drag group lists ${member.objectKind} ${member.objectId} twice`);
    }
    seen.add(key);
    const child = buildMoveOperation(
      port,
      context,
      member.objectKind,
      member.objectId,
      member.position,
    );
    if (child !== null) {
      children.push(child);
    }
  }
  if (children.length === 0) {
    return null;
  }
  const inverseChildren: OperationInverse[] = children
    .map((child) => child.inverse)
    .reverse();
  const inverse = makeInverse(context, "group", { children: inverseChildren });
  const operation = makeOperation(context, "group", { children }, inverse);
  return { operation, inverse: operation.inverse };
}

function buildNudgeOperation(
  port: DocumentPort,
  context: OperationContext,
  gesture: KeyboardNudgeGesture,
): Operation | null {
  assertPoint(gesture.delta, "keyboard nudge delta");
  const object = requiredObject(port, gesture.objectKind, gesture.objectId);
  const position: WorldPoint = {
    x: object.x + gesture.delta.x,
    y: object.y + gesture.delta.y,
  };
  return buildMoveOperation(port, context, gesture.objectKind, gesture.objectId, position);
}

function buildDragSingle(
  port: DocumentPort,
  context: OperationContext,
  gesture: DragSingleGesture,
): OperationPair | null {
  const operation = buildMoveOperation(
    port,
    context,
    gesture.objectKind,
    gesture.objectId,
    gesture.position,
  );
  return operation === null ? null : { operation, inverse: operation.inverse };
}

/**
 * Converts one gesture result into exactly one contract operation with its
 * inverse, or `null` when the gesture changes nothing. Unknown objects, invalid
 * ids and sizes below the contract minimum throw `OperationError` and leave the
 * working copy and the history untouched.
 */
export function buildOperation(
  port: DocumentPort,
  context: OperationContext,
  gesture: GestureResult,
): OperationPair | null {
  assertUuidV7(context.boardId, "context boardId");
  assertUuidV7(context.actorId, "context actorId");
  switch (gesture.kind) {
    case "drag-single":
      return buildDragSingle(port, context, gesture);
    case "drag-group":
      return buildDragGroup(port, context, gesture);
    case "resize": {
      const operation = buildResizeOperation(port, context, gesture);
      return operation === null ? null : { operation, inverse: operation.inverse };
    }
    case "create":
      return buildCreateOperation(context, gesture.draft);
    case "delete":
      return buildDeleteOperation(port, context, gesture.objectKind, gesture.objectId);
    case "keyboard-nudge": {
      const operation = buildNudgeOperation(port, context, gesture);
      return operation === null ? null : { operation, inverse: operation.inverse };
    }
  }
}

function applyChange(port: DocumentPort, change: Operation | OperationInverse): void {
  switch (change.type) {
    case "createCard": {
      port.add("card", change.payload.card);
      return;
    }
    case "createZone": {
      port.add("zone", change.payload.zone);
      return;
    }
    case "createBlock": {
      port.add("block", change.payload.block);
      return;
    }
    case "deleteCard": {
      port.remove("card", change.payload.card.id);
      return;
    }
    case "deleteBlock": {
      port.remove("block", change.payload.block.id);
      return;
    }
    case "moveCard": {
      // Geometry only: the seam never changes zone membership (P4-23/24); the
      // payload carries the unchanged parent so the contract stays complete.
      port.move("card", change.payload.cardId, change.payload.x, change.payload.y);
      return;
    }
    case "moveZone": {
      if (change.payload.zoneId === null) {
        throw new OperationError("a moveZone operation without a zone id cannot be applied");
      }
      port.move("zone", change.payload.zoneId, change.payload.x, change.payload.y);
      return;
    }
    case "moveBlock": {
      port.move("block", change.payload.blockId, change.payload.x, change.payload.y);
      return;
    }
    case "deleteZone": {
      // The exactly one inverse of createZone is a deleteZone. Its policy
      // "delete" lists the objects removed with the zone (none for a freshly
      // created zone); "keep" reparents children and belongs to L08.
      if (change.payload.policy === "keep") {
        throw new OperationError(
          "deleteZone with policy keep needs zone membership handling (P4-23/24, L08)",
        );
      }
      for (const card of change.payload.cards) {
        port.remove("card", card.id);
      }
      for (const block of change.payload.blocks) {
        port.remove("block", block.id);
      }
      port.remove("zone", change.payload.zone.id);
      return;
    }
    case "resizeCard": {
      port.resize("card", change.payload.cardId, change.payload.width, change.payload.height);
      return;
    }
    case "resizeZone": {
      port.resize("zone", change.payload.zoneId, change.payload.width, change.payload.height);
      return;
    }
    case "resizeBlock": {
      port.resize("block", change.payload.blockId, change.payload.width, change.payload.height);
      return;
    }
    case "group": {
      for (const child of change.payload.children) {
        applyChange(port, child);
      }
      return;
    }
    case "createNote":
    case "updateNote":
    case "deleteNote":
    case "createEdge":
    case "deleteEdge":
    case "updateBlock":
      throw new OperationError(
        `operation type ${change.type} is outside the engine document seam (see docs/engine.md)`,
      );
  }
}

/** Applies one contract operation to the working copy through the port. */
export function applyOperation(port: DocumentPort, operation: Operation): void {
  applyChange(port, operation);
}

/** Applies the exactly one inverse of an operation (undo). */
export function applyInverse(port: DocumentPort, inverse: OperationInverse): void {
  applyChange(port, inverse);
}

// The payload casts above narrow the contract union that TypeScript cannot
// discriminate across the operation/inverse pair; the schema fixtures pin the
// payload shape, and `test/operations.test.mjs` validates every built operation
// against operation.schema.json.
