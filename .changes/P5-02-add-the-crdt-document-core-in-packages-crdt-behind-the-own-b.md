area: sync
kind: minor

Add the CRDT document core in packages/crdt behind the own BoardDoc interface (apply/encodeUpdate/applyUpdate/snapshot/stateVector/encodeState/merge): Yjs 13.6.27 (MIT, Q4-approved) behind the package boundary with a second fake adapter passing the same conformance suite; contract 0.3.0 board content and operations/inverses mapped (zones/blocks/note cards/notes/edges, zone parents, fractional z, deletes restorable by inverses); seeded 10,000-round convergence, offline merge, snapshot round-trip and op+inverse state equality; package skeleton with build/typecheck/lint/test; versions table, ADR-0011 note, README/ARCHITECTURE.
