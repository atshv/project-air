// P5-06 test fixtures: a deterministic fake BoardDocument used by the restart
// harness (encoded updates are a JSON state object; snapshots expose one card per
// applied operation so acked operations are visible in the board content). P6-08
// adds the note state (createNote + updateNoteBody) so a body operation survives
// the restart/compaction path like every other acked operation. P6-13 adds a
// zone (createZone + updateZone) and a checklist block (createBlock +
// updateBlockContent) for the contract 0.5.0 operations.
import { derivePlainText } from "../../../packages/contracts/plaintext.mjs";

export const NOTE_ID = "0192f0a4-7000-7000-8000-000000000004";
const TIMESTAMP = "2027-01-10T09:30:00.000Z";

export function boardContent(boardId) {
  return {
    contractVersion: "0.5.0",
    board: { id: boardId, workspaceId: "0192f0a2-7000-7000-8000-000000000002", ownerId: "0192f0a1-7000-7000-8000-000000000001", title: "Restart board", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:30:00.000Z" },
    zones: [], blocks: [], notes: [], edges: [], cards: [],
  };
}

export function createFakeDocuments() {
  return {
    fromContent(content) {
      return makeDocument(content.cards.map((card) => ({ id: card.id })), content.notes ?? [], content.zones ?? [], content.blocks ?? []);
    },
    fromEmpty() { return makeDocument([], [], [], []); },
  };
}

function makeDocument(initialCards, initialNotes, initialZones, initialBlocks) {
  // Updates are full-state updates (like Yjs encodeStateAsUpdate): applying a
  // later update replaces earlier entries by id, so replay is idempotent.
  const ops = new Map(initialCards.map((entry) => [entry.id, { id: entry.id }]));
  const notes = new Map(initialNotes.map((note) => [note.id, note]));
  const zones = new Map(initialZones.map((zone) => [zone.id, zone]));
  const blocks = new Map(initialBlocks.map((block) => [block.id, block]));
  const doc = {
    apply(operation) {
      ops.set(String(operation.id ?? ""), { id: String(operation.id ?? "") });
      const payload = operation.payload ?? {};
      if (operation.type === "createNote" && payload.note !== undefined) {
        notes.set(payload.note.id, payload.note);
      } else if (operation.type === "updateNoteBody") {
        const note = notes.get(payload.noteId);
        if (note !== undefined) notes.set(note.id, { ...note, body: payload.body, plainText: derivePlainText(payload.body) });
      } else if (operation.type === "createZone") {
        zones.set(payload.zone.id, payload.zone);
      } else if (operation.type === "updateZone") {
        const zone = zones.get(payload.zoneId);
        if (zone !== undefined) zones.set(zone.id, { ...zone, title: payload.title });
      } else if (operation.type === "createBlock") {
        blocks.set(payload.block.id, payload.block);
      } else if (operation.type === "updateBlockContent") {
        const block = blocks.get(payload.blockId);
        if (block !== undefined) blocks.set(block.id, { ...block, content: payload.content });
      }
    },
    encodeUpdate() {
      return Buffer.from(JSON.stringify({ cards: [...ops.values()], notes: [...notes.values()], zones: [...zones.values()], blocks: [...blocks.values()] })).toString("base64");
    },
    applyUpdate(update) {
      const state = JSON.parse(Buffer.from(update, "base64").toString());
      for (const card of state.cards ?? []) ops.set(card.id, card);
      for (const note of state.notes ?? []) notes.set(note.id, note);
      for (const zone of state.zones ?? []) zones.set(zone.id, zone);
      for (const block of state.blocks ?? []) blocks.set(block.id, block);
    },
    stateVector() { return "state"; },
    snapshot() {
      const content = boardContent("0192f0f7-7000-7000-8000-000000000001");
      content.cards = [...ops.values()].map((op) => ({
        id: op.id, boardId: content.board.id, noteId: NOTE_ID,
        x: 0, y: 0, width: 176, height: 80, z: "a",
        createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
      }));
      content.notes = [...notes.values()];
      content.zones = [...zones.values()];
      content.blocks = [...blocks.values()];
      return content;
    },
  };
  return doc;
}
