# Engine-core stage report and L01 final proof (P4-28)

**As of:** 2026-10-28 · **Stage:** engine-core · **Task:** P4-28 · **Gates:** `perf-final`, `visual-final`

This report closes the engine-core stage's measured proof: the L01 final performance measurement, the
reference-image gate at both committed viewports, and the deterministic stage showcase. It records the
WebGPU gap explicitly; it does not claim the stage complete (see "Open points").

## Final measurement table (basis vs final)

The basis is the committed P4-03 record `reviews/evidence/P4-03-perf-basis-20261026T063953Z.json`
(read-only, never regenerated here). The final run is
`reviews/evidence/P4-28-perf-final-20261028T075100Z.json`; the raw harness records are
`reviews/evidence/P4-03-perf-engine-core-20261028T075103Z.json` (10,000 objects) and
`reviews/evidence/P4-03-perf-final-20261028T075106Z.json` (L01 proof).

| Item | Basis (2026-10-26) | Final (2026-10-28) | Limit (basis + 10 %) | Result |
| --- | --- | --- | --- | --- |
| Machine | Mac mini M2, 8 GB (Apple M2, 8 cores) | same | — | proxy accepted |
| OS / browser | macOS 26.5.2 (Darwin 27.2.0), Chrome for Testing 156.0.8078.4 | same | — | recorded per run |
| GPU renderer | ANGLE Metal Renderer: Apple M2 | ANGLE Metal Renderer: Apple M2 | real GPU required | pass (not software) |
| 10,000-object interactive p50 / p95 / p99 / mean | 0.000 / 0.200 / 0.200 / 0.052 ms | 0.000 / 0.200 / 0.300 / 0.057 ms | 0.2 / 0.4 / 0.4 / 0.252 ms (resolution floor 0.2 ms) | pass |
| 10,000-object max frame interval / intervals > 16.7 ms | 1.200 ms / 0 | 1.600 ms / **0** | max observation | pass |
| L01 proof (500 cards + 50 zones): p50 / p95 / p99 / mean | basis above | 0.000 / 0.100 / 0.200 / 0.054 ms | +10 % | pass |
| L01 max frame duration (50 ms bound) | 1.200 ms | **1.000 ms** | < 50 ms | pass |
| L01 culling checkpoints / mismatches | — | **100 / 0** (min 50) | >= 50 / 0 | pass |
| Offscreen rendering | — | draws fewer than the document: 99 frames, min 24 / max 694 instances | at least one culled frame | pass |

The 10,000-object interactive scene is `buildEngineCoreScene()` (9,200 cards, 200 zones, 600 blocks,
world 19,200 x 10,816); the L01 proof scene is `buildSampleScene()` (500 cards, 50 zones, 144
contained blocks = 694 objects). Both run 120 warm-up + 2,000 measured frames on the deterministic
camera path (zoom cycle + pan sweep), one `setCamera` per frame.

## Visual reference gate

`reviews/evidence/P4-28-visual-final-20261028T075109Z.json` and the capture record
`reviews/evidence/P4-28-visual-run-20261028T075109Z.json`: **28 / 28 committed reference images**
(1440x900 and 390x844) are 0-diff, full run, no baseline updated. The reference set was not extended
by this task (the showcase is not a gate scene and adds no baseline).

## Stage showcase

Deterministic `?showcase=1` state in `apps/engine-playground` (paused on-demand scheduler, fixed
camera, selection chrome on three objects, snap guides, 200 % sharp text bucket; no board writes):
`reviews/evidence/P4-28-showcase-desktop.png` (1440x900, 200 %) and
`reviews/evidence/P4-28-showcase-mobile.png` (390x844, 150 %), captured by
`apps/engine-playground/tools/capture-showcase.mjs` with the record
`reviews/evidence/P4-28-showcase-20261028T075041Z.json` (camera, counts, rendered frames, selection,
guides).

## Open points (not done, not claimed)

- **WebGPU backend (P4-11 … P4-13) is not merged in this chain.** The two-backend reference images
  cannot be proven: the committed set is **WebGL2-only**. The `visual-final` record therefore is a
  WebGL2 reference-image proof; no WebGPU set is claimed, no baseline was redefined, and
  `docs/quality.md`'s backend wording is unchanged. This is the largest remaining stage-exit gap.
- Open engine tasks: **P4-17** resize, **P4-18** auto-pan, **P4-19** placement, **P4-20**
  keyboard/menu, **P4-21** undo UI, **P4-22** remember view, **P4-24** trackpad. The stage exit
  criterion ("all engine entries of the canvas work orders done") is therefore not met.
- Reference hardware: the MacBook Air M1 8 GB target is still unmeasured; the Mac mini M2 8 GB proxy
  is accepted by the owner but must be re-measured on the M1 before that hardware is called done.
- Node deviation: the harness ran on Node v26.12.1 (repository pins 24.22.1); recorded, must not be
  carried into the reference-device run.

## Stage handoff

The engine core is ready to hand over as a measured WebGL2 engine with a deterministic proof
harness and 28 reviewed reference images; the next owner should first land the WebGPU backend
(P4-11…P4-13) and re-run `visual-final` to extend the reference set to two backends, then the
remaining interaction tasks (P4-17…P4-24) before claiming the stage complete. Every final number in
this report is reproduced by the committed gate commands; the basis remains the P4-03 file.
