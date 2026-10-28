// P5-03: sync service entry point. Production adapters (auth/platform HTTP and
// the PostgreSQL update log) are wired here; the service factory is shared with
// the live integration test, so production and tests run the same socket path.

import type { BoardContent } from "./types.ts";
import { loadSyncConfig } from "./config.ts";
import { createLogger } from "./log.ts";
import { PgSyncStore } from "./store.ts";
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
  contractVersion: "0.3.0",
  board: {
    id: "00000000-0000-7000-8000-000000000000", workspaceId: "", ownerId: "", title: "",
    visibility: "private", archived: false, createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
  },
  zones: [], blocks: [], cards: [], notes: [], edges: [],
});

// The CRDT core comes from its built package; Yjs stays inside packages/crdt.
const crdt = await import("../../../packages/crdt/dist/index.js" as string);
const createYjsBoardDoc = (crdt as { createYjsBoardDoc: (options: { content: BoardContent }) => never }).createYjsBoardDoc;
const documents = {
  fromContent: (content: BoardContent) => createYjsBoardDoc({ content }) as never,
  fromEmpty: () => createYjsBoardDoc({ content: emptyBoardContent() }) as never,
};

async function authenticate(tokenRef: string): Promise<{ userId: string } | null> {
  const response = await fetch(`${config.authServiceUrl}/sessions/validate`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenRef }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { userId?: string };
  return typeof body.userId === "string" ? { userId: body.userId } : null;
}

async function canJoin(userId: string, boardId: string): Promise<boolean> {
  const response = await fetch(`${config.platformServiceUrl}/boards/${encodeURIComponent(boardId)}`, {
    headers: { "x-user-id": userId },
  });
  return response.ok;
}

const service = await createSyncService({
  host: config.host,
  port: config.port,
  authenticator: { authenticate },
  authorizer: { canJoin },
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
