/**
 * `/v1/workspaces/:workspaceId/boards` and `/v1/boards/:boardId` routes.
 *
 * Read = any workspace member, create/update/delete = owner/editor; a
 * non-member receives NOT_FOUND, a reader receives FORBIDDEN on writes.
 */

import { notFound, validationFailed } from "../http/errors.ts";
import { createUuid } from "../http/request-id.ts";
import type { Router } from "../http/router.ts";
import { withAuthenticatedRequest, type ApiDependencies } from "./context.ts";
import { BOARD_COLUMNS, mapBoard, type BoardRow } from "./entities.ts";
import { encodeCursor, parsePageQuery, requestIdFromQuery, runPageQuery } from "./pagination.ts";
import { requireBoardMember, requireBoardWriter, requireWorkspaceMember, requireWorkspaceWriter } from "./permissions.ts";
import {
  booleanField,
  enumField,
  hasOnlyKeys,
  isRecord,
  parseEnvelope,
  pathUuid,
  requiredRequestId,
  requireValid,
  stringField,
  uuidField,
  type FieldList,
} from "./validation.ts";

const VISIBILITIES = ["private", "workspace", "link"] as const;

export type BoardVisibility = (typeof VISIBILITIES)[number];

interface BoardCreate {
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly visibility: BoardVisibility;
}

interface BoardChanges {
  readonly title?: string | undefined;
  readonly visibility?: BoardVisibility | undefined;
  readonly archived?: boolean | undefined;
}

function parseBoardCreate(input: unknown): BoardCreate {
  if (!isRecord(input)) {
    throw validationFailed(["board"]);
  }
  const fields: FieldList = [];
  hasOnlyKeys(input, ["workspaceId", "ownerId", "title", "visibility"], "board.", fields);
  const workspaceId = uuidField(input, "workspaceId", "board.workspaceId", fields);
  const ownerId = uuidField(input, "ownerId", "board.ownerId", fields);
  const title = stringField(input, "title", "board.title", 1, 200, fields);
  const visibility = enumField(input, "visibility", "board.visibility", VISIBILITIES, fields);
  requireValid(fields);
  if (workspaceId === undefined || ownerId === undefined || title === undefined || visibility === undefined) {
    throw validationFailed(["board"]);
  }
  return { workspaceId, ownerId, title, visibility };
}

function parseBoardChanges(input: unknown): BoardChanges {
  if (!isRecord(input)) {
    throw validationFailed(["changes"]);
  }
  if (Object.keys(input).length === 0) {
    throw validationFailed(["changes"]);
  }
  const fields: FieldList = [];
  hasOnlyKeys(input, ["title", "visibility", "archived"], "changes.", fields);
  const title = "title" in input ? stringField(input, "title", "changes.title", 1, 200, fields) : undefined;
  const visibility =
    "visibility" in input ? enumField(input, "visibility", "changes.visibility", VISIBILITIES, fields) : undefined;
  const archived = "archived" in input ? booleanField(input, "archived", "changes.archived", fields) : undefined;
  requireValid(fields);
  return { title, visibility, archived };
}

export function registerBoardRoutes(router: Router, dependencies: ApiDependencies): void {
  router.get("/v1/workspaces/:workspaceId/boards", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const workspaceId = pathUuid(match.params.workspaceId ?? "");
      await requireWorkspaceMember(client, workspaceId);
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      const page = parsePageQuery(context.query);
      const result = await runPageQuery<BoardRow>(
        client,
        page.cursor,
        `SELECT ${BOARD_COLUMNS}, created_at::text AS created_at_text
         FROM app.boards
         WHERE workspace_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid))
         ORDER BY created_at, id
         LIMIT $4`,
        [workspaceId, page.cursor?.createdAt ?? null, page.cursor?.id ?? null, page.limit + 1],
      );
      const hasMore = result.rows.length > page.limit;
      const rows = hasMore ? result.rows.slice(0, page.limit) : result.rows;
      const last = rows.at(-1);
      return {
        body: {
          requestId,
          items: rows.map(mapBoard),
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at_text, last.id) : null,
        },
      };
    }),
  );

  router.post("/v1/workspaces/:workspaceId/boards", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client, user }) => {
      const workspaceId = pathUuid(match.params.workspaceId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "board"], ["requestId", "board"]);
      const requestId = requiredRequestId(envelope);
      context.useRequestId(requestId);
      const board = parseBoardCreate(envelope.board);
      if (board.workspaceId !== workspaceId) {
        throw validationFailed(["board.workspaceId"]);
      }
      if (board.ownerId !== user.accountId) {
        throw validationFailed(["board.ownerId"]);
      }
      await requireWorkspaceWriter(client, workspaceId);
      const result = await client.query<BoardRow>(
        `INSERT INTO app.boards (id, workspace_id, owner_account_id, title, visibility)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${BOARD_COLUMNS}`,
        [createUuid(), workspaceId, board.ownerId, board.title, board.visibility],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw validationFailed(["board"]);
      }
      return { status: 201, body: { requestId, board: mapBoard(row) } };
    }),
  );

  router.get("/v1/boards/:boardId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const boardId = pathUuid(match.params.boardId ?? "");
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      // Defence in depth (AD-5): explicit membership check before the lookup.
      await requireBoardMember(client, boardId);
      const result = await client.query<BoardRow>(`SELECT ${BOARD_COLUMNS}, created_at::text AS created_at_text FROM app.boards WHERE id = $1`, [boardId]);
      const row = result.rows[0];
      if (row === undefined) {
        throw notFound("the board does not exist");
      }
      return { body: { requestId, board: mapBoard(row) } };
    }),
  );

  router.patch("/v1/boards/:boardId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const boardId = pathUuid(match.params.boardId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "boardId", "changes"], [
        "requestId",
        "boardId",
        "changes",
      ]);
      const requestId = requiredRequestId(envelope);
      context.useRequestId(requestId);
      if (uuidField(envelope, "boardId", "boardId", []) !== boardId) {
        throw validationFailed(["boardId"]);
      }
      const changes = parseBoardChanges(envelope.changes);
      await requireBoardWriter(client, boardId);
      const assignments: string[] = [];
      const values: unknown[] = [boardId];
      if (changes.title !== undefined) {
        values.push(changes.title);
        assignments.push(`title = $${values.length}`);
      }
      if (changes.visibility !== undefined) {
        values.push(changes.visibility);
        assignments.push(`visibility = $${values.length}`);
      }
      if (changes.archived !== undefined) {
        values.push(changes.archived);
        assignments.push(`archived = $${values.length}`);
      }
      assignments.push("updated_at = now()");
      const result = await client.query<BoardRow>(
        `UPDATE app.boards SET ${assignments.join(", ")} WHERE id = $1 RETURNING ${BOARD_COLUMNS}`,
        values,
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw notFound("the board does not exist");
      }
      return { body: { requestId, board: mapBoard(row) } };
    }),
  );

  router.delete("/v1/boards/:boardId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const boardId = pathUuid(match.params.boardId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "boardId"], [
        "requestId",
        "boardId",
      ]);
      const requestId = requiredRequestId(envelope);
      if (uuidField(envelope, "boardId", "boardId", []) !== boardId) {
        throw validationFailed(["boardId"]);
      }
      await requireBoardWriter(client, boardId);
      const result = await client.query<{ id: string }>("DELETE FROM app.boards WHERE id = $1 RETURNING id", [boardId]);
      if (result.rows[0] === undefined) {
        throw notFound("the board does not exist");
      }
      return { body: { requestId, deletedId: boardId } };
    }),
  );
}
