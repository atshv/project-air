# Gate Catalogue: Visual diff

> Project visual gates. The canvas is verified against committed reference images in a real browser
> on a real GPU. The values in this catalogue are authoritative; the harness mirrors them as
> constants (viewport set, tolerance, backend list), so a change must update both in the same task.

| Gate | Command | Expected |
| --- | --- | --- |
| `visual` | `node packages/engine/test/visual/run-visual.mjs` | exit 0, every reference image within tolerance at 1440x900 and 390x844 for WebGL2 and WebGPU; JSON + PNG diffs under `reviews/evidence/` |
| `visual-update` | `node packages/engine/test/visual/run-visual.mjs --update` | baselines written; an explicit review action, never a gate pass |

## `visual` — engine-core stage gate (P4-04)

The stage gate set by P4-04 captures deterministic playground states and compares them with
committed reference images. It is dependency-free: it reuses the local Chrome for Testing binary and
the Chrome DevTools protocol like `apps/engine-playground/tools/capture.mjs`, encodes and decodes
PNG in Node, and writes the diff before it fails.

- **States:** a fixed list of named scenes from `packages/test-kit` — the sample board at rest, a
  zoomed-in section, a zoomed-out section, the 10,000-object scene at rest, and the overlay/field
  example. Each scene is served from the worktree's slot web port by the harness's own static
  server, waits for the engine's ready hook, pauses the render loop and captures the canvas plus the
  playground chrome.
- **Viewports:** exactly 1440x900 and 390x844 with device pixel ratio 1, emulated through the DevTools
  protocol (browser flags alone cannot set them); both are committed per scene.
- **Backends:** WebGL2 is the default; WebGPU captures run through the same harness once P4-11 adds
  the switch (`?backend=webgpu`). A backend that is genuinely unavailable in the local browser is
  recorded as a skipped capture with the detected reason, never as a silent pass.
- **Tolerance:** 0 differing pixels by default. A tolerance is allowed only for documented
  antialiasing noise (per-channel delta and a pixel-count ratio in the gate record), and it is
  approved in review, not chosen by the task.
- **Baselines:** committed under `reviews/evidence/visual-baselines/` with the scene, viewport and
  backend in the filename. Updating one needs a reviewer who saw the before and after images.
- **Failure diffs:** the harness writes `reviews/evidence/<task>-visual-<timestamp>.json` and one
  diff PNG per failing scene; the gate record quotes the differing pixel count and the worst delta.
- **Exclusive:** the harness starts and stops its own server and browser on the slot port; it
  declares `exclusive: ["visual"]` and is never run next to another browser gate.
- **Hardware and browser rules:** same Chrome for Testing version and flags as `perf-baseline`; the
  renderer string is recorded (a software renderer makes the run `infra`, never a pass). Screenshots
  are not perf evidence and a perf run is not a reference image.

### Pitfalls

- Screenshots depend on OS, fonts, device pixel ratio, browser version and GPU; pin all of them or
  record the documented tolerance.
- Animations, timestamps, the FPS label and the HUD change; the harness pauses the loop and masks or
  hides volatile regions, or the scene defines fixed values.
- Never update baselines to make a gate pass; that hides the regression the gate exists for.
- Run the gate on the same machine class as the committed baselines; a different GPU family is a
  different measurement and needs a new baseline set plus review.
