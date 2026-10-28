# Engine-core stage report and L01 final proof (P4-28)

**As of:** 2026-10-28 · **Stage:** engine-core · **Task:** P4-28 · **Gates:** `perf-final`, `visual-final`

This report records the engine-core stage's measured proof: the L01 final performance measurement,
the reference-image gate at both committed viewports for **both backends** (WebGL2 and WebGPU), and
the deterministic stage showcase. It was refreshed on the merged two-backend head after P4-11…P4-13
and now closes the stage: all 30 engine-core tasks (including P4-17…P4-24) are done and merged.
Remaining limits are outside the engine stage (M1 reference hardware in hardening, catalogue e2e
statuses in later stages); see "Open points".

## Final measurement table (basis vs final)

The basis is the committed P4-03 record `reviews/evidence/P4-03-perf-basis-20261026T063953Z.json`
(read-only, never regenerated here). The final run on the merged two-backend head is
`reviews/evidence/P4-28-perf-final-20261028T164907Z.json`; the raw harness records are
`reviews/evidence/P4-03-perf-engine-core-20261028T164912Z.json` (10,000 objects) and
`reviews/evidence/P4-03-perf-final-20261028T164914Z.json` (L01 proof).

| Item | Basis (2026-10-26) | Final (2026-10-28) | Limit (basis + 10 %) | Result |
| --- | --- | --- | --- | --- |
| Machine | Mac mini M2, 8 GB (Apple M2, 8 cores) | same | — | proxy accepted |
| OS / browser | macOS 26.5.2 (Darwin 27.2.0), Chrome for Testing 156.0.8078.4 | same | — | recorded per run |
| GPU renderer | ANGLE Metal Renderer: Apple M2 | ANGLE Metal Renderer: Apple M2 | real GPU required | pass (not software) |
| 10,000-object interactive p50 / p95 / p99 / mean | 0.000 / 0.200 / 0.200 / 0.052 ms | 0.100 / 0.200 / 0.300 / 0.063 ms | 0.2 / 0.4 / 0.4 / 0.252 ms (resolution floor 0.2 ms) | pass |
| 10,000-object max frame interval / intervals > 16.7 ms | 1.200 ms / 0 | 1.700 ms / **0** | max observation | pass |
| L01 proof (500 cards + 50 zones): p50 / p95 / p99 / mean | basis above | 0.100 / 0.200 / 0.300 / 0.062 ms | +10 % | pass |
| L01 max frame duration (50 ms bound) | 1.200 ms | **0.600 ms** | < 50 ms | pass |
| L01 culling checkpoints / mismatches | — | **100 / 0** (min 50) | >= 50 / 0 | pass |
| Offscreen rendering | — | draws fewer than the document: 99 frames, min 24 / max 694 instances | at least one culled frame | pass |

The 10,000-object interactive scene is `buildEngineCoreScene()` (9,200 cards, 200 zones, 600 blocks,
world 19,200 x 10,816); the L01 proof scene is `buildSampleScene()` (500 cards, 50 zones, 144
contained blocks = 694 objects). Both run 120 warm-up + 2,000 measured frames on the deterministic
camera path (zoom cycle + pan sweep), one `setCamera` per frame.

## Visual reference gate

`reviews/evidence/P4-28-visual-final-20261028T164920Z.json` and the capture record
`reviews/evidence/P4-28-visual-run-20261028T164920Z.json`: the exclusive gate captures **56 frames**
(14 scenes × 1440x900 and 390x844 × WebGL2 and WebGPU). Each backend is compared exactly against its
own committed reference set: **28/28 WebGL2 and 28/28 WebGPU images are 0-diff**, no baseline was
updated. The WebGPU adapter is positively identified (`apple`/`metal-3`, not software). The
cross-backend comparison (canvas region only) records content parity for 28/28 pairs within the
reviewed tolerance — at most 3 % differing canvas pixels and zero interior differing pixels (max
2.67 %, worst channel delta 201 on antialiased boundaries) — and is not claimed as pixel identity.
The showcase is not a gate scene and adds no baseline.

## Stage showcase

Deterministic `?showcase=1` state in `apps/engine-playground` (paused on-demand scheduler, fixed
camera, selection chrome on three objects, snap guides, 200 % sharp text bucket; no board writes):
`reviews/evidence/P4-28-showcase-desktop.png` (1440x900, 200 %) and
`reviews/evidence/P4-28-showcase-mobile.png` (390x844, 150 %), captured by
`apps/engine-playground/tools/capture-showcase.mjs` with the record
`reviews/evidence/P4-28-showcase-20261028T075041Z.json` (camera, counts, rendered frames, selection,
guides).

## Open points (not done, not claimed)

- **WebGPU is the second backend, not the measured one.** P4-11…P4-13 are merged and the two-backend
  reference set exists (28 WebGL2 + 28 WebGPU baselines); `perf-final`/`perf` stay WebGL2 (owner
  decision `Q19`), so no WebGPU performance claim is made.
- **Stage-5 engine scope is done:** P4-01…P4-30 are merged (L14 resize, L16 auto-pan, L20 placement,
  L12 keyboard/menu, L11 undo/redo, L17 remember view and L15 trackpad/wheel desktop landed on
  2026-10-28). The stage exit criterion "all engine entries of the canvas work orders done" is met for
  the engine-owned entries; the catalogue document still lists them `open` because their e2e checks
  belong to the web-app/realtime stages and the lead's status pass has not run.
- Reference hardware: the MacBook Air M1 8 GB target is still unmeasured; the Mac mini M2 8 GB proxy
  is accepted by the owner but must be re-measured on the M1 before that hardware is called done.
- Node deviation: the harness ran on Node v26.12.1 (repository pins 24.22.1); recorded, must not be
  carried into the reference-device run.

## Stage handoff

The engine core is handed over as a measured two-backend engine (WebGL2 measured default, WebGPU
second backend with fallback) with a deterministic proof harness, 28 WebGL2 and 28 WebGPU reviewed
reference images and the L01 final proof refreshed on the merged head. Stage 5 is complete; the next
stage is realtime (owner decision pending, Q4 CRDT), then web-app, value and hardening, where the M1
reference-hardware measurement, images, the a11y mirror and the L15 touch part follow. Every final
number in this report is reproduced by the committed gate commands; the basis remains the P4-03
file.
