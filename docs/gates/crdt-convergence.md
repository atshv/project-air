# Gate: crdt-convergence

Stage-exit gate for the realtime stage (P5-07). It proves CRDT convergence, the
two-offline-clients behaviour and the L11 own-operation undo rule.

## Command

```
node packages/crdt/test/convergence-harness.mjs && node --test --test-concurrency=1 packages/sdk/test/offline-undo.test.mjs && node services/sync/test/offline-browser.mjs
```

The gate is **exclusive**: no other gate or browser harness may run while it
runs (the stack proof starts the sync service on the slot port).

## Join replay fix (round 4)

The browser attempt exposed a real service bug: joining clients rebuilt the
document with `documents.fromContent(snapshot.boardContent)` and then applied the
update log; for a non-empty snapshot (platform bootstrap or a compacted snapshot)
that creates concurrent duplicate Yjs entity structs, so updates committed after
the snapshot could lose the last-writer-wins race and a joining client missed
committed updates even though `welcome.serverSeq` was current. Fix: the encoded CRDT state is stored next to the JSON board content in the
existing `sync_snapshots.snapshot` JSONB (a `{boardContent, docState}` wrapper, no
new migration); join/resync and compaction rebuild the document from the encoded
state over an empty-entity board, then replay every update with
`serverSeq > snapshotSeq` in order, and send the rebuilt document with
`welcome.serverSeq = current max`. Existing plain-BoardContent rows are read as
before. The regression test
`services/sync/test/join-replay.test.mjs` uses the real `PgSyncStore` and covers
join-before-compaction, join-after-compaction with a post-snapshot update, and
resync from an earlier sequence.

## Thresholds

- Pure convergence: **10,000 rounds minimum** (the harness runs 3 deterministic
  seeds × 10,000 rounds = 30,000), two `BoardDoc` replicas applying the same
  contract operations in different interleavings including offline phases; the
  encoded state **and** canonical snapshot are compared after every round; the
  gate fails on **any divergence** (0 required). Runtime and per-seed state/
  snapshot hashes are recorded.
- Stack proof: two SDK `BoardSyncClient`s over the real sync service; client A
  goes offline, both clients edit, A reconnects/resyncs; both documents and the
  service state must converge (hashes recorded), then A's `undoOwn()` must revert
  only A's operation while B's edit remains and both documents converge again.
- Browser proof: **browser: true** — `services/sync/test/offline-browser.mjs`
  serves the built SDK/crdt ESM statically with an import map for bare
  `yjs`/`lib0` (no bundler, no new dependency), starts the real sync service,
  launches two headless Chrome-for-Testing pages and drives them over CDP. The
  offline window is controlled: A's socket is closed (SDK offline path), B's edit
  is awaited until durable in the service, then A's reconnect is triggered by the
  injected 1.5 s backoff. The wire log proves A received welcome+snapshot at the
  current serverSeq (3) including B's edit, sent `resyncRequest` from its last
  known serverSeq (2), and sent its queued own op exactly once; both pages' state
  hashes match after reconnect (`af537818…`) and after A's `undoOwn()`
  (`49ec4f80…`), with B's edit preserved (card 77). The earlier
  `browser: false` was a harness race (the 100 ms reconnect and CDP
  offline/online emulation could complete before B's update was durable, so A
  reconnected to a stale snapshot and B's broadcast was not delivered to the
  not-yet-joined session), not an SDK ordering bug; the controlled-reconnect
  harness is the fixed evidence.
- Evidence: `reviews/evidence/P5-07-convergence-*.json` (pure) and
  `reviews/evidence/P5-07-stack-*.json` (offline/undo), both committed.
- Environment: Chromium/Node from the local toolchain (Node LTS, deterministic
  seeded PRNG, in-memory fake store for the stack proof — no DB rows).
