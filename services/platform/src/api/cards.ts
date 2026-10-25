/**
 * `/v1/boards/:boardId/cards` and `/v1/cards/:cardId` routes.
 *
 * A card is a note placement (AD-4). Read = any member of the board's
 * workspace, create/update/delete = owner/editor. The note must live in the
 * board's own workspace; the database trigger and RLS enforce the same rule.
 */

import { notFound, validationFailed } from "../http/errors.ts";
import { createUuid } from "../http/request-id.ts";
import type { Router } from "../http/router.ts";
import { withAuthenticatedRequest, type ApiDependencies } from "./context.ts";
import { CARD_COLUMNS, mapCard, type CardRow } from "./entities.ts";
import { encodeCursor, parsePageQuery, requestIdFromQuery, runPageQuery } from "./pagination.ts";
import { requireBoardMember, requireBoardWriter, requireCardMember } from "./permissions.ts";
import {
  hasOnlyKeys,
  isRecord,
  numberField,
  parseEnvelope,
  pathUuid,
  requiredRequestId,
  requireValid,
  stringField,
  uuidField,
  type FieldList,
} from "./validation.ts";

const Z_PATTERN = /^[0-9A-Za-z]{1,64}$/;

interface CardCreate {
  readonly boardId: string;
  readonly noteId: string;
  readonly zoneId: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: string;
}

interface CardChanges {
  readonly zoneId?: string | null | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly z?: string | undefined;
}

function parseCardCreate(input: unknown): CardCreate {
  if (!isRecord(input)) {
    throw validationFailed(["card"]);
  }
  const fields: FieldList = [];
  hasOnlyKeys(input, ["boardId", "noteId", "zoneId", "x", "y", "width", "height", "z"], "card.", fields);
  const boardId = uuidField(input, "boardId", "card.boardId", fields);
  const noteId = uuidField(input, "noteId", "card.noteId", fields);
  const zoneId = uuidField(input, "zoneId", "card.zoneId", fields, { nullable: true });
  const x = numberField(input, "x", "card.x", fields);
  const y = numberField(input, "y", "card.y", fields);
  const width = numberField(input, "width", "card.width", fields, 176);
  const height = numberField(input, "height", "card.height", fields, 80);
  const z = stringField(input, "z", "card.z", 1, 64, fields);
  if (typeof input.z === "string" && !Z_PATTERN.test(input.z)) {
    fields.push("card.z");
  }
  requireValid(fields);
  if (
    boardId === undefined ||
    noteId === undefined ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    z === undefined
  ) {
    throw validationFailed(["card"]);
  }
  return { boardId, noteId, zoneId: zoneId ?? null, x, y, width, height, z };
}

function parseCardChanges(input: unknown): CardChanges {
  if (!isRecord(input)) {
    throw validationFailed(["changes"]);
  }
  if (Object.keys(input).length === 0) {
    throw validationFailed(["changes"]);
  }
  const fields: FieldList = [];
  hasOnlyKeys(input, ["zoneId", "x", "y", "width", "height", "z"], "changes.", fields);
  const zoneId = "zoneId" in input ? uuidField(input, "zoneId", "changes.zoneId", fields, { nullable: true }) : undefined;
  const x = "x" in input ? numberField(input, "x", "changes.x", fields) : undefined;
  const y = "y" in input ? numberField(input, "y", "changes.y", fields) : undefined;
  const width = "width" in input ? numberField(input, "width", "changes.width", fields, 176) : undefined;
  const height = "height" in input ? numberField(input, "height", "changes.height", fields, 80) : undefined;
  const z = "z" in input ? stringField(input, "z", "changes.z", 1, 64, fields) : undefined;
  if (typeof input.z === "string" && !Z_PATTERN.test(input.z)) {
    fields.push("changes.z");
  }
  requireValid(fields);
  return { zoneId, x, y, width, height, z };
}

