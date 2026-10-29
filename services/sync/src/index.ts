// P5-03: sync service entry point. Production adapters (auth/platform HTTP and
// the PostgreSQL update log) are wired here; the service factory is shared with
// the live integration test, so production and tests run the same socket path.

import type { BoardContent } from "./types.ts";
import { loadSyncConfig } from "./config.ts";
import { createLogger } from "./log.ts";
import { PgSyncStore } from "./store.ts";
import { createSessionAdapters } from "./session-auth.ts";
import { createSyncService } from "./service.ts";

const config = (() => {
  try {
    return loadSyncConfig();
  } catch (error) {
    process.stderr.write(`sync config: ${(error as Error).message}\n`);
    process.exit(2);
  }
})();
const logger = createLogger(config.logLevel);
const store = new PgSyncStore({ connectionString: config.databaseUrl });

const emptyBoardContent = (): BoardContent => ({
  contractVersion: "0.4.0",
  board: {
    id: "00000000-0000-7000-8000-000000000000", workspaceId: "", ownerId: "", title: "",
    visibility: "private", archived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
  },
  zones: [], blocks: [], cards: [], notes: [], edges: [],
});

// The CRDT core comes from its built package; Yjs stays inside packages/crdt.
// The build output of packages/crdt is `dist/packages/crdt/src/index.js` (the
// package's `main`/`exports` target), relative to this file at
// services/sync/dist/index.js. Resolve exactly that path: the old
// `dist/index.js` guess made a real `node dist/index.js` start fail.
// A path held in a variable keeps tsc from resolving the build output at typecheck time.
const crdtEntry = "../../../packages/crdt/dist/packages/crdt/src/index.js";
const crdt: unknown = await import(crdtEntry);
const createYjsBoardDoc = (crdt as { createYjsBoardDoc: (options: { content: BoardContent }) => never }).createYjsBoardDoc;
const documents = {
  fromContent: (content: BoardContent) => createYjsBoardDoc({ content }),
  fromEmpty: () => createYjsBoardDoc({ content: emptyBoardContent() }),
};

// P6-09: the browser session cookie from the WebSocket upgrade is validated
// through the auth service and the board is authorised through the platform with
// the same credentials; a hello tokenRef stays the test/non-browser path.
const { authenticator, authorizer } = createSessionAdapters({
  authServiceUrl: config.authServiceUrl,
  platformServiceUrl: config.platformServiceUrl,
});

const service = await createSyncService({
  host: config.host,
  port: config.port,
  authenticator,
  authorizer,
  store,
  documents,
  logger,
});

let stopping = false;
const shutdown = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  logger.info("sync.shutdown", { signal });
  void service.close().finally(() => { void store.close().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
