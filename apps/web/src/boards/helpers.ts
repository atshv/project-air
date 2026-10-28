// P6-03: pure helpers of the boards start page (title validation, ordering,
// Intl date formatting, workspace selection persistence), tested with node --test.
import type { Board, Workspace } from "../../../../packages/sdk/src/types.ts"; // type-only

export const BOARD_TITLE_MAX = 120;
export const WORKSPACE_NAME_MAX = 120;
export const WORKSPACE_STORAGE_KEY = "project-air.workspaceId";
export type FieldErrors = Readonly<Record<string, string>>;

export function validateBoardTitle(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "boards.validation.titleEmpty";
  if (trimmed.length > BOARD_TITLE_MAX) return "boards.validation.titleTooLong";
  return null;
}

export function validateWorkspaceName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "boards.validation.workspaceNameEmpty";
  if (trimmed.length > WORKSPACE_NAME_MAX) return "boards.validation.workspaceNameTooLong";
  return null;
}

export function normalizeTitle(value: string): string { return value.trim(); }

export function sortBoards(boards: readonly Board[]): Board[] {
  return [...boards].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt); const rightTime = Date.parse(right.updatedAt);
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

export function formatUpdatedAt(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try { return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date); }
  catch { return new Intl.DateTimeFormat("de", { dateStyle: "medium", timeStyle: "short" }).format(date); }
}

export function readStoredWorkspaceId(storage: { getItem(key: string): string | null } | null | undefined): string | null {
  try { return storage?.getItem(WORKSPACE_STORAGE_KEY) ?? null; } catch { return null; }
}

export function persistWorkspaceId(storage: { setItem(key: string, value: string): void } | null | undefined, workspaceId: string): void {
  try { storage?.setItem(WORKSPACE_STORAGE_KEY, workspaceId); } catch { /* storage unavailable */ }
}

export function selectWorkspace(workspaces: readonly Workspace[], storedId: string | null): Workspace | null {
  if (workspaces.length === 0) return null;
  const stored = storedId === null ? undefined : workspaces.find((workspace) => workspace.id === storedId);
  return stored ?? workspaces[0] ?? null;
}

export function visibilityKey(visibility: Board["visibility"]): string {
  return `boards.visibility.${visibility}`;
}

export function titleErrors(value: string): FieldErrors {
  const key = validateBoardTitle(value);
  return key === null ? {} : { title: key };
}

export function workspaceNameErrors(value: string): FieldErrors {
  const key = validateWorkspaceName(value);
  return key === null ? {} : { name: key };
}
