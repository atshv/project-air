# Architecture: packages/test-kit

**Kind:** `package` · **Created in stage:** `engine-spike`

## Purpose

The same test data and helpers for every package. It provides deterministic fixture boards (empty,
sample and stress), a fake sync server, a login helper and the port lookup that reads `.polier-slot`
instead of hard-coded ports. The scene builders and their tests are the first content (P4-02).

## Inputs

- Contract fixtures and types from `packages/contracts`.
- Slot, port and database values from `.polier-slot`.

## Outputs

- Deterministic scene builders in `src/scenes.ts`: `buildSampleScene()` (500 note cards, 50 zones
  with 2–4 contained blocks each, all five zone tones, world 9600×5408 px), `buildStressScene(count)`
  (default 10,000, valid 0 … 50,000), `buildEngineCoreScene()` (10,000 mixed board objects: 9,200
  cards, 200 zones and 600 blocks, world 19200×10816 px), `buildScene(name)` and
  `createSeededRandom(seed)`. Scenes are plain engine rectangles with `id`, geometry, `tone` and
  `layer` plus metadata.
- A fake sync server, a login helper and a port lookup helper.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change
  updates every dependant in the same task.
- Scenes are pure functions of their arguments: seeded PRNG and integer geometry, no ambient
  randomness, clock or locale-dependent formatting. The package does not import the engine; scene
  objects are structurally compatible with the engine bridge rectangles.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

- `pnpm --filter @project-air/test-kit run build` — compiles `src/` to `dist/` (the playground's
  import map uses `dist/scenes.js`).
- `pnpm --filter @project-air/test-kit run typecheck` / `run lint`.
- `pnpm --filter @project-air/test-kit test` — `node --test test/*.test.mjs`, proving determinism,
  the 500/50 counts, the 10,000 stress default and the 0/50,000 edge cases.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Scene and playground contract: [docs/engine.md](../../docs/engine.md)
