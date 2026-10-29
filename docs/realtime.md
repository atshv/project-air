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

`src/protocol.ts` implements contract 0.4.0 session semantics on top of the
`packages/crdt` `BoardDoc` core; `src/store.ts` is the PostgreSQL update log.
Contract 0.4.0 note-body operations (`updateNoteBody`) are supported by the same generic log/replay path: a body batch is validated, persisted, acked, broadcast, replayed for catch-up and included (body + `plainText`) in a fresh join's snapshot.

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

## Client: the SDK board-sync client and the one autosave path (P5-04)

`packages/sdk` owns the client document and the sync boundary (ADR-0012). The
`createBoardSyncClient` factory holds one `BoardDoc` (created by an injected
factory; the SDK sees only the CRDT interface, never Yjs), takes an injected
WebSocket-like `SyncSocket` (browser/Node WebSocket in production, a fake pair in
tests), and requires an authenticated **UUIDv7 `clientId`**: the caller may pass
its session's client id, otherwise one is generated per client instance with the
SDK's `createRequestId()` (UUIDv7, stable across reconnects; contract 0.4.0 types
`clientId` as `$defs.uuid`). Every message and batch id is a fresh
`createRequestId()` UUIDv7, so two clients never collide. The client speaks
contract 0.4.0: hello first, joinBoard, snapshot install at its
`serverSeq`, catch-up from the durable sequence; local operations go out as
`operationBatch` with a per-connection `seq`; remote batches and acks are applied
through the `BoardDoc`, acks only move `serverSeq` forward, duplicate remote
batches are ignored, and a dropped socket reconnects with bounded exponential
backoff and sends `resyncRequest` from the last known `serverSeq`. `close()` is
idempotent and sends `leaveBoard` once. The offline operation queue is ordered and
flushes on join/reconnect; the client emits `status`/`snapshot`/`remote`/`error`
events.

The one autosave path of L05 is `createAutosave`: a 400 ms debounce after the
last keystroke, immediate flush on blur, panel close, navigation
(`beforeunload`/`pagehide`) and `visibilitychange` while hidden, monotonic save
sequences so an older response never overwrites a newer value, `saving` → `saved`
→ `error` status events, `retry()` for the error state and no second writer or
persistence in the SDK (the caller passes the one `save` function).
`installFlushTriggers` wires the five triggers to a window/document and an
optional panel-close registration.

## Presence (P5-05)

`presence` stays the existing contract 0.4.0 message — no new message type. The
client sends cursor/selection updates; the sync service validates the payload,
derives the identity server-side (participant identity = validated session user;
`nameRef` is `user:<userId>`, `colorRef` is a server-derived `tone-*` palette
reference), ignores/overwrites any client-sent name or colour, and throttles and
coalesces updates per connection (50 ms budget: the first update goes out
immediately, the newest update within a window is sent when the window closes).
Presence is broadcast only to the other clients joined to the same board; a
newcomer receives the current participant list as individual `presence` messages
(the contract has no list message), and `leaveBoard`, disconnect, close and
shutdown remove the participant and notify the others with a removal sentinel
(empty selection, cursor at the origin — the contract has no explicit leave
variant; documented open point). Presence is never persisted and never blocks
operation traffic: the priority test floods presence and still receives the
operation ack.

The SDK `createBoardSyncClient` owns the client side: `updatePresence()` throttles
outbound cursor/selection with the injected clock (coalescing to the newest
update), `participants()`/`onPresence()` expose a subscription with the remote
participants (server-derived name/colour), and the participant list is cleared on
leave, close, reconnect/snapshot and board switch. The SDK never persists
presence.

## Durability, recovery, catch-up and snapshot compaction (P5-06)

**Recovery.** The service reads the latest snapshot and replays the durable
`sync_updates` after that snapshot's `serverSeq` on join (and at start-up the
store is the source of truth). A fresh board has the baseline snapshot at
`serverSeq = 1`; after a restart the next `serverSeq` continues monotonically
from the durable maximum (updates and snapshots), and every acknowledged
operation is replayed from the log. `serverSeq` is never memory-only.

**Graceful shutdown.** `createSyncService().close()` sets the stopping flag
first (the protocol refuses to send any further `ack` once shutdown started,
even when the update already committed), stops accepting, closes the connected
sockets with the retryable `1012` "service restart" close code, and lets the
caller close the store after the connections are gone.

