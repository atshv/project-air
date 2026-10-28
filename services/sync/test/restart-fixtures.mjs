// P5-06 test fixtures: a deterministic fake BoardDocument used by the restart
// harness (encoded updates are JSON op arrays; snapshots expose one card per
// applied operation so acked operations are visible in the board content).
export const NOTE_ID = "0192f0a4-7000-7000-8000-000000000004";
export function boardContent(boardId) {
  return {
    contractVersion: "0.3.0",
    board: { id: boardId, workspaceId: "0192f0a2-7000-7000-8000-000000000002", ownerId: "0192f0a1-7000-7000-8000-000000000001", title: "Restart board", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:30:00.000Z" },
    zones: [], blocks: [], notes: [], edges: [], cards: [],
  };
}
export function createFakeDocuments() {
  return {
    fromContent(content) { return makeDocument(content.cards.map((card) => ({ id: card.id }))); },
    fromEmpty() { return makeDocument([]); },
  };
}
function makeDocument(initial) {
  // Updates are full-state updates (like Yjs encodeStateAsUpdate): applying a
  // later update replaces earlier entries by id, so replay is idempotent.
  const ops = new Map(initial.map((entry) => [entry.id, { id: entry.id }]));
  const doc = {
    apply(operation) { ops.set(String(operation.id ?? ""), { id: String(operation.id ?? "") }); },
    encodeUpdate() { return Buffer.from(JSON.stringify([...ops.values()])).toString("base64"); },
    applyUpdate(update) {
      for (const op of JSON.parse(Buffer.from(update, "base64").toString())) ops.set(op.id, op);
    },
    stateVector() { return "state"; },
    snapshot() {
      const content = boardContent("0192f0f7-7000-7000-8000-000000000001");
      content.cards = [...ops.values()].map((op) => ({
        id: op.id, boardId: content.board.id, noteId: NOTE_ID,
        x: 0, y: 0, width: 176, height: 80, z: "a",
        createdAt: "2027-01-10T09:30:00.000Z", updatedAt: "2027-01-10T09:30:00.000Z",
      }));
      return content;
    },
  };
  return doc;
}
