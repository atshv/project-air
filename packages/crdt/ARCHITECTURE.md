# packages/crdt architecture

- **Own interface first.** `src/index.ts` declares `BoardDoc` and the adapter factory; the public API
  never exposes Yjs. `src/yjs-doc.ts` is the Yjs (MIT 13.6.27) adapter; `FakeBoardDoc` in
  `src/index.ts` is the second adapter for the conformance suite.
- **Contract is the wire format.** Entities are the contract's BoardContent collections
  (zones/blocks/note cards/notes/edges); operations and inverses are the generated contract types
  (`packages/contracts/generated/types.ts`); zone parents and the fractional `z` are plain fields of
  the mapped entity. AD-4 (a note exists once) is preserved: cards reference note ids, notes are not
  duplicated.
- **One write path.** `apply(op)` applies exactly one contract operation (or inverse) — the same
  payloads the engine produces; the Yjs document is the CRDT state, encoded updates are the
  transport, and `snapshot()` is the canonical contract board-content snapshot. Deletes remove the
  entity and the contract inverse restores it (no second save path).
- **Convergence.** Seeded randomized rounds on two replicas, offline batches, snapshot round-trip
  and op+inverse state equality are pinned by `test/conformance.test.mjs` for both adapters.
- **Allowed imports:** `packages/contracts` only (board.json `packages[crdt].may_import`).
