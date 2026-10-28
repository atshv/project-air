# Realtime sync service (P5-03)

## Architecture

`services/sync` owns the WebSocket connection between a browser client and one
board. It follows the platform patterns: typed environment configuration
(`src/config.ts`, values from the slot/dev loop), structured secret-free JSON
logs (`src/log.ts`), a `GET /health` endpoint, graceful shutdown on
SIGTERM/SIGINT and a pinned `pg` pool. The WebSocket server is our own minimal
RFC 6455 implementation on `node:http` `upgrade` (`src/ws.ts`): handshake via
`node:crypto` SHA-1, masked client frames, fragmentation/continuation, ping/pong,
close frames, a 1 MiB inbound message bound and no extensions.

`src/protocol.ts` implements contract 0.3.0 session semantics on top of the
`packages/crdt` `BoardDoc` core; `src/store.ts` is the PostgreSQL update log.

## Protocol flow

1. The first client message must be `hello` (tokenRef + the once-per-connection
   `contractVersion`). Missing hello, a wrong version or a rejected session token
   produce a contract `reject` (`HELLO_REQUIRED`, `VERSION_MISMATCH`,
   `UNAUTHORIZED`) and the connection stays unauthenticated.
2. `joinBoard` is authorized against the platform board-access check through an
   injected `BoardAuthorizer` (the production adapter calls the platform
   service). Unauthorized boards produce `FORBIDDEN`.
3. On join the service reads the durable per-board `serverSeq` **from the
   database**, loads the latest snapshot (a fresh board has a baseline snapshot at
   `serverSeq = 1`) plus the update log after that snapshot's `serverSeq` through
   the `BoardDoc`, and sends `welcome`/`snapshot` with the **current document**
   and `snapshotRef = <boardId>:<current max serverSeq>` (1 for a fresh board).
4. `operationBatch` validates the payload, applies every operation through the
   `BoardDoc`, encodes the update, then appends it with the next per-board
   `serverSeq` (`max(updates, snapshots) + 1`, so the first batch after the
   baseline is 2) in one transaction. **The transaction commits before the `ack` is
   sent** (AD-2); a failed append produces `PERSISTENCE_FAILED` and never an
   ack. After the ack the batch is broadcast to the other clients of the board.
5. `resyncRequest` with `fromServerSeq` replays durable updates after that
   sequence (0 = empty catch-up, 1 = after the baseline) and answers with
   `welcome` + the current snapshot; a client that is current receives an empty
   catch-up. The minimal snapshot+replay recovery is the P5-06 starting point
   (P5-06 formalizes/compacts it); the initial board-content bootstrap from the
   platform is a P5-06/open point, the empty placeholder content is fine for now;
   `leaveBoard` returns to the unjoined state and broadcasts a presence stub.
6. Presence messages are a stub channel for P5-05.

## Durability and authorization proof

- The store interface allocates `serverSeq` in a transaction
  (`appendUpdate`) and the session awaits it before sending the `ack`; the tests
  fake the store, record the append/commit order and assert a failed append
  yields a reject without an ack (`test/protocol.test.mjs`).
- The authorizer and authenticator are injected interfaces; the tests fake them
  and prove hello-first, version rejection, session rejection and the
  `FORBIDDEN` board path. The production adapters call the auth and platform
  services with the platform session/headers; a real Kratos/platform session in
  a full stack is not exercised by this task's tests.

## Persistence

`infra/migrations/0006_sync_log.sql` creates `sync_updates` (PK board +
serverSeq, encoded update, client/message ids), `sync_snapshots` (PK board +
serverSeq, board-content JSON) and the catch-up indexes. Startup load/continue is
stubbed for P5-06; `serverSeq` is always read from the DB, never memory-only.

## Running

The dev loop provides the slot environment (`SYNC_PORT` = slot `sync` port,
`DATABASE_URL`, `AUTH_SERVICE_URL`, `PLATFORM_SERVICE_URL`); run
`pnpm --filter @project-air/sync build` then `pnpm --filter @project-air/sync
start`, or `bash tools/dev/setup`/`reset-db` for the slot database and
`node services/platform/dist/db/migrate.js` for the migrations.
