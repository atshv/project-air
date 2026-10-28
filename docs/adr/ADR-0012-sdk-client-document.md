# ADR-0012: The SDK owns the client-side board document

**Date:** 2026-10-28 · **Status:** accepted · **Supersedes:** –

## Context

The realtime stage needs a client-side working copy of the board and a transport to the sync service:
the browser (and every Node harness) must join a board, apply remote CRDT updates, queue local
operations offline and reconnect from a state vector. The module map limits `packages/sdk` to
`packages/contracts` and `apps/web` to packages only (never services); `packages/crdt` is a package
with its own `BoardDoc` interface (ADR-0011). The open question is where the client document and the
sync boundary live so the UI → logic → data direction stays intact and the web app does not grow a
second transport or a second autosave path.

## Decision

**`packages/sdk` owns the client-side document and the sync boundary.** Its `may_import` becomes
`packages/contracts` + `packages/crdt`. The SDK exposes the typed platform client (unchanged) and a
board-sync client that holds a `BoardDoc`, speaks the sync contract over WebSocket (injected
connection for tests/Node), keeps the offline operation queue, tracks `serverSeq`/acks, reconnects
from a state vector and provides the one autosave path of L05 (debounce, flush rules, sequence
numbers, status events). `apps/web` imports only `@project-air/sdk` (plus UI/editor/engine packages)
and never `packages/crdt` directly; the CRDT library stays behind the `BoardDoc` interface, so the
SDK sees no Yjs type (ADR-0011).

## Consequences

- One client library for browser and Node harnesses; the convergence/load proofs use the same code
  the web app will use.
- Layering stays UI → logic → data: web app (UI) → SDK (logic/data boundary) → contracts/crdt.
- `boundaries` enforces the new import edge; the board `packages[]` entry changes in the same task
  that needs the edge.
- The SDK build now carries Yjs, so the browser bundle grows; the web-app stage measures and budgets
  it, and the SDK must stay DOM-free apart from the injected WebSocket.
- ADR-0011 keeps governing the CRDT library choice; this ADR only places the client boundary.

## Alternatives

- **`apps/web` imports `packages/crdt` directly** — splits the client logic (transport in SDK,
  document in the app), duplicates the offline queue/autosave hook-up and couples the UI to the CRDT
  package.
- **A separate client-harness app package** — an extra layer for little gain; the SDK already is the
  typed client boundary of the project.

## References

- [ADR-0011](ADR-0011-crdt.md) (CRDT library and interface) · board Q4 (2026-10-28) ·
  `docs/module-map.md` (package map) · `docs/contracts.md` (sync protocol 0.3.0).
