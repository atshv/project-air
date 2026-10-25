/**
 * SDK half of the backend-core acceptance (P3-05).
 *
 * The orchestrator `tools/dev/acceptance-backend.mjs` resets/migrates the slot
 * database and boots `services/auth` (test mode) + `services/platform`; this
 * script then drives the platform only through `@project-air/sdk`:
 *
 * 1. account A by test session,
 * 2. workspace, board, note and card through the SDK,
 * 3. list and get them back,
 * 4. account B sees empty lists and NOT_FOUND on every resource of A.
 *
 * Arguments via environment: ACCEPTANCE_PLATFORM_URL, ACCEPTANCE_AUTH_URL.
 * Exit 0 on success, 1 on a failed assertion, 2 when the environment is missing.
 */

import { ApiError, createClient, createRequestId } from "../src/index.ts";

const platformUrl = process.env.ACCEPTANCE_PLATFORM_URL;
const authUrl = process.env.ACCEPTANCE_AUTH_URL;

if (platformUrl === undefined || authUrl === undefined) {
  console.error("acceptance: ACCEPTANCE_PLATFORM_URL and ACCEPTANCE_AUTH_URL are required");
  process.exit(2);
}

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`PASS: ${message}`);
    return;
  }
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function checkEqual(actual, expected, message) {
  check(actual === expected, `${message} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

async function mintSession(accountId) {
  const response = await fetch(`${authUrl}/test/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  if (response.status !== 201) {
    throw new Error(`could not mint a test session: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  const session = body?.data?.session;
  if (typeof session !== "string" || session === "") {
    throw new Error("the auth service returned no test session");
  }
  return session;
}

async function expectNotFound(promise, label) {
  try {
    await promise;
    check(false, `${label} is NOT_FOUND for the foreign account`);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND" && error.messageKey === "errors.notFound") {
      check(true, `${label} is NOT_FOUND for the foreign account`);
      return;
    }
    throw error;
  }
}

async function main() {
  console.log("P3-05 backend-core acceptance (SDK against the real platform + auth)");
  console.log(`date: ${new Date().toISOString()}`);
  console.log(`platform: ${platformUrl}`);
  console.log(`auth: ${authUrl}`);
  console.log();

  const accountA = createRequestId();
  const accountB = createRequestId();
  const sessionA = await mintSession(accountA);
  const sessionB = await mintSession(accountB);
  const apiA = createClient({ baseUrl: platformUrl, session: { testSession: sessionA } });
  const apiB = createClient({ baseUrl: platformUrl, session: { testSession: sessionB } });
  console.log("== 1. two accounts created through the auth test-session mode ==");
  check(accountA !== accountB, "accounts A and B have distinct UUIDv7 ids");
  console.log();

  console.log("== 2. account A creates workspace, board, note and card through the SDK ==");
  const workspace = await apiA.workspaces.create({ name: "Acceptance workspace", ownerId: accountA });
  checkEqual(workspace.ownerId, accountA, "the workspace is owned by account A");
  const board = await apiA.boards.create(workspace.id, {
    ownerId: accountA,
    title: "Acceptance board",
    visibility: "workspace",
  });
  checkEqual(board.workspaceId, workspace.id, "the board belongs to the workspace");
  const note = await apiA.notes.create(workspace.id, { title: "Acceptance note" });
  checkEqual(note.workspaceId, workspace.id, "the note belongs to the workspace");
  const card = await apiA.cards.create(board.id, {
    noteId: note.id,
    zoneId: null,
    x: 10,
    y: 20,
    width: 240,
    height: 120,
    z: "a0",
  });
  checkEqual(card.noteId, note.id, "the card references the note");
  console.log();

  console.log("== 3. account A lists and reads the resources back ==");
  const workspaces = await apiA.workspaces.list();
  check(
    workspaces.items.some((candidate) => candidate.id === workspace.id),
    "the workspace appears in account A's workspace list",
  );
  const boards = await apiA.boards.list(workspace.id);
  check(boards.items.some((candidate) => candidate.id === board.id), "the board appears in the board list");
  const notes = await apiA.notes.list(workspace.id);
  check(notes.items.some((candidate) => candidate.id === note.id), "the note appears in the note list");
  const cards = await apiA.cards.list(board.id);
  check(cards.items.some((candidate) => candidate.id === card.id), "the card appears in the card list");
  checkEqual((await apiA.workspaces.get(workspace.id)).id, workspace.id, "workspace get returns the workspace");
  checkEqual((await apiA.boards.get(board.id)).id, board.id, "board get returns the board");
  checkEqual((await apiA.notes.get(note.id)).id, note.id, "note get returns the note");
  checkEqual((await apiA.cards.get(card.id)).id, card.id, "card get returns the card");
  console.log();

  console.log("== 4. account B sees nothing of account A ==");
  const foreignWorkspaces = await apiB.workspaces.list();
  checkEqual(foreignWorkspaces.items.length, 0, "account B's workspace list is empty");
  await expectNotFound(apiB.workspaces.get(workspace.id), "workspace get");
  await expectNotFound(apiB.boards.get(board.id), "board get");
  await expectNotFound(apiB.notes.get(note.id), "note get");
  await expectNotFound(apiB.cards.get(card.id), "card get");
  await expectNotFound(apiB.boards.list(workspace.id), "board list under a foreign workspace");
  await expectNotFound(apiB.notes.list(workspace.id), "note list under a foreign workspace");
  await expectNotFound(apiB.cards.list(board.id), "card list under a foreign board");
  console.log();

  console.log("== 5. cleanup through the SDK (account A deletes its resources) ==");
  checkEqual((await apiA.cards.delete(card.id)).deletedId, card.id, "card deleted");
  checkEqual((await apiA.notes.delete(note.id)).deletedId, note.id, "note deleted");
  checkEqual((await apiA.boards.delete(board.id)).deletedId, board.id, "board deleted");
  checkEqual((await apiA.workspaces.delete(workspace.id)).deletedId, workspace.id, "workspace deleted");
  checkEqual((await apiA.workspaces.list()).items.length, 0, "account A's workspace list is empty again");
  console.log();

  if (failures > 0) {
    console.error(`SDK acceptance FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("PASS SDK acceptance");
  process.exit(0);
}

main().catch((error) => {
  console.error(`acceptance: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
