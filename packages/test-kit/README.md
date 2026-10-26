# packages/test-kit

Fixtures, fake servers and slot helpers. The first content is the deterministic scene builders for
the engine playground and the engine gates.

- **Kind:** `package`
- **Created in stage:** `engine-spike`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)

## Scenes

`src/scenes.ts` builds engine rectangles plus metadata from one seeded PRNG (see
[docs/engine.md](../../docs/engine.md)):

- `buildSampleScene()` — the sample board: 500 note cards, 50 zones with 2–4 contained blocks each,
  all five zone tones, geometry on the 16 px canvas grid in a 9600×5408 px world.
- `buildStressScene(count)` — N objects on a tight grid, default 10,000, valid 0 … 50,000.
- `buildScene(name, options)` / `isSceneName(value)` — the scene dispatch used by the playground.

## Commands

```bash
pnpm --filter @project-air/test-kit run build      # src/ -> dist/ (playground import map)
pnpm --filter @project-air/test-kit run typecheck
pnpm --filter @project-air/test-kit run lint
pnpm --filter @project-air/test-kit test           # node --test test/*.test.mjs
```
