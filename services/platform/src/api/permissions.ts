/**
 * Permission checks for the resource routes.
 *
 * The database helpers (`app.is_workspace_member`, `app.can_write_workspace`,
 * `app.is_workspace_owner`, `app.is_board_member`, `app.can_write_board`) are
 * SECURITY DEFINER with a "current account" argument and return false for
 * missing and foreign rows alike, so a non-member always gets `NOT_FOUND`
 * (no existence leak) and a member without the role gets `FORBIDDEN`.
 */

import type { PoolClient } from "pg";

import { forbidden, notFound } from "../http/errors.ts";

export interface WorkspaceAccess {
  readonly member: boolean;
  readonly writer: boolean;
  readonly owner: boolean;
}

export interface BoardAccess {
  readonly member: boolean;
  readonly writer: boolean;
}

export async function workspaceAccess(client: PoolClient, workspaceId: string): Promise<WorkspaceAccess> {
  const result = await client.query<{ member: boolean; writer: boolean; owner: boolean }>(
    `SELECT app.is_workspace_member($1) AS member,
            app.can_write_workspace($1) AS writer,
            app.is_workspace_owner($1) AS owner`,
    [workspaceId],
  );
  const row = result.rows[0];
  return {
    member: row?.member === true,
    writer: row?.writer === true,
    owner: row?.owner === true,
  };
}

export async function boardAccess(client: PoolClient, boardId: string): Promise<BoardAccess> {
  const result = await client.query<{ member: boolean; writer: boolean }>(
    `SELECT app.is_board_member($1) AS member, app.can_write_board($1) AS writer`,
    [boardId],
  );
  const row = result.rows[0];
  return { member: row?.member === true, writer: row?.writer === true };
}

export async function requireWorkspaceMember(client: PoolClient, workspaceId: string): Promise<void> {
  const access = await workspaceAccess(client, workspaceId);
  if (!access.member) {
    throw notFound("the workspace does not exist");
  }
}

export async function requireWorkspaceWriter(client: PoolClient, workspaceId: string): Promise<void> {
  const access = await workspaceAccess(client, workspaceId);
  if (!access.member) {
    throw notFound("the workspace does not exist");
  }
  if (!access.writer) {
    throw forbidden("the owner or an editor may change this workspace");
  }
}

export async function requireWorkspaceOwner(client: PoolClient, workspaceId: string): Promise<void> {
  const access = await workspaceAccess(client, workspaceId);
  if (!access.member) {
    throw notFound("the workspace does not exist");
  }
  if (!access.owner) {
    throw forbidden("only the owner may change this workspace");
  }
}

export async function requireBoardMember(client: PoolClient, boardId: string): Promise<void> {
  const access = await boardAccess(client, boardId);
  if (!access.member) {
    throw notFound("the board does not exist");
  }
}

export async function requireBoardWriter(client: PoolClient, boardId: string): Promise<void> {
  const access = await boardAccess(client, boardId);
  if (!access.member) {
    throw notFound("the board does not exist");
  }
  if (!access.writer) {
    throw forbidden("the owner or an editor may change this board");
  }
}

/** The note must exist (RLS-scoped) and its workspace must have the caller as member. */
export async function requireNoteMember(client: PoolClient, noteId: string): Promise<void> {
  const result = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM app.notes WHERE id = $1", [
    noteId,
  ]);
  const note = result.rows[0];
  if (note === undefined) {
    throw notFound("the note does not exist");
  }
  const access = await workspaceAccess(client, note.workspace_id);
  if (!access.member) {
    throw notFound("the note does not exist");
  }
}

/** The card must exist (RLS-scoped) and the caller must be a member of its board workspace. */
export async function requireCardMember(client: PoolClient, cardId: string): Promise<void> {
  const result = await client.query<{ board_id: string }>("SELECT board_id FROM app.cards WHERE id = $1", [cardId]);
  const card = result.rows[0];
  if (card === undefined) {
    throw notFound("the card does not exist");
  }
  await requireBoardMember(client, card.board_id);
}
