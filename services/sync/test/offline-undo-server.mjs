// P5-07 test-only child: the real sync service with an in-memory store and a
// JSON fake BoardDoc (no DB, no SDK import) for the SDK stack proof. The SDK
// stack test lives in packages/sdk (the SDK may import crdt; services/sync may
// not import the SDK/test-only direction).
import { createSyncService } from "../src/service.ts";
import { createLogger } from "../src/log.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FIXTURE = JSON.parse(readFileSync(`${ROOT}/packages/contracts/fixtures/board-content/valid.json`, "utf8")).data;
const clone = (value) => JSON.parse(JSON.stringify(value));

function makeDocument(initial) {
  const ops = new Map((initial ?? []).map((entry) => [entry.id, entry]));
  return {
    apply(operation) { ops.set(String(operation.id), operation); },
    encodeUpdate() { return Buffer.from(JSON.stringify([...ops.values()])).toString("base64"); },
    applyUpdate(update) { for (const op of JSON.parse(Buffer.from(update, "base64").toString())) ops.set(op.id, op); },
    stateVector() { return "state"; },
    snapshot() {
      const content = clone(FIXTURE);
      for (const op of ops.values()) {
        if (op.type === "moveCard") {
          const card = content.cards.find((entry) => entry.id === op.payload.cardId);
          if (card !== undefined) { card.x = op.payload.x; card.y = op.payload.y; }
        }
      }
      return content;
    },
  };
}
function fakeStore() {
  let seq = 1;
  const updates = [];
  return {
    async serverSeq() { return seq; },
    async loadBoard() { return { serverSeq: seq, snapshotSeq: 1, boardContent: clone(FIXTURE) }; },
    async appendUpdate(input) { seq += 1; updates.push({ serverSeq: seq, update: input.update }); return seq; },
    async updatesAfter(_board, from) { return updates.filter((entry) => entry.serverSeq > from); },
  };
}
const service = await createSyncService({
  host: "127.0.0.1", port: 0,
  authenticator: { authenticate: async (tokenRef) => (tokenRef === "test-token-ref" ? { userId: "0192f0fa-7000-7000-8000-0000000000a1" } : null) },
  authorizer: { canJoin: async () => true },
  store: fakeStore(),
  documents: { fromContent: (content) => makeDocument(content.cards ?? []), fromEmpty: () => makeDocument([]) },
  logger: createLogger("warn", () => undefined),
});
process.stdout.write(`offline-server ready ${service.port}\n`);
process.on("SIGTERM", () => { void service.close().then(() => process.exit(0)); });
process.on("SIGINT", () => { void service.close().then(() => process.exit(0)); });
