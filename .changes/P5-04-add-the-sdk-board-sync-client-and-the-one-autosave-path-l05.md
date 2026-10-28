area: sync
kind: minor

Add the SDK board-sync client and the one autosave path (L05 realtime half): createBoardSyncClient owns one BoardDoc over an injected WebSocket-like connection (0.3.0 hello/join/snapshot install at serverSeq + catch-up, operationBatch with per-connection seq, ack/serverSeq tracking, duplicate suppression, ordered offline queue, bounded backoff reconnect with resyncRequest, idempotent close/leaveBoard, state/status/remote/error events); createAutosave with 400 ms debounce, immediate flush on blur/panel close/navigation/visibility hidden/pagehide, monotonic save sequences so stale responses never overwrite newer values, saving/saved/error status and retry(); installFlushTriggers; deterministic fake-socket/fake-clock tests (handshake/join/catch-up, batch/ack ordering, stale ack, offline queue, reconnect resync, duplicate suppression, five flush triggers, status transitions, stale responses); docs/realtime + ADR-0012 note.

## Round 2 (contract correctness)

`clientId` is a required **UUIDv7** (contract 0.3.0 `$defs.uuid`): the SDK takes
an injected authenticated client id or generates one per board-sync client via
`createRequestId()` (stable across reconnects); invalid ids are rejected. The
old sequential local id helper was removed: every message id and batch id is a
fresh `createRequestId()` UUIDv7 (time + random tail), so ids are unique across
clients and the P5-03 schema validation accepts the SDK messages. The SDK test
suite now captures every outgoing message with a fake socket and validates it
against `packages/contracts/schemas/sync/sync.schema.json` (the P5-03 validator),
and asserts two clients get different UUIDv7 clientIds and all message ids are
unique.

