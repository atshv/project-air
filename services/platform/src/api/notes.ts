/**
 * `/v1/workspaces/:workspaceId/notes` and `/v1/notes/:noteId` routes.
 *
 * A note exists once in its workspace (AD-4); cards only reference it. Read =
 * any member, create/update/delete = owner/editor.
 */

import { conflict, notFound, validationFailed } from "../http/errors.ts";
import { sqlStateOf } from "../db/errors.ts";
import { createUuid } from "../http/request-id.ts";
import type { QueryResult } from "pg";
import type { Router } from "../http/router.ts";
import { withAuthenticatedRequest, type ApiDependencies } from "./context.ts";
import { mapNote, NOTE_COLUMNS, type NoteRow } from "./entities.ts";
import { encodeCursor, parsePageQuery, requestIdFromQuery, runPageQuery } from "./pagination.ts";
import { requireNoteMember, requireWorkspaceMember, requireWorkspaceWriter } from "./permissions.ts";
import {
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

interface NoteCreate {
  readonly workspaceId: string;
  readonly title: string;
}

interface NoteChanges {
  readonly title: string;
}

function parseNoteCreate(input: unknown): NoteCreate {
  if (!isRecord(input)) {
    throw validationFailed(["note"]);
  }
  const fields: FieldList = [];
  hasOnlyKeys(input, ["workspaceId", "title"], "note.", fields);
  const workspaceId = uuidField(input, "workspaceId", "note.workspaceId", fields);
  const title = stringField(input, "title", "note.title", 0, 300, fields);
  requireValid(fields);
  if (workspaceId === undefined || title === undefined) {
    throw validationFailed(["note"]);
  }
  return { workspaceId, title };
}

function parseNoteChanges(input: unknown): NoteChanges {
  if (!isRecord(input)) {
    throw validationFailed(["changes"]);
  }
  if (Object.keys(input).length === 0) {
    throw validationFailed(["changes"]);
  }
  const fields: FieldList = [];
  hasOnlyKeys(input, ["title"], "changes.", fields);
  const title = stringField(input, "title", "changes.title", 0, 300, fields);
  requireValid(fields);
  if (title === undefined) {
    throw validationFailed(["changes.title"]);
  }
  return { title };
}

export function registerNoteRoutes(router: Router, dependencies: ApiDependencies): void {
  router.get("/v1/workspaces/:workspaceId/notes", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const workspaceId = pathUuid(match.params.workspaceId ?? "");
      await requireWorkspaceMember(client, workspaceId);
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      const page = parsePageQuery(context.query);
      const result = await runPageQuery<NoteRow>(
        client,
        page.cursor,
        `SELECT ${NOTE_COLUMNS}, created_at::text AS created_at_text
         FROM app.notes
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
          items: rows.map(mapNote),
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at_text, last.id) : null,
        },
      };
    }),
  );

  router.post("/v1/workspaces/:workspaceId/notes", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const workspaceId = pathUuid(match.params.workspaceId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "note"], ["requestId", "note"]);
      const requestId = requiredRequestId(envelope);
      context.useRequestId(requestId);
      const note = parseNoteCreate(envelope.note);
      if (note.workspaceId !== workspaceId) {
        throw validationFailed(["note.workspaceId"]);
      }
      await requireWorkspaceWriter(client, workspaceId);
      const result = await client.query<NoteRow>(
        `INSERT INTO app.notes (id, workspace_id, title)
         VALUES ($1, $2, $3)
         RETURNING ${NOTE_COLUMNS}`,
        [createUuid(), workspaceId, note.title],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw validationFailed(["note"]);
      }
      return { status: 201, body: { requestId, note: mapNote(row) } };
    }),
  );

  router.get("/v1/notes/:noteId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const noteId = pathUuid(match.params.noteId ?? "");
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      // Defence in depth (AD-5): explicit membership check before the lookup.
      await requireNoteMember(client, noteId);
      const result = await client.query<NoteRow>(`SELECT ${NOTE_COLUMNS}, created_at::text AS created_at_text FROM app.notes WHERE id = $1`, [noteId]);
      const row = result.rows[0];
      if (row === undefined) {
        throw notFound("the note does not exist");
      }
      return { body: { requestId, note: mapNote(row) } };
    }),
  );

  router.patch("/v1/notes/:noteId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const noteId = pathUuid(match.params.noteId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "noteId", "changes"], [
        "requestId",
        "noteId",
        "changes",
      ]);
      const requestId = requiredRequestId(envelope);
      context.useRequestId(requestId);
      if (uuidField(envelope, "noteId", "noteId", []) !== noteId) {
        throw validationFailed(["noteId"]);
      }
      const changes = parseNoteChanges(envelope.changes);
      const existing = await client.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM app.notes WHERE id = $1",
        [noteId],
      );
      const note = existing.rows[0];
      if (note === undefined) {
        throw notFound("the note does not exist");
      }
      await requireWorkspaceWriter(client, note.workspace_id);
      const result = await client.query<NoteRow>(
        `UPDATE app.notes SET title = $2, updated_at = now() WHERE id = $1 RETURNING ${NOTE_COLUMNS}`,
        [noteId, changes.title],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw notFound("the note does not exist");
      }
      return { body: { requestId, note: mapNote(row) } };
    }),
  );

  router.delete("/v1/notes/:noteId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const noteId = pathUuid(match.params.noteId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "noteId"], [
        "requestId",
        "noteId",
      ]);
      const requestId = requiredRequestId(envelope);
      if (uuidField(envelope, "noteId", "noteId", []) !== noteId) {
        throw validationFailed(["noteId"]);
      }
      const existing = await client.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM app.notes WHERE id = $1",
        [noteId],
      );
      const note = existing.rows[0];
      if (note === undefined) {
        throw notFound("the note does not exist");
      }
      await requireWorkspaceWriter(client, note.workspace_id);
      let result: QueryResult<{ id: string }>;
      try {
        result = await client.query<{ id: string }>("DELETE FROM app.notes WHERE id = $1 RETURNING id", [noteId]);
      } catch (error) {
        if (sqlStateOf(error) === "23503") {
          throw conflict("the note is still placed on a board");
        }
        throw error;
      }
      if (result.rows[0] === undefined) {
        throw notFound("the note does not exist");
      }
      return { body: { requestId, deletedId: noteId } };
    }),
  );
}
