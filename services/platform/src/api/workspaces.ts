/**
 * `/v1/workspaces` routes.
 *
 * Read = any member, workspace update = owner/editor, workspace delete = owner;
 * a non-member always receives NOT_FOUND (no existence leak).
 */

import { forbidden, notFound, validationFailed } from "../http/errors.ts";
import { createUuid } from "../http/request-id.ts";
import type { Router } from "../http/router.ts";
import { withAuthenticatedRequest, type ApiDependencies } from "./context.ts";
import { mapWorkspace, WORKSPACE_COLUMNS, type WorkspaceRow } from "./entities.ts";
import { encodeCursor, parsePageQuery, requestIdFromQuery, runPageQuery } from "./pagination.ts";
import { requireWorkspaceMember, requireWorkspaceOwner, requireWorkspaceWriter } from "./permissions.ts";
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

interface WorkspaceCreate {
  readonly name: string;
  readonly ownerId: string;
}

interface WorkspaceChanges {
  readonly name: string;
}

function parseWorkspaceCreate(input: unknown): WorkspaceCreate {
  if (!isRecord(input)) {
    throw validationFailed(["workspace"]);
  }
  const fields: FieldList = [];
  hasOnlyKeys(input, ["name", "ownerId"], "workspace.", fields);
  const name = stringField(input, "name", "workspace.name", 1, 120, fields);
  const ownerId = uuidField(input, "ownerId", "workspace.ownerId", fields);
  requireValid(fields);
  if (name === undefined || ownerId === undefined) {
    throw validationFailed(["workspace"]);
  }
  return { name, ownerId };
}

function parseWorkspaceChanges(input: unknown): WorkspaceChanges {
  if (!isRecord(input)) {
    throw validationFailed(["changes"]);
  }
  if (Object.keys(input).length === 0) {
    throw validationFailed(["changes"]);
  }
  const fields: FieldList = [];
  hasOnlyKeys(input, ["name"], "changes.", fields);
  const name = stringField(input, "name", "changes.name", 1, 120, fields);
  requireValid(fields);
  if (name === undefined) {
    throw validationFailed(["changes.name"]);
  }
  return { name };
}

export function registerWorkspaceRoutes(router: Router, dependencies: ApiDependencies): void {
  router.get("/v1/workspaces", (context) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      const page = parsePageQuery(context.query);
      // Defence in depth (AD-5): the list carries its own membership predicate.
      const result = await runPageQuery<WorkspaceRow>(
        client,
        page.cursor,
        `SELECT ${WORKSPACE_COLUMNS}, created_at::text AS created_at_text
         FROM app.workspaces
         WHERE app.is_workspace_member(id)
           AND ($1::timestamptz IS NULL OR (created_at, id) > ($1::timestamptz, $2::uuid))
         ORDER BY created_at, id
         LIMIT $3`,
        [page.cursor?.createdAt ?? null, page.cursor?.id ?? null, page.limit + 1],
      );
      const hasMore = result.rows.length > page.limit;
      const rows = hasMore ? result.rows.slice(0, page.limit) : result.rows;
      const last = rows.at(-1);
      return {
        body: {
          requestId,
          items: rows.map(mapWorkspace),
          nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at_text, last.id) : null,
        },
      };
    }),
  );

  router.post("/v1/workspaces", (context) =>
    withAuthenticatedRequest(dependencies, context, async ({ client, user }) => {
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "workspace"], [
        "requestId",
        "workspace",
      ]);
      const requestId = requiredRequestId(envelope);
      context.useRequestId(requestId);
      const workspace = parseWorkspaceCreate(envelope.workspace);
      if (workspace.ownerId !== user.accountId) {
        throw forbidden("a workspace must be owned by the current account");
      }
      const result = await client.query<WorkspaceRow>(
        `INSERT INTO app.workspaces (id, name, owner_account_id)
         VALUES ($1, $2, $3)
         RETURNING ${WORKSPACE_COLUMNS}`,
        [createUuid(), workspace.name, workspace.ownerId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw validationFailed(["workspace"]);
      }
      return { status: 201, body: { requestId, workspace: mapWorkspace(row) } };
    }),
  );

  router.get("/v1/workspaces/:workspaceId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const workspaceId = pathUuid(match.params.workspaceId ?? "");
      const requestId = requestIdFromQuery(context.query, context.requestId);
      context.useRequestId(requestId);
      // Defence in depth (AD-5): explicit membership check before the lookup.
      await requireWorkspaceMember(client, workspaceId);
      const result = await client.query<WorkspaceRow>(
        `SELECT ${WORKSPACE_COLUMNS}, created_at::text AS created_at_text FROM app.workspaces WHERE id = $1`,
        [workspaceId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw notFound("the workspace does not exist");
      }
      return { body: { requestId, workspace: mapWorkspace(row) } };
    }),
  );

  router.patch("/v1/workspaces/:workspaceId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const workspaceId = pathUuid(match.params.workspaceId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "workspaceId", "changes"], [
        "requestId",
        "workspaceId",
        "changes",
      ]);
      const requestId = requiredRequestId(envelope);
      context.useRequestId(requestId);
      if (uuidField(envelope, "workspaceId", "workspaceId", []) !== workspaceId) {
        throw validationFailed(["workspaceId"]);
      }
      const changes = parseWorkspaceChanges(envelope.changes);
      await requireWorkspaceWriter(client, workspaceId);
      const result = await client.query<WorkspaceRow>(
        `UPDATE app.workspaces SET name = $2, updated_at = now() WHERE id = $1 RETURNING ${WORKSPACE_COLUMNS}`,
        [workspaceId, changes.name],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw notFound("the workspace does not exist");
      }
      return { body: { requestId, workspace: mapWorkspace(row) } };
    }),
  );

  router.delete("/v1/workspaces/:workspaceId", (context, match) =>
    withAuthenticatedRequest(dependencies, context, async ({ client }) => {
      const workspaceId = pathUuid(match.params.workspaceId ?? "");
      const envelope = parseEnvelope(await context.readJson(), "", ["requestId", "workspaceId"], [
        "requestId",
        "workspaceId",
      ]);
      const requestId = requiredRequestId(envelope);
      if (uuidField(envelope, "workspaceId", "workspaceId", []) !== workspaceId) {
        throw validationFailed(["workspaceId"]);
      }
      await requireWorkspaceOwner(client, workspaceId);
      const result = await client.query<{ id: string }>(
        "DELETE FROM app.workspaces WHERE id = $1 RETURNING id",
        [workspaceId],
      );
      if (result.rows[0] === undefined) {
        throw notFound("the workspace does not exist");
      }
      return { body: { requestId, deletedId: workspaceId } };
    }),
  );
}
