# @project-air/crdt

CRDT document core for one board behind the own `BoardDoc` interface (ADR-0011):
`apply(op)`, `encodeUpdate()`, `applyUpdate()`, `snapshot()`, `stateVector()`, `encodeState()` and
`merge(other)`. The contract (`packages/contracts`, 0.3.0) stays the wire format; every change is one
contract operation with its inverse (AD-1), zones/blocks/note cards/notes/edges and the fractional
`z` map through the document, and deletions are restorable by their contract inverses. Yjs (MIT,
13.6.27) is an implementation detail: no Yjs type or import escapes this package, and the
conformance suite runs against a second fake adapter so the library stays replaceable.

Commands: `pnpm --filter ./packages/crdt build | typecheck | lint | test`.
