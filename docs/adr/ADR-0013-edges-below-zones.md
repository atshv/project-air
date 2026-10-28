# ADR-0013: Edges below zones

**Date:** 2026-10-28 · **Status:** accepted · **Supersedes:** –

## Context

Design law §8 fixed the layer order canvas background 1, zones 2, edges 3, blocks 4, note cards 5.
With that order a connection line between two objects inside or next to a zone runs over the zone's
surface and can cross its 40 px title header. In the live demo (P0-36) the owner asked for "die
connection linien verlaufen hinter allen cards" and decided on 2026-10-28 that this includes zones;
the demo has since drawn its edge below the zone card with a local deviation comment. On review the
owner confirmed the decision ("Ja, festhalten"), so the law, the tokens and every consumer must say
the same thing (AD-7, design rule §13).

## Decision

**Edges are layer 2, zones layer 3.** The order is now canvas background 1, edges 2, zones 3, blocks
4, note cards 5; layers 6 to 11 are unchanged. `packages/ui-kit/tokens.json` is the single source;
the generated `tokens.css` (`--layer-edges: 2`, `--layer-zones: 3`), `tokens.h` and `layers.ts`
follow through the existing codegen. A connection line never draws over any object.

Alternatives considered:

- **Keep §8 and accept lines over zones.** Rejected: lines cross zone titles and read as part of the
  zone; the owner rejected it in the demo.
- **Clip lines at zone borders.** Rejected: more geometry for the same visual result, and the line
  would still cross a zone between its border points.

## Consequences

- `docs/design-rules.md` §8, `docs/engine.md` and the design-system page show the new numbers; the
  demo's `.demo__edge` uses `--layer-edges` again.
- The engine's draw order does not change: it draws only zones, blocks and note cards as rectangles
  and zones stay the lowest of those. `Layer::zones` reads `tokens::layer_zones`, now 3. When the
  engine draws edges later, they go below zones.
- The ui-kit token test's expected layer table changes with the law (owner-approved).
- The owner's German blueprint in `docs/owner/` keeps its original order; this ADR takes precedence.
