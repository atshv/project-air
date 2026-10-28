# Gate: load

Stage-exit load proof for the realtime stage (P5-08): 25 SDK `BoardSyncClient`s
on one board against the real sync service, with exact convergence.

## Command

```
node packages/sdk/test/load/run-load.mjs
```

Exclusive: no other gate or browser harness may run while it runs (the harness
starts the real sync service on the slot port and uses the slot PostgreSQL).

## Thresholds

- 25 clients on one board, connected through the SDK.
- ≥ 5,000 operations in the measurement window and a window of ≥ 30 s (warm-up
  5 s excluded).
- **p95 send→ack ≤ 150 ms**; latency definition: `sendOperations()` call to the
  SDK `ack` event for that batch (one operation per batch); p50/p95/p99/max/mean
  recorded.
- **0 errors** (send failures, rejects, or ack timeouts).
- **Exact convergence**: every client document equals every other client
  document and the fresh-join observer document (entity content canonicalised by
  id, object keys sorted; board metadata is baseline platform data and excluded).
- Recorded environment: Node version, platform, release, CPU count, total memory,
  slot database name, sync port, measurement definition, machine.
- Three repetitions are run for the stage report; the gate is green when the
  documented run is green for the documented reason (variance is recorded).

## Cleanup / isolation

- The harness starts and stops only its own service, closes all clients, closes
  the store and deletes its own board rows (`sync_updates`/`sync_snapshots` for
  its board id) in a `finally` path; no processes or data are left behind.
- It never touches production/staging or another session's server; only the
  slot's local service and database are used.

## Evidence

- `reviews/evidence/P5-08-load-<timestamp>.json` (the three green repetition
  records committed for the stage report) with latency percentiles, throughput,
  errors, convergence hashes, stored-row count/format and environment.

## Notes / recorded limits

- The durable log is an **operations log** (batch operations JSON, UTF-8 in the
  existing bytea column) since stage 6; legacy full-state-Yjs rows fail closed.
- Replay paginates 500 rows per page and orders by the numeric `server_seq`
  column; outbound WebSocket frames use a 64 MiB bound (snapshots can exceed the
  1 MiB inbound bound).
- Compaction is manual in this stage (no scheduler); replay pagination matters
  while the log grows.
- Single service instance; no horizontal scaling.
