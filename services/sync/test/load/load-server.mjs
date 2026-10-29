// P5-08 load-run test service (child process): real sync service with the real
// PgSyncStore on the slot port/DB. The SDK load harness lives in packages/sdk/test
// (the SDK may import crdt; services/sync may not import the SDK).
import fs from "node:fs";
import pg from "pg";

import { createYjsBoardDoc } from "../../../../packages/crdt/dist/packages/crdt/src/index.js";
import { createSyncService } from "../../src/service.ts";
import { PgSyncStore } from "../../src/store.ts";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const SLOT = JSON.parse(fs.readFileSync(`${ROOT}.polier-slot`, "utf8"));
const DATABASE_URL = `postgresql://${process.env.PGUSER ?? "projectair"}:${process.env.PGPASSWORD ?? "projectair_local_only"}@${process.env.PGHOST ?? "127.0.0.1"}:${process.env.PGPORT ?? "5433"}/${SLOT.db_name}`;
const BOARD_ID = "0192f0f9-7000-7000-8000-0000000000b1";
const EMPTY = { contractVersion: "0.4.0", board: { id: BOARD_ID, workspaceId: "0192f0f9-7000-7000-8000-000000000002", ownerId: "0192f0f9-7000-7000-8000-000000000003", title: "Load board", visibility: "private", archived: false, createdAt: "2027-01-10T09:00:00.000Z", updatedAt: "2027-01-10T09:00:00.000Z" }, zones: [], blocks: [], cards: [], notes: [], edges: [] };
const cleanup = new pg.Client({ connectionString: DATABASE_URL });
await cleanup.connect();
const clear = async () => {
  await cleanup.query("DELETE FROM sync_updates WHERE board_id = $1", [BOARD_ID]).catch(() => undefined);
  await cleanup.query("DELETE FROM sync_snapshots WHERE board_id = $1", [BOARD_ID]).catch(() => undefined);
};
await clear();
const store = new PgSyncStore({ connectionString: DATABASE_URL });
const service = await createSyncService({
  host: "127.0.0.1", port: 0,
  authenticator: { authenticate: async (token) => (token === "test-token-ref" ? { userId: "0192f0f9-7000-7000-8000-0000000000a3" } : null) },
  authorizer: { canJoin: async () => true },
  store,
  documents: { fromContent: (content) => createYjsBoardDoc({ content }), fromEmpty: () => createYjsBoardDoc({ content: EMPTY }) },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});
process.stdout.write(`load-server ready ${service.port}\n`);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await service.close().catch(() => undefined);
  const rows = await cleanup.query("SELECT count(*)::int AS n FROM sync_updates WHERE board_id = $1", [BOARD_ID]).catch(() => ({ rows: [{ n: 0 }] }));
  process.stdout.write(`load-server rows=${rows.rows[0].n}\n`);
  await clear().catch(() => undefined);
  await cleanup.end().catch(() => undefined);
  await store.close().catch(() => undefined);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
