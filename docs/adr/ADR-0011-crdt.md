# ADR-0011: CRDT — Yjs behind an own interface

**Date:** 2026-10-28 · **Status:** accepted · **Supersedes:** –

## Context

The realtime stage requires several people to edit one board at the same time — and offline — and
still end in the same state (stage 6 exit criteria: two offline clients converge after reconnect, a
restart loses no acknowledged change). Every change is one contract operation with its inverse
(AD-1) and the server is the source of truth (AD-2), so the engine and the browser keep a working
copy that never talks to the network directly. Board question **Q4** asked whether the project uses
an open-source CRDT library behind an own interface or writes its own algorithm. The licence rules
allow MIT/BSD/Apache-2.0/ISC/Zlib only; the CRDT lives in TypeScript (`packages/crdt`, services,
SDK), separate from the C++/WASM engine.

## Decision

**Yjs (MIT) behind an own `BoardDoc` interface.** `packages/crdt` exposes `apply(op)`,
`encodeUpdate()`, `applyUpdate()`, `snapshot()` and `stateVector()`; contract operations are mapped
to Yjs shared types inside the package, and no Yjs type or API escapes the package boundary. The
same conformance suite must pass for a second adapter implementation (a fake or a later library) so
the library stays replaceable. The version is pinned in `docs/versions.md`.

## Consequences

- Convergence, offline updates and awareness come from a mature, actively maintained MIT library;
  the dependency is approved by the owner decision on Q4 (2026-10-28).
- The package boundary keeps a later switch (or a maintenance fork) possible; the conformance suite
  is the guard.
- Undo/redo must still apply only the client's own operations (L11 realtime rule) — Yjs updates are
  mapped per client, not globally undone.
- The sync service persists encoded updates and snapshots; the contract stays the wire format.
- Bundle size only matters where the web app imports the package (web-app stage), not in the engine.

## Alternatives

- **Automerge (MIT)** — CRDT JSON in Rust/WASM; a second WASM toolchain next to the engine's
  Emscripten build and a larger footprint for no stated benefit at this stage.
- **Own algorithm** — maximum control, but convergence, offline merge, garbage collection and undo
  would be built and proven from scratch; too much risk for the realtime stage.

## References

- Board Q4 (answered 2026-10-28) · `docs/contracts.md` (sync protocol 0.2.0/0.3.0) ·
  `docs/module-map.md` (packages/crdt allowed imports: `packages/contracts`) ·
  [ADR-0005](ADR-0005-contract.md) (contract source of truth).