**Catch-up.** `resyncRequest`/`fromServerSeq` reads the durable log strictly
after the requested sequence, ordered ascending with no gap or duplicate: `0`
(or the previous snapshot) replays the whole log, `current` is an empty
catch-up, and intermediate values return exactly the missed rows. A reconnect
receives welcome+snapshot at the current `serverSeq` and, when the client is
current, an empty catch-up.

**Snapshot compaction.** Policy: threshold-based (default
`COMPACTION_MIN_UPDATES = 32` pending updates after the current snapshot; the
restart harness forces `minUpdates: 1`). `writeCompactedSnapshot` writes the
document snapshot at the current board `serverSeq` and prunes only updates
`<= snapshot.serverSeq` in **one transaction** under the per-board advisory
lock. The snapshot is written before the prune, so a crash between the two
leaves snapshot + older updates; replay-after-snapshot ignores the older rows and
the state stays consistent. Acknowledged updates are never lost (the snapshot is
at their sequence) and DB growth is bounded (the log is pruned). Compaction runs
against the DB outside a client session, so it does not block operation batches;
the restart harness proves a compacted restart reproduces exactly the
uncompacted snapshot.

## Stage 6 exit: load proof and handoff (P5-08)

The `load` gate is proven by `packages/sdk/test/load/run-load.mjs` (exclusive):
25 SDK `BoardSyncClient`s on one board against the real sync service and the
slot PostgreSQL, explicit seed-ack and quiescence barriers, 5 s warm-up and a
>= 30 s / >= 5,000-operation measurement window. Measured repetitions (send->ack
per operation batch): p50 4.59 / 4.47 / 6.14 ms, p95 21.59 / 14.09 / 16.81 ms,
p99 81.54 / 55.42 / 42.52 ms, 0 errors, throughput ~156-164 ops/s; every client
document equals the fresh-join observer document in all three runs (canonical
entity hashes recorded in `reviews/evidence/P5-08-load-*.json`). The gate is
documented in `docs/gates/load.md`.

Exit criteria status: load **pass**; restart durability/catch-up/compaction
**pass** (P5-06); two offline browsers **pass** (P5-07 crdt-convergence); pure
convergence 30,000 rounds **pass**; own-ops undo **pass**. Two real bugs found by
this task are fixed and regression-protected: lexicographic page ordering in
`PgSyncStore.updatesAfter` (numeric ORDER BY) and the 1 MiB outbound WebSocket
bound (now a separate 64 MiB outbound bound, so large snapshots are delivered).

Recorded changes/limits:

- The durable log is an **operations log** since stage 6: `sync_updates.encoded_update`
  holds the batch's contract operations JSON (UTF-8, base64 in the bytea column),
  not a full Yjs state. Legacy full-state rows fail closed with a clear error
  (pre-release data only; slot DBs are reset by gates). A future rename/migration
  of the column is cosmetic.
- Replay is paginated (500 rows/page, numeric `server_seq` order) for join,
  resync and compaction; outbound frames may be up to 64 MiB (inbound remains
  1 MiB).
- **Auto-compaction scheduler is not wired**: compaction is invoked manually and
  the log grows until it runs; replay pagination makes large logs correct but not
  cheap.
- **Platform board-content bootstrap remains open**: fresh Pg boards start from
  the empty baseline; a non-empty platform board content path is not wired.
- **Sync tables have no RLS** yet; access is enforced by the service authorizer
  only.
- **Presence removal sentinel** (empty selection + origin cursor) is a documented
  follow-up for a contract minor; presence identity has no dedicated field.
- **SDK clientId** should come from the authenticated session in the web app;
  the SDK can generate one per client instance.
- **L05 autosave UI wiring** in the web-app is not part of this stage.
- The pure convergence harness takes ~8 minutes (state+snapshot compared every
  round); the `crdt-convergence` gate is exclusive.
- **docState** is stored inside the existing `sync_snapshots.snapshot` JSONB
  wrapper (`{boardContent, docState}`), not in a dedicated column.
- **Single service instance, no horizontal scaling**: broadcasts and the client
  registry are in-process; multi-instance fan-out is future work.