export function registerCardRoutes(router: Router, dependencies: ApiDependencies): void {
  router.get("/v1/boards/:boardId/cards", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const boardId = pathUuid(match.params.boardId ?? "");
      await requireBoardMember(client, boardId);
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      const page = parsePageQuery(context.query);
      const result = await runPageQuery<CardRow>(
        client,
        page.cursor,
        `SELECT ${CARD_COLUMNS}, created_at::text AS created_at_text
         FROM app.cards
         WHERE board_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid))
         ORDER BY created_at, id
         LIMIT $4`,
        [boardId, page.cursor?.createdAt ?? null, page.cursor?.id ?? null, page.limit + 1],
      );
      const hasMore = result.rows.length > page.limit;
      const rows = hasMore ? result.rows.slice(0, page.limit) : result.rows;
      const last = rows.at(-1);
      return {
        body: {
          requestId,
          items: rows.map(mapCard),
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at_text, last.id) : null,
        },
      };
    }),
  );

  router.post("/v1/boards/:boardId/cards", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const boardId = pathUuid(match.params.boardId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "card"], ["requestId", "card"]);
      const requestId = requiredRequestId(envelope);
      context.useRequestId(requestId);
      const card = parseCardCreate(envelope.card);
      if (card.boardId !== boardId) {
        throw validationFailed(["card.boardId"]);
      }
      await requireBoardWriter(client, boardId);
      await requireNoteOfBoard(client, card.noteId, boardId);
      const result = await client.query<CardRow>(
        `INSERT INTO app.cards (id, board_id, note_id, zone_id, x, y, width, height, z)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${CARD_COLUMNS}`,
        [createUuid(), boardId, card.noteId, card.zoneId, card.x, card.y, card.width, card.height, card.z],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw validationFailed(["card"]);
      }
      return { status: 201, body: { requestId, card: mapCard(row) } };
    }),
  );

  router.get("/v1/cards/:cardId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const cardId = pathUuid(match.params.cardId ?? "");
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      // Defence in depth (AD-5): explicit membership check before the lookup.
      await requireCardMember(client, cardId);
      const result = await client.query<CardRow>(`SELECT ${CARD_COLUMNS}, created_at::text AS created_at_text FROM app.cards WHERE id = $1`, [cardId]);
      const row = result.rows[0];
      if (row === undefined) {
        throw notFound("the card does not exist");
      }
      return { body: { requestId, card: mapCard(row) } };
    }),
  );

  router.patch("/v1/cards/:cardId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const cardId = pathUuid(match.params.cardId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "cardId", "changes"], [
        "requestId",
        "cardId",
        "changes",
      ]);
      const requestId = requiredRequestId(envelope);
      context.useRequestId(requestId);
      if (uuidField(envelope, "cardId", "cardId", []) !== cardId) {
        throw validationFailed(["cardId"]);
      }
      const changes = parseCardChanges(envelope.changes);
      const existing = await client.query<{ board_id: string }>("SELECT board_id FROM app.cards WHERE id = $1", [cardId]);
      const card = existing.rows[0];
      if (card === undefined) {
        throw notFound("the card does not exist");
      }
      await requireBoardWriter(client, card.board_id);
      const assignments: string[] = [];
      const values: unknown[] = [cardId];
      if (changes.zoneId !== undefined) {
        values.push(changes.zoneId);
        assignments.push(`zone_id = $${values.length}`);
      }
      if (changes.x !== undefined) {
        values.push(changes.x);
        assignments.push(`x = $${values.length}`);
      }
      if (changes.y !== undefined) {
        values.push(changes.y);
        assignments.push(`y = $${values.length}`);
      }
      if (changes.width !== undefined) {
        values.push(changes.width);
        assignments.push(`width = $${values.length}`);
      }
      if (changes.height !== undefined) {
        values.push(changes.height);
        assignments.push(`height = $${values.length}`);
      }
      if (changes.z !== undefined) {
        values.push(changes.z);
        assignments.push(`z = $${values.length}`);
      }
      assignments.push("updated_at = now()");
      const result = await client.query<CardRow>(
        `UPDATE app.cards SET ${assignments.join(", ")} WHERE id = $1 RETURNING ${CARD_COLUMNS}`,
        values,
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw notFound("the card does not exist");
      }
      return { body: { requestId, card: mapCard(row) } };
    }),
  );

  router.delete("/v1/cards/:cardId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const cardId = pathUuid(match.params.cardId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "cardId"], [
        "requestId",
        "cardId",
      ]);
      const requestId = requiredRequestId(envelope);
      if (uuidField(envelope, "cardId", "cardId", []) !== cardId) {
        throw validationFailed(["cardId"]);
      }
      const existing = await client.query<{ board_id: string }>("SELECT board_id FROM app.cards WHERE id = $1", [cardId]);
      const card = existing.rows[0];
      if (card === undefined) {
        throw notFound("the card does not exist");
      }
      await requireBoardWriter(client, card.board_id);
      const result = await client.query<{ id: string }>("DELETE FROM app.cards WHERE id = $1 RETURNING id", [cardId]);
      if (result.rows[0] === undefined) {
        throw notFound("the card does not exist");
      }
      return { body: { requestId, deletedId: cardId } };
    }),
  );
}

/** The note must exist, be visible and live in the board's workspace. */
async function requireNoteOfBoard(
  client: import("pg").PoolClient,
  noteId: string,
  boardId: string,
): Promise<void> {
  const note = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM app.notes WHERE id = $1", [
    noteId,
  ]);
  const noteRow = note.rows[0];
  if (noteRow === undefined) {
    throw validationFailed(["card.noteId"]);
  }
  const board = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM app.boards WHERE id = $1", [
    boardId,
  ]);
  const boardRow = board.rows[0];
  if (boardRow === undefined || boardRow.workspace_id !== noteRow.workspace_id) {
    throw validationFailed(["card.noteId"]);
  }
}
