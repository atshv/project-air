/**
 * Row types of the application schema and their contract entity mapping.
 */

export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly owner_account_id: string;
  readonly created_at: Date;
  readonly created_at_text: string;
  readonly updated_at: Date;
}

export interface BoardRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly owner_account_id: string;
  readonly title: string;
  readonly visibility: "private" | "workspace" | "link";
  readonly archived: boolean;
  readonly created_at: Date;
  readonly created_at_text: string;
  readonly updated_at: Date;
}

export interface NoteRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly title: string;
  readonly created_at: Date;
  readonly created_at_text: string;
  readonly updated_at: Date;
}

export interface CardRow {
  readonly id: string;
  readonly board_id: string;
  readonly note_id: string;
  readonly zone_id: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: string;
  readonly created_at: Date;
  readonly created_at_text: string;
  readonly updated_at: Date;
}

export interface WorkspaceEntity {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BoardEntity {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly visibility: "private" | "workspace" | "link";
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NoteEntity {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CardEntity {
  readonly id: string;
  readonly boardId: string;
  readonly noteId: string;
  readonly zoneId: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const WORKSPACE_COLUMNS =
  "id, name, owner_account_id, created_at, updated_at";
export const BOARD_COLUMNS =
  "id, workspace_id, owner_account_id, title, visibility, archived, created_at, updated_at";
export const NOTE_COLUMNS = "id, workspace_id, title, created_at, updated_at";
export const CARD_COLUMNS =
  "id, board_id, note_id, zone_id, x, y, width, height, z, created_at, updated_at";

export function mapWorkspace(row: WorkspaceRow): WorkspaceEntity {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_account_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function mapBoard(row: BoardRow): BoardEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_account_id,
    title: row.title,
    visibility: row.visibility,
    archived: row.archived,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function mapNote(row: NoteRow): NoteEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function mapCard(row: CardRow): CardEntity {
  return {
    id: row.id,
    boardId: row.board_id,
    noteId: row.note_id,
    zoneId: row.zone_id,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    z: row.z,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
