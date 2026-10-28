import assert from "node:assert/strict";
import test from "node:test";

import { BOARD_TITLE_MAX, formatUpdatedAt, normalizeTitle, readStoredWorkspaceId, selectWorkspace, sortBoards, validateBoardTitle, validateWorkspaceName, WORKSPACE_STORAGE_KEY } from "../src/boards/helpers.ts";

test("board titles are trimmed, non-empty and at most 120 characters", () => {
  assert.equal(normalizeTitle("  Notes  "), "Notes");
  assert.equal(validateBoardTitle("Notes"), null);
  assert.equal(validateBoardTitle("   "), "boards.validation.titleEmpty");
  assert.equal(validateBoardTitle("x".repeat(BOARD_TITLE_MAX + 1)), "boards.validation.titleTooLong");
  assert.equal(validateWorkspaceName(" "), "boards.validation.workspaceNameEmpty");
});

test("boards sort by updatedAt descending without mutating the input", () => {
  const boards = [{ id: "a", updatedAt: "2026-01-01T10:00:00Z" }, { id: "b", updatedAt: "2026-02-01T10:00:00Z" }, { id: "c", updatedAt: "invalid" }];
  assert.deepEqual(sortBoards(boards).map((board) => board.id), ["b", "a", "c"]);
  assert.deepEqual(boards.map((board) => board.id), ["a", "b", "c"]);
});

test("dates format with Intl for the active language and invalid dates are empty", () => {
  assert.notEqual(formatUpdatedAt("2026-02-01T10:00:00Z", "de"), "");
  assert.notEqual(formatUpdatedAt("2026-02-01T10:00:00Z", "en"), "");
  assert.equal(formatUpdatedAt("not a date", "en"), "");
});

test("workspace selection uses the stored id when present, otherwise the first workspace", () => {
  const workspaces = [{ id: "w1", name: "One" }, { id: "w2", name: "Two" }];
  assert.equal(selectWorkspace(workspaces, "w2")?.id, "w2");
  assert.equal(selectWorkspace(workspaces, "missing")?.id, "w1");
  assert.equal(selectWorkspace([], "w1"), null);
  const values = new Map();
  const read = readStoredWorkspaceId({ getItem: (key) => values.get(key) ?? null });
  assert.equal(read, null);
  values.set(WORKSPACE_STORAGE_KEY, "w2");
  assert.equal(readStoredWorkspaceId({ getItem: (key) => values.get(key) ?? null }), "w2");
});
