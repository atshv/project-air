// P5-06 restart harness child: the real sync service on the slot port with the
// slot PostgreSQL, fake auth/authorizer and the deterministic fake document.
// SIGTERM triggers the graceful shutdown path (no ack after stop started,
// retryable 1012 close, store closed).
import { loadSyncConfig } from "../src/config.ts";
import { createSyncService } from "../src/service.ts";
import { PgSyncStore } from "../src/store.ts";
import { createLogger } from "../src/log.ts";
import { createFakeDocuments } from "./restart-fixtures.mjs";

const config = loadSyncConfig();
const logger = createLogger(config.logLevel, (line) => process.stdout.write(line + "\n"));
const store = new PgSyncStore({ connectionString: config.databaseUrl });
const service = await createSyncService({
  host: config.host,
  port: config.port,
  authenticator: { authenticate: async (tokenRef) => (tokenRef === "test-token-ref" ? { userId: "0192f0f6-7000-7000-8000-000000000001" } : null) },
  authorizer: { canJoin: async () => true },
  store,
  documents: createFakeDocuments(),
  logger,
});
process.stdout.write(`restart-server ready ${service.port}\n`);
let stopping = false;
const shutdown = async (signal) => {
  if (stopping) return;
  stopping = true;
  logger.info("restart-server.shutdown", { signal });
  await service.close();
  await store.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
