area: sync
kind: minor

Add the P5-07 crdt-convergence proof and L11 realtime own-op undo: pure multi-seed harness (3 seeds × 10,000 rounds, two BoardDoc replicas in different interleavings with offline phases, encoded state+snapshot compared every round, 0 divergences) and a real-stack offline/undo proof with two SDK board-sync clients over the sync service (A offline, both edit, A reconnect/resync, convergence hashes, missed-update count; undoOwn sends only A's own inverse so A's change reverts, B's edit stays, both converge; remote ops never entered the history). Adds docs/gates/crdt-convergence.md (command, exclusivity, thresholds, environment, Node fallback flag), updates docs/quality and docs/realtime, commits the evidence records.

## Round 4: real join-replay bug and browser proof

The browser attempt exposed a real sync-service bug: joins rebuilt the CRDT
document from the JSON snapshot and then applied the update log; for non-empty
snapshots (platform bootstrap / compacted snapshots) that creates concurrent
duplicate Yjs entity structs, so updates committed after the snapshot could lose
the LWW race and a joining client missed committed updates while
`welcome.serverSeq` was current. Fix: snapshots now store the encoded CRDT state
(`{boardContent, docState}` in the existing `sync_snapshots.snapshot` JSONB, no
new migration); join/resync/compaction rebuild from the encoded state over an
empty-entity board, replay every update with `serverSeq > snapshotSeq` in order,
and send the rebuilt document with the current `welcome.serverSeq`. Regression
test `services/sync/test/join-replay.test.mjs` uses the real PgSyncStore and
covers join after compaction with a post-snapshot update and resync from an
earlier sequence. The browser harness now fails closed (non-zero exit when the
proof fails) and uses an empty canonical baseline seeded via committed
`createCard` operations; the crdt-convergence gate is green only when the browser
record says `browser: true` with equal hashes (latest evidence: passed=true,
browser=true).

