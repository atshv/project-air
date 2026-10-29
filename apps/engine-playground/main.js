// Engine playground: deterministic board scenes and the WebGL2 benchmark.
//
// The page stays a static module: the engine bridge and the scene builders are
// wired through the import map in index.html, so there is no bundler and no
// build step for this file.
//
// Modes (query parameters)
//   (default) / ?scene=sample      sample board: 500 cards, 50 zones with blocks
//   ?scene=stress&count=<n>        stress scene, default 10,000 objects (max 50,000)
//   ?scene=engine-core             engine-core board: 10,000 mixed board objects
//   ?scene=layers[&front=<id>][&store=off]
//                                  L13 layers scene loaded as contract objects through
//                                  the document port; a click brings an object to the
//                                  front of its layer (one reorder operation), the keys
//                                  persist in localStorage, ?front applies one front
//                                  gesture at start, ?store=off ignores the storage
//   ?perf=engine-core&scene=<name>&samples=<n>&warmup=<n>[&verifyCulling=1]
//                                  engine-core perf measurement driven by
//                                  packages/engine/test/perf/run-perf.mjs: one
//                                  deterministic pan/zoom camera path, one
//                                  setCamera per frame, frame intervals after
//                                  the warm-up, optional culling verification
//   ?bench=<n>&samples=<n>&warmup=<n>
//                                  benchmark loop kept unchanged for
//                                  packages/engine/test/perf/run-perf.mjs
//   ?text=1                        P4-08 glyph-atlas demo: builds the runtime
//                                  atlas and draws a title and a body run at
//                                  world (32, 32), incl. Latin-1 letters and one
//                                  missing glyph (placeholder box); combine with
//                                  ?view=200,64,2 to look at it. Off by default,
//                                  so the scenes, baselines and perf runs stay
//                                  unchanged.
//   ?text=layout                   P4-09 layout demo: a title that fits, a title
//                                  cut with an ellipsis, a zone name in a wider
//                                  box and a wrapped preview clipped to three
//                                  lines; combine with ?scene=stress&count=0
//                                  &view=272,112,2 (the visual scene does).
//   ?input=demo                    L03 (P4-14) pointer demo on the layers scene:
//                                  one editable field and one scrollable area
//                                  inside block-0001's body; presses there start
//                                  no drag and the scroll area keeps its wheel.
//                                  Off by default, so no reference image changes.
//   ?text=titles                   P4-10 titles/previews demo: the page-owned
//                                  deterministic gallery (2 zones, 2 blocks,
//                                  4 cards) with zone names, ellipsis card
//                                  titles, wrapped/clipped block previews, the
//                                  40 px header chrome, a block grown to its
//                                  preview height and one quiet DOM delete
//                                  affordance per object (28 px hit, 16 px icon,
//                                  invisible at rest, visible on hover, focus and
//                                  selection). Off by default, so the scenes,
//                                  baselines and perf runs stay unchanged; the
//                                  visual scenes are ?text=titles&view=512,288,1
//                                  (100 %) and ?text=titles&view=512,240,2
//                                  (200 %).
//   ?text=overlapping              P6-15 depth-order demo: the page-owned
//                                  deterministic gallery (4 titled note cards on
//                                  a fixed 1024x576 world). The front card's
//                                  rectangle fully covers the title and preview
//                                  boxes of the card behind it, while the front
//                                  card's own title and preview stay on top; the
//                                  two outer cards stay readable. Off by default,
//                                  so the scenes, baselines and perf runs stay
//                                  unchanged; the visual scene is
//                                  ?text=overlapping&view=504,280,1 (100 %, the
//                                  atlas raster scale).
//
// Interaction (L03/P4-14): every pointer/wheel event goes through the single
// input layer in packages/engine/src/bridge/input.ts. A press moving less than
// the token 4 px threshold is a click and writes nothing; a note card drags on
// its whole body, a block or zone only on its 40 px header; fields, buttons,
// editable and scrollable targets never drag; a completed drag on the sample or
// layers scene is exactly one `drag-single` operation with its inverse through
// the P4-05 seam. An empty-canvas drag pans and a wheel or two-pointer pinch
// zooms around the pointer — both view-only `setCamera` calls. Cursor and the
// `--faint` block/zone header hover band are DOM chrome (ADR-0009). `f`
// ("show all", L19) fits the board through the engine's fit helper. The scene
// data never changes.
//
// On-demand rendering (L19): outside the benchmark and perf modes the page draws
// only after a camera, document or resize change and stops requestAnimationFrame
// while idle. `renderFrame` is called exactly once per change, so an idle canvas
// produces no frames; `window.__enginePlayground.frameCount()` and
// `getState().framesRendered` expose the rendered-frame counter for harnesses.
// The benchmark (`?bench=…`) and perf (`?perf=engine-core`) modes keep their own
// continuous loops unchanged, because the perf gate measures frame production.
//
// Ready hook: window.__enginePlayground.ready resolves once the first frame is
// drawn and the HUD is filled ({ ok: true, scene, objectCount, visibleCount }) or
// the engine failed to start ({ ok: false, error }), so harnesses can wait for it
// instead of sleeping. window.__enginePlayground.pause() stops the scheduler for
// a deterministic capture, fit() runs the L19 fit action and getState() reports
// the current view and the rendered-frame counter.
//
// View hook: `?view=<worldX>,<worldY>,<zoom>` places the given world point at the
// canvas centre at the given zoom (clamped to the engine camera range) for
// deterministic reference-image captures. It only calls setCamera; the scene data
// never changes. Without the parameter the page keeps its initial camera.
//
// Perf hook: window.__enginePerf exists in `?perf=engine-core` mode and reports
// the scene counts, warm-up and sample counts, frame intervals, the sampled
// cameras, the document load count and (in verify mode) the per-frame
// command-buffer instance count next to the visible set computed from geometry.

import { createEngine, EngineError } from "@project-air/engine";
import {
  createPointerInput,
  cursorForSuppressed,
  isSuppressedTarget,
  resizeMinimumFor,
  worldRectsIntersect,
} from "@project-air/engine/input.js";
import {
  keyboardIntent,
  NudgeSeries,
  escapePriority,
  ContextMenuModel,
  CONTEXT_MENU_WIDTH_PX,
  CONTEXT_MENU_ROW_PX,
  NUDGE_STEP_PX,
  HISTORY_HINT_MS,
  undoHintLabel,
} from "@project-air/engine/keyboard.js";
import {
  deviceKeyFor,
  loadView,
  saveView,
  safeBrowserStorage,
  storageKeyFor,
} from "@project-air/engine/view-persistence.js";
import {
  anchorToScreen,
  applyInlineKey,
  OverlayHost,
} from "@project-air/engine/overlay.js";
import {
  arrangeZone,
  previewZoneRelease,
  zoneOrientation,
  ZONE_HEADER_HEIGHT,
  ZONE_PADDING,
  zoneSettlePolicy,
} from "@project-air/engine/zone-parity.js";
import {
  defaultZoneTitle,
  headerGeometry,
  normalizeZoneTitle,
  planZoneGroup,
  zoneFrameLook,
  GROUP_OVERLAP,
  GROUP_POINTER_PX,
  ZONE_HEADER,
  ZONE_TITLE_MAX,
} from "@project-air/engine/zone-lifecycle.js";

const canvas = document.querySelector("#canvas");
const errorNode = document.querySelector("#error");
const captionNode = document.querySelector("#scene-caption");
const hudObjectsNode = document.querySelector("#hud-objects");
const hudCardsNode = document.querySelector("#hud-cards");
const hudZonesNode = document.querySelector("#hud-zones");
const hudVisibleNode = document.querySelector("#hud-visible");
const framesNode = document.querySelector("#frames");
const hudBackendNode = document.querySelector("#hud-backend");

if (
  !(canvas instanceof HTMLCanvasElement) ||
  !(errorNode instanceof HTMLElement) ||
  !(captionNode instanceof HTMLElement) ||
  !(hudObjectsNode instanceof HTMLElement) ||
  !(hudCardsNode instanceof HTMLElement) ||
  !(hudZonesNode instanceof HTMLElement) ||
  !(hudVisibleNode instanceof HTMLElement) ||
  !(framesNode instanceof HTMLElement) ||
  !(hudBackendNode instanceof HTMLElement)
) {
  throw new Error("engine-playground: expected #canvas, #scene-caption, #hud-* and #error");
}

// Deterministic benchmark document: 250 columns, 200 rows = 50,000 rectangles,
// world 8000 x 4500 (exactly 16:9, like the canvas, so the fitted view fills it).
// Kept unchanged for the perf harness and the P2-04 evidence.
const COLUMNS = 250;
const ROWS = 200;
const SPACING_X = 32;
const SPACING_Y = 22.5;
const RECTANGLE_WIDTH = 20;
const RECTANGLE_HEIGHT = 14;
const TONES = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];
const LAYERS = ["zones", "blocks", "note-cards"];

// Mirrors of the engine camera clamp; docs/engine.md states the values. The
// bridge has no camera query, so the page owns its own camera state.
const MINIMUM_ZOOM = 0.1;
const MAXIMUM_ZOOM = 8;

// Engine-core perf mode: one zoom cycle from the fit zoom to six times the fit
// zoom and back, plus one left-to-right pan sweep. Constants mirrored in
// docs/gates/perf.md and packages/engine/test/perf/run-perf.mjs.
const PERF_SCENARIO = "engine-core";
const PERF_ZOOM_CYCLE_FACTOR = 6;
const PERF_DEFAULT_SCENE = "engine-core";

// L13 layers scene (P4-06). The scene objects become contract entities with
// deterministic UUIDv7 ids, are added through the logic layer's document port and
// every "bring to front" is one `reorder` operation built and applied by the
// P4-05 seam; the page never writes a z value itself. The resulting keys are
// stored per scene object id, so a reload re-reads them.
const LAYERS_STORAGE_KEY = "engine-playground:layers:z";
const LAYERS_UUID_PREFIX = "0192f0c1-7000-7000-8000-";
const LAYERS_TIMESTAMP = "2026-10-27T12:00:00Z";
const FRACTIONAL_INDEX = /^[0-9A-Za-z]{1,64}$/;
const TAP_SLOP = 4;

// Counts the document loads: the perf harness asserts that the camera path
// moves the view (setCamera) without replacing the document or rebuilding the
// document's spatial index.
let documentLoads = 0;

const query = new URLSearchParams(window.location.search);
const benchQuery = query.get("bench");
const benchmarkRequested = benchQuery !== null;
const perfQuery = query.get("perf");
const perfRequested = perfQuery === "engine-core" && !benchmarkRequested;
const verifyCullingRequested = perfRequested && query.get("verifyCulling") === "1";
const textDemoRequested = query.get("text") === "1" && !benchmarkRequested && !perfRequested;
const textLayoutRequested =
  query.get("text") === "layout" && !benchmarkRequested && !perfRequested;
const titlesRequested =
  query.get("text") === "titles" && !benchmarkRequested && !perfRequested;
// P6-15: page-owned depth-order demo (a front card over a back card's text).
const overlappingRequested =
  query.get("text") === "overlapping" && !benchmarkRequested && !perfRequested;
// P4-28: deterministic stage showcase (engine-core capabilities, not a gate scene).
const showcaseRequested =
  query.get("showcase") === "1" && !benchmarkRequested && !perfRequested;
// L03 (P4-14) input demo: one editable field and one scrollable area inside a
// block body of the layers scene. Off by default, so no reference image changes.
const inputDemoRequested =
  query.get("input") === "demo" && !benchmarkRequested && !perfRequested;
// L18 (P4-23) inline comfort demo: DOM fields anchored over the layers scene.
// Off by default, so the reference images and the perf/idle harnesses are
// unchanged; it never writes board content.
const inlineDemoRequested =
  query.get("edit") === "inline" && !benchmarkRequested && !perfRequested;
// L08 (P4-29) zone parity demo: arrangement + release preview on the layers scene.
// L08 (P4-30) lifecycle + names demo (grouping, emptied-zone removal, rename).
const zoneLifecycleMode =
  ["demo", "grouping", "emptied", "names"].includes(query.get("zoneLifecycle") ?? "") &&
  !benchmarkRequested &&
  !perfRequested &&
  !inlineDemoRequested
    ? query.get("zoneLifecycle")
    : null;
// P4-13: backend switch. Default WebGL2 (the measured backend); an unknown value
// fails closed with an engine error, never silently.
const backendRequested = query.get("backend");
const zoneParityRequested =
  query.get("zoneParity") === "1" &&
  !benchmarkRequested &&
  !perfRequested &&
  !inlineDemoRequested;
const requestedCount = clampInteger(parseInteger(benchQuery, COLUMNS * ROWS), 0, 1000000);
const warmupFrames = clampInteger(parseInteger(query.get("warmup"), 120), 0, 10000);
const sampleFrames = clampInteger(parseInteger(query.get("samples"), 600), 1, 10000);
const benchmarkScene = benchmarkRequested ? createScene(requestedCount) : null;

const camera = { panX: 0, panY: 0, zoom: 1 };
const state = {
  scene: benchmarkRequested ? "benchmark" : "sample",
  counts: { cards: 0, zones: 0, blocks: 0 },
  objectCount: benchmarkScene === null ? 0 : benchmarkScene.rectangles.length,
  visibleCount: 0,
  backend: backendRequested === "webgpu" ? "WebGPU" : "WebGL2",
  backendReason: "ok",
  backendAdapter: null,
  backendFallback: false,
  stopped: false,
  textAtlas: null,
};
let zoomRange = { minimumZoom: MINIMUM_ZOOM, maximumZoom: MAXIMUM_ZOOM };
let world = { width: 1, height: 1 };

// On-demand rendering state (L19): at most one frame is scheduled at a time and
// the scheduler stops while idle. `onDemand` is armed only in the normal
// (non-benchmark, non-perf) mode; the benchmark and perf loops stay continuous.
let framesRendered = 0;
let frameScheduled = false;
// Set by the `?text=titles` scene: positions the DOM delete affordances next to
// their objects after every rendered frame.
let titlesOverlay = null;
// L03 (P4-14) pointer input: one state machine for click/drag/pan/zoom, the drag
// session of the loaded scene (sample or layers) and the DOM chrome it drives.
let pointerInput = null;
let sceneSession = null;
let headerSurface = null;
let inputDemo = null;
let hoverHeaderTarget = null;
let dragTokens = null;
// L10 (P4-16): repositions the DOM selection count bar after a camera change.
let selectionBarUpdate = null;
// L18 (P4-23): the inline-editing overlay demo (null outside `?edit=inline`).
let inlineDemo = null;
let pendingFrameHandle = 0;
const onDemand = {
  active: false,
  request: () => {},
  fit: () => {},
};

let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});
let readyResolved = false;

function settleReady(value) {
  if (readyResolved) {
    return;
  }
  readyResolved = true;
  resolveReady(value);
}

// The hook exists synchronously so a harness can await `ready` even while the
// module is still loading the scene and the WASM module. `frameCount()` is the
// rendered-frame counter the idle evidence samples; `pause()` stops the scheduler
// (the rendered frame stays on screen for the capture).
globalThis.__enginePlayground = {
  ready,
  pause: () => {
    state.stopped = true;
    if (pendingFrameHandle !== 0) {
      window.cancelAnimationFrame(pendingFrameHandle);
      pendingFrameHandle = 0;
    }
    frameScheduled = false;
  },
  getState: () => ({
    scene: state.scene,
    counts: { ...state.counts },
    objectCount: state.objectCount,
    visibleCount: state.visibleCount,
    framesRendered,
    backend: state.backend,
    requestedBackend: backendRequested === null ? "webgl2" : backendRequested,
    backendReason: state.backendReason,
    backendAdapter: state.backendAdapter === null ? null : { ...state.backendAdapter },
    backendFallback: state.backendFallback,
    camera: { ...camera },
    textAtlas: state.textAtlas === null ? null : { ...state.textAtlas },
  }),
  frameCount: () => framesRendered,
  // P4-13: requests one engine frame and waits three animation frames so a
  // WebGPU canvas (asynchronous GPU queue/presentation) is composited before a
  // screenshot; the visual harness captures only stable consecutive frames.
  settleFrame: () =>
    new Promise((resolve) => {
      onDemand.request();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))),
      );
    }),
  fit: () => {
    onDemand.fit();
  },
};

function parseInteger(raw, fallback) {
  if (raw === null) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? value : fallback;
}

function clampInteger(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function clampNumber(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

// Parses the deterministic capture camera `?view=<worldX>,<worldY>,<zoom>`.
// Returns null when the parameter is absent; invalid values fail closed instead
// of silently falling back to the fit camera, so a wrong view can never become a
// plausible reference image.
function parseViewQuery(raw) {
  if (raw === null) {
    return null;
  }
  const parts = raw.split(",").map((part) => Number(part));
  if (parts.length !== 3 || !parts.every((value) => Number.isFinite(value))) {
    throw new Error(
      `engine-playground: invalid ?view="${raw}"; expected "<worldX>,<worldY>,<zoom>"`,
    );
  }
  return { worldX: parts[0], worldY: parts[1], zoom: parts[2] };
}

function createScene(count) {
  const rectangles = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / COLUMNS);
    const column = index % COLUMNS;
    rectangles.push({
      x: column * SPACING_X,
      y: row * SPACING_Y,
      width: RECTANGLE_WIDTH,
      height: RECTANGLE_HEIGHT,
      tone: TONES[index % TONES.length],
      layer: LAYERS[Math.floor(index / 2000) % LAYERS.length],
    });
  }
  const rows = Math.max(Math.ceil(count / COLUMNS), 1);
  return {
    rectangles,
    worldWidth: COLUMNS * SPACING_X,
    worldHeight: rows * SPACING_Y,
  };
}

// L02 (P4-10) demo gallery of the `?text=titles` scene. The caller owns the
// text: the engine document stores no note content and no operation carries it
// (AD-4). The gallery is a deterministic demo board — no test-kit scene and no
// board state — laid out on the 16 px grid so the L02 rules are visible without
// overlapping content: 40 px zone/block headers with the title centred in them,
// zone content inset 40 + 16 px, a growing block preview, one normal and one cut
// title, one empty preview and the empty-preview edge case. Latin-1 letters
// (äöüé) exercise the atlas. Every value is a token-derived world geometry; the
// presentation text never changes the document; positions are on the 16 px grid
// and every chrome dimension comes from the engine's token geometry.
const GALLERY_WORLD = { width: 1024, height: 576 };

/** Deterministic titles gallery of the `?text=titles` scene. */
function buildTitlesGallery() {
  const objects = [
    {
      id: "zone-0001",
      kind: "zone",
      x: 32,
      y: 32,
      width: 448,
      height: 368,
      tone: "tone-b",
      layer: "zones",
      title: "Summer at Walensee",
      preview: "",
    },
    {
      id: "zone-0002",
      kind: "zone",
      x: 496,
      y: 32,
      width: 448,
      height: 368,
      tone: "tone-d",
      layer: "zones",
      title: "Hike from Z\u00fcrich to the Walensee with a night at the lake hut",
      preview: "",
    },
    {
      id: "block-0001",
      kind: "block",
      x: 48,
      y: 88,
      width: 416,
      height: 96,
      tone: "neutral",
      layer: "blocks",
      title: "Packing list",
      preview:
        "Tent, sleeping bag, mat, stove, water, caf\u00e9 au lait, tea and a warm jacket for the night by the lake. In the morning breakfast on the shore, then tidy up together and plan the trip home.",
    },
    {
      id: "block-0002",
      kind: "block",
      x: 512,
      y: 88,
      width: 416,
      height: 96,
      tone: "neutral",
      layer: "blocks",
      title: "Schedule",
      preview:
        "Meet at the station at nine, then walk to the shore together. Bring a picnic and go to the caf\u00e9 by the harbour if it rains.",
    },
    {
      id: "card-0001",
      kind: "card",
      x: 48,
      y: 256,
      width: 200,
      height: 112,
      tone: "tone-a",
      layer: "note-cards",
      title: "Moodboard",
      preview: "Photos, colours and references for the trip.",
    },
    {
      id: "card-0002",
      kind: "card",
      x: 264,
      y: 256,
      width: 200,
      height: 112,
      tone: "tone-c",
      layer: "note-cards",
      title: "Trip to the Walensee with a Z\u00fcrich stopover",
      preview:
        "Along the shore to the bridge, then back past M\u00fcller's farm. If it rains, the caf\u00e9 by the harbour.",
    },
    {
      id: "card-0003",
      kind: "card",
      x: 512,
      y: 256,
      width: 200,
      height: 112,
      tone: "tone-e",
      layer: "note-cards",
      title: "Caf\u00e9 notes for the trip",
      preview: "",
    },
    {
      id: "card-0004",
      kind: "card",
      x: 728,
      y: 256,
      width: 200,
      height: 112,
      tone: "neutral",
      layer: "note-cards",
      title: "Ideas",
      preview: "Short and sweet.",
    },
  ];
  const counts = { zones: 0, blocks: 0, cards: 0 };
  for (const object of objects) {
    if (object.kind === "zone") counts.zones += 1;
    else if (object.kind === "block") counts.blocks += 1;
    else counts.cards += 1;
  }
  return {
    name: "titles",
    objects,
    world: GALLERY_WORLD,
    counts: { ...counts, total: objects.length },
    camera: { minimumZoom: MINIMUM_ZOOM, maximumZoom: MAXIMUM_ZOOM },
  };
}

// P6-15 depth-order gallery of the `?text=overlapping` scene. Same page-owned
// pattern as the titles gallery: plain note-card rectangles bind their titles and
// previews through the engine and no document or operation carries text (AD-4).
// All four cards sit on the 16 px grid on the same fixed 1024x576 world. The front
// card (card-0003) is drawn after the back card (card-0002) and its rectangle
// 368..608 x 208..352 contains the back card's whole title and preview boxes
// 416..588 x 240..336 (the engine derives them from the 16 px padding, the 21 px
// title line box and the 28 + 8 px affordance reservation), so the depth-ordered
// text pass draws the back text below the front rectangle while the front card's
// own title and preview stay on top. The two outer cards stay unoccluded: their
// text is the control that the depth order never hides text no front object covers.
// Deterministic: fixed geometry, no randomness, no time, no animation.
const OVERLAPPING_WORLD = { width: 1024, height: 576 };

/** Deterministic overlapping titles gallery of the `?text=overlapping` scene. */
function buildOverlappingGallery() {
  const objects = [
    {
      id: "card-0001",
      kind: "card",
      x: 128,
      y: 224,
      width: 208,
      height: 128,
      tone: "tone-a",
      layer: "note-cards",
      title: "Moodboard",
      preview: "Photos, colours and references for the trip.",
    },
    {
      // The back card: its title and preview boxes are fully covered by card-0003.
      id: "card-0002",
      kind: "card",
      x: 400,
      y: 224,
      width: 240,
      height: 128,
      tone: "tone-c",
      layer: "note-cards",
      title: "Trip to the Walensee with a Z\u00fcrich stopover",
      preview:
        "Tent, sleeping bag, mat, stove, water, caf\u00e9 au lait, tea and a warm jacket for the night by the lake.",
    },
    {
      // The front card: drawn after card-0002, covering its title and preview.
      id: "card-0003",
      kind: "card",
      x: 368,
      y: 208,
      width: 240,
      height: 144,
      tone: "neutral",
      layer: "note-cards",
      title: "Packing list",
      preview:
        "Meet at the station at nine, walk to the shore, bring a picnic and return past M\u00fcller's farm before the rain.",
    },
    {
      id: "card-0004",
      kind: "card",
      x: 672,
      y: 224,
      width: 208,
      height: 128,
      tone: "tone-e",
      layer: "note-cards",
      title: "Caf\u00e9 notes",
      preview: "Table by the harbour if it rains.",
    },
  ];
  const counts = { zones: 0, blocks: 0, cards: 0 };
  for (const object of objects) {
    if (object.kind === "zone") counts.zones += 1;
    else if (object.kind === "block") counts.blocks += 1;
    else counts.cards += 1;
  }
  return {
    name: "overlapping",
    objects,
    world: OVERLAPPING_WORLD,
    counts: { ...counts, total: objects.length },
    camera: { minimumZoom: MINIMUM_ZOOM, maximumZoom: MAXIMUM_ZOOM },
  };
}

// The delete affordance is DOM chrome (ADR-0009), never a canvas glyph and never a
// character: the icon is an inline SVG in the ui-kit icon style (24 grid, stroke
// 1.6, currentColor, round caps). packages/ui-kit/icons has no delete entry yet;
// adding one would change packages/ui-kit/tests/icons.test.mjs, which is outside
// this task's write scope (board scope_write for P4-10).
const DELETE_ICON = [
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"',
  ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">',
  '<path d="M5 7h14"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 12.5h9L17.5 7"/></svg>',
].join("");

// Reads a px design token from the generated CSS custom properties instead of
// duplicating the value in code (AD-7, design rule §13).
function readTokenPixels(names) {
  const styles = getComputedStyle(document.documentElement);
  const values = {};
  for (const name of names) {
    const raw = styles.getPropertyValue(`--${name}`).trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`engine-playground: token --${name} is missing or not a pixel value`);
    }
    values[name] = value;
  }
  return values;
}

// Reads one generated CSS colour token (e.g. --accent) so the page never holds a
// raw colour value; the colour field starts from the accent token.
function readTokenColour(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const match = /^#([0-9a-f]{6})$/i.exec(raw);
  if (match === null) {
    throw new Error(`engine-playground: token --${name} is missing or not a hex colour`);
  }
  return raw.toLowerCase();
}

/**
 * Binds the gallery's presentation text through the engine's P4-10 binding (L02),
 * grows the blocks to their preview height and installs one quiet DOM delete
 * affordance per object in the overlay. Returns the overlay controller, or null
 * when the page has no overlay element.
 */
function installTitles(engine, loaded) {
  const overlay = document.querySelector("#overlay");
  if (!(overlay instanceof HTMLElement)) {
    return null;
  }
  state.textAtlas = engine.buildTextAtlas();
  const tokens = readTokenPixels(["button-card", "space-8"]);
  const objects = loaded.objects.map((object, slot) => ({
    id: object.id,
    kind: object.kind,
    slot,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    storedHeight: object.height,
    title: object.title,
    preview: object.preview,
    removed: false,
  }));
  for (const object of objects) {
    engine.bindObjectText(object.slot, { title: object.title, preview: object.preview });
  }
  // L02: a block grows to its preview height instead of gaining an inner
  // scrollbar. The height comes from the engine, which knows the token chrome and
  // the laid-out preview; the caller only applies it.
  for (const object of objects) {
    if (object.kind !== "block") {
      continue;
    }
    const required = engine.requiredTextHeight(object.slot);
    if (required > object.height) {
      // L02: grow the block to the preview height; the geometry write stays a
      // caller-side presentation change, the document stores no text (AD-4).
      engine.updateGeometry(object.slot, {
        x: object.x,
        y: object.y,
        width: object.width,
        height: required,
      });
      object.height = required;
    }
  }

  const actions = new Map();
  for (const object of objects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "object-action";
    button.dataset.objectId = object.id;
    button.setAttribute("aria-label", "Delete");
    button.setAttribute("data-label", "Delete");
    button.innerHTML = DELETE_ICON;
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      remove(object);
    });
    // The overlay is a sibling above the canvas, so moving onto a revealed
    // affordance fires the canvas `pointerleave`. Keep the object hovered from
    // here instead, otherwise the button would hide under the pointer the moment
    // it becomes clickable (the canvas pointerleave below ignores this target).
    button.addEventListener("pointerenter", () => {
      setHovered(object.id);
    });
    button.addEventListener("pointerleave", () => {
      setHovered(null);
    });
    overlay.append(button);
    actions.set(object.id, { object, button });
  }

  let hovered = null;
  let selected = null;

  const apply = () => {
    for (const [id, action] of actions) {
      action.button.classList.toggle(
        "is-visible",
        action.object.removed !== true && (hovered === id || selected === id),
      );
      action.button.hidden = action.object.removed === true;
    }
  };

  // The overlay sits exactly over the canvas; object world geometry is mapped
  // with the page's own camera, so a button follows its object on pan and zoom.
  const updatePositions = () => {
    const bounds = canvas.getBoundingClientRect();
    const engineWidth = Math.max(1, Math.round(bounds.width));
    const contentScale = canvas.clientWidth > 0 ? canvas.clientWidth / engineWidth : 1;
    for (const action of actions.values()) {
      if (action.object.removed === true) {
        continue;
      }
      const object = action.object;
      const right = (object.x + object.width - camera.panX) * camera.zoom;
      const top = (object.y - camera.panY) * camera.zoom;
      action.button.style.left = `${
        canvas.clientLeft + right * contentScale - tokens["button-card"] - tokens["space-8"]
      }px`;
      action.button.style.top = `${canvas.clientTop + top * contentScale + tokens["space-8"]}px`;
    }
  };

  const remove = (object) => {
    if (object.removed === true) {
      return;
    }
    object.removed = true;
    engine.removeObject(object.slot);
    if (hovered === object.id) {
      hovered = null;
    }
    if (selected === object.id) {
      selected = null;
    }
    apply();
    onDemand.request();
  };

  const setHovered = (id) => {
    if (hovered === id) {
      return;
    }
    hovered = id;
    apply();
  };

  // L03 (P4-14): hover, click and drag come from the page's single pointer input
  // layer; this controller only exposes the gallery object under a screen point
  // and applies the presentation state. No canvas pointer listener lives here.
  const targetAt = (screenX, screenY) => {
    const index = engine.hitTest(screenX, screenY);
    const object = objects.find((candidate) => candidate.slot === index);
    if (object === undefined || object.removed === true) {
      return null;
    }
    return {
      kind: object.kind,
      id: object.id,
      slot: object.slot,
      world: { x: object.x, y: object.y, width: object.width, height: object.height },
      draggable: false,
    };
  };

  const tapById = (id) => {
    selected = selected === id ? null : id;
    apply();
  };

  // Evidence hook: the capture tool reads the binding, atlas and affordance state
  // next to the images so the numbers and the pixels agree.
  globalThis.__engineTitles = {
    summary: () => ({
      mode: "titles",
      objects: objects.length,
      boundTitles: objects.filter((object) => object.title.length > 0).length,
      boundPreviews: objects.filter((object) => object.preview.length > 0).length,
      grownBlocks: objects.filter(
        (object) => object.kind === "block" && object.height > object.storedHeight,
      ).length,
      atlas: state.textAtlas === null ? null : { ...state.textAtlas },
      hovered,
      selected,
      deleteControls: [...actions.values()].filter((action) => action.object.removed !== true)
        .length,
    }),
  };

  updatePositions();
  return { update: updatePositions, targetAt, setHovered, tapById, remove };
}

async function loadScene() {
  if (overlappingRequested) {
    // P6-15: the overlapping gallery is the playground's own deterministic demo
    // board, so it needs no test-kit bundle and works in a harness copy as well.
    return buildOverlappingGallery();
  }
  if (titlesRequested || showcaseRequested) {
    // The titles gallery is the playground's own deterministic demo board; it
    // needs no test-kit bundle, so the scene works in a harness copy as well.
    return buildTitlesGallery();
  }
  if (benchmarkRequested && benchmarkScene !== null) {
    return {
      name: "benchmark",
      objects: benchmarkScene.rectangles,
      world: { width: benchmarkScene.worldWidth, height: benchmarkScene.worldHeight },
      counts: {
        zones: 0,
        blocks: 0,
        cards: benchmarkScene.rectangles.length,
        total: benchmarkScene.rectangles.length,
      },
    };
  }
  // Loaded dynamically: the benchmark mode must keep working in the perf
  // harness copy, which only carries the engine artefacts and never fetches
  // the test-kit bundle.
  const testKit = await import("@project-air/test-kit");
  const requestedScene = query.get("scene");
  const name = inlineDemoRequested
    ? "layers"
    : testKit.isSceneName(requestedScene)
      ? requestedScene
      : perfRequested
        ? PERF_DEFAULT_SCENE
        : "sample";
  const count = clampInteger(
    parseInteger(query.get("count"), testKit.STRESS_DEFAULT_OBJECT_COUNT),
    0,
    testKit.MAX_SCENE_OBJECT_COUNT,
  );
  const scene = testKit.buildScene(name, name === "stress" ? { count } : {});
  return {
    name: scene.metadata.name,
    objects: scene.objects,
    world: scene.metadata.world,
    counts: scene.metadata.counts,
    camera: scene.metadata.camera,
  };
}

function sceneCaption(loaded) {
  if (showcaseRequested) {
    return `${loaded.counts.total} objects — stage showcase: zones with titles and their members, card titles and previews bound by the engine, selection chrome on three objects, snap guides and the sharp text bucket at 200 %. Deterministic paused state for the P4-28 evidence; no board content is written by the capture.`;
  }
  if (titlesRequested) {
    return `${loaded.counts.total} objects — zone names, card titles cut with an ellipsis and block previews bound to the visible objects; blocks grow to their preview height and the delete affordance appears on hover, focus or selection.`;
  }
  if (overlappingRequested) {
    return `${loaded.counts.total} objects — P6-15 depth-order demo: the front note card fully covers the title and preview of the card behind it while its own title and preview stay on top; the two outer cards stay readable. Deterministic gallery, no board content is written.`;
  }
  if (inlineDemoRequested) {
    return `${loaded.counts.total} objects — L18 inline comfort demo: plain DOM fields anchored to the layers board. Click a field to edit it; Enter inserts a new entry below, Tab/Shift+Tab move through the fields, Backspace removes an empty entry, Esc closes the field. Nothing here writes board content.`;
  }
  if (inputDemoRequested && loaded.name === "layers") {
    return `${loaded.counts.total} objects — L03 input demo: drag a card body or a 40 px block/zone header to move one object as one operation; the block body below the header, the field and the scroll area start no drag, and the scroll area keeps its own wheel.`;
  }
  if (loaded.name === "layers") {
    return `${loaded.counts.total} objects — zones, blocks and note cards whose stored z contradicts the layers. Click an object to bring it to the front of its layer; reload keeps the order.`;
  }
  if (loaded.name === "benchmark") {
    return `Benchmark document: ${loaded.counts.total} rectangles.`;
  }
  return `${loaded.counts.total} objects — ${loaded.counts.cards} cards, ${loaded.counts.zones} zones, ${loaded.counts.blocks} blocks. Drag to pan, scroll or pinch to zoom.`;
}

function showError(error) {
  const message = error instanceof EngineError ? error.message : String(error);
  errorNode.hidden = false;
  errorNode.textContent = `engine could not start: ${message}`;
  console.error(error);
}

// Reads the actual WebGL backend (ANGLE/Metal vs SwiftShader) so a benchmark
// run can reject software rendering instead of reporting it as a pass.
function readRendererString() {
  const gl = canvas.getContext("webgl2");
  if (gl === null) {
    return "unavailable";
  }
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  if (extension === null) {
    return "unknown";
  }
  return String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL));
}

function screenPointOf(event) {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function layersUuid(sequence) {
  return `${LAYERS_UUID_PREFIX}${sequence.toString(16).padStart(12, "0")}`;
}

function readStoredKeys() {
  if (query.get("store") === "off") {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAYERS_STORAGE_KEY) ?? "{}");
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredKeys(keys) {
  if (query.get("store") === "off") {
    return;
  }
  try {
    window.localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage can be unavailable (private mode); the order then lasts one session.
  }
}

// Builds the contract entity of one scene object; the stored key wins when it is
// a valid fractional index, so an outdated or broken store never breaks the load.
function layersEntity(object, index, uuidOf, storedKeys) {
  const stored = storedKeys[object.id];
  const base = {
    id: uuidOf.get(object.id),
    boardId: layersUuid(0xb0a1),
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    z: typeof stored === "string" && FRACTIONAL_INDEX.test(stored) ? stored : object.z,
    createdAt: LAYERS_TIMESTAMP,
    updatedAt: LAYERS_TIMESTAMP,
  };
  const zoneId = object.parent === null ? {} : { zoneId: uuidOf.get(object.parent) };
  if (object.kind === "zone") {
    return { ...base, title: object.id };
  }
  if (object.kind === "block") {
    return { ...base, ...zoneId, type: "checklist" };
  }
  return { ...base, ...zoneId, noteId: layersUuid(0x700 + index) };
}

async function loadLayersDocument(engine, loaded) {
  const [{ applyOperation, buildOperation, keyAfter }, { createEngineDocumentPort }, { createHistory }] =
    await Promise.all([
      import("@project-air/engine/logic/operations.js"),
      import("@project-air/engine/logic/document-port.js"),
      import("@project-air/engine/logic/history.js"),
    ]);
  const uuidOf = new Map(loaded.objects.map((object, index) => [object.id, layersUuid(0x600 + index)]));
  const sceneIdOf = new Map([...uuidOf].map(([sceneId, uuid]) => [uuid, sceneId]));
  const toneOf = new Map(loaded.objects.map((object) => [uuidOf.get(object.id), object.tone]));
  const port = createEngineDocumentPort(engine, { toneOf: (kind, id) => toneOf.get(id) ?? "neutral" });
  const storedKeys = readStoredKeys();
  loaded.objects.forEach((object, index) => {
    port.add(object.kind, layersEntity(object, index, uuidOf, storedKeys));
  });
  const history = createHistory(port);
  let operationCount = 0;
  const context = {
    boardId: layersUuid(0xb0a1),
    actorId: layersUuid(0xac01),
    createOperationId: () => layersUuid(0x10000 + operationCount),
    now: () => LAYERS_TIMESTAMP,
  };
  const keys = () =>
    Object.fromEntries(
      loaded.objects.map((object) => [object.id, port.read(object.kind, uuidOf.get(object.id))?.z ?? object.z]),
    );
  const front = (sceneId) => {
    const object = loaded.objects.find((candidate) => candidate.id === sceneId);
    if (object === undefined) {
      return null;
    }
    const pair = buildOperation(port, context, {
      kind: "bring-to-front",
      objectKind: object.kind,
      objectId: uuidOf.get(sceneId),
    });
    if (pair === null) {
      return null;
    }
    operationCount += 1;
    applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    writeStoredKeys(keys());
    // A document change requests exactly one frame (on-demand rendering, L19),
    // whichever path (click, ?front, evidence hook) brought the object forward.
    onDemand.request();
    return pair.operation;
  };
  const frontAt = (screenX, screenY) => {
    const hit = port.objectAt(engine.hitTest(screenX, screenY));
    return hit === undefined ? null : front(sceneIdOf.get(hit.id));
  };
  // Evidence hook: the browser run reads the keys and drives the same front path.
  globalThis.__engineLayers = {
    keys,
    front,
    frontAt,
    undo: () => {
      const undone = history.undo();
      writeStoredKeys(keys());
      onDemand.request();
      return undone;
    },
  };
  // L03 (P4-14): a completed drag on this board goes through the same document
  // port and history: preview while dragging, then exactly one `drag-single`
  // operation on release. The click path (front) stays the L13 behaviour.
  const session = createDragSession({
    engine,
    port,
    context,
    history,
    seam: { buildOperation, applyOperation },
    operations: { keyAfter },
    entries: loaded.objects.map((object) => ({ kind: object.kind, id: uuidOf.get(object.id) })),
    sceneIdOf,
    onTap: (target) => {
      front(sceneIdOf.get(target.id) ?? null);
    },
    zoneParity: zoneParityRequested,
  });
  return { front, frontAt, session };
}

// Shared drag session over one `DocumentPort`. This is the only place a drag
// becomes an operation: `preview` moves the rectangle through the bridge without a
// document write, `commit` builds exactly one `drag-single` gesture with
// `buildOperation`, applies it through the port and pushes the pair onto the
// P4-05 history, and `revert` restores a cancelled drag. The numbers stay token
// values; the input layer owns the threshold and grip rules.
function createDragSession({ engine, port, context, history, seam, entries, sceneIdOf, onTap, zoneParity = false, operations = null }) {
  const targetAt = (screenX, screenY) => {
    const slot = engine.hitTest(screenX, screenY);
    const hit = port.objectAt(slot);
    if (hit === undefined) {
      return null;
    }
    const entity = port.read(hit.kind, hit.id);
    if (entity === undefined) {
      return null;
    }
    return {
      kind: hit.kind,
      id: hit.id,
      slot,
      world: { x: entity.x, y: entity.y, width: entity.width, height: entity.height },
      draggable: true,
    };
  };
  const preview = (target, position) => {
    engine.updateGeometry(target.slot, {
      x: position.x,
      y: position.y,
      width: target.world.width,
      height: target.world.height,
    });
    onDemand.request();
  };
  const revert = (target) => {
    const entity = port.read(target.kind, target.id);
    if (entity === undefined) {
      return;
    }
    engine.updateGeometry(target.slot, {
      x: entity.x,
      y: entity.y,
      width: entity.width,
      height: entity.height,
    });
    onDemand.request();
  };
  let lastPair = null;
  let lastDrop = null;
  let lastDelete = null;
  let highlightSlot = null;
  let highlightUntil = 0;
  // L08 (P4-27): live zones in world px (bottom to top), and the drop policy:
  // a card/block whose centre lands inside the topmost zone becomes its member
  // (the move payload carries the parent; no separate write).
  const zoneTargets = () => {
    const zones = [];
    for (const entry of entries) {
      if (entry.kind !== "zone") {
        continue;
      }
      const target = targetOf(entry);
      if (target !== null) {
        zones.push(target);
      }
    }
    return zones;
  };
  const dropZoneId = (target, position) => {
    if (target.kind === "zone") {
      return undefined; // zones never nest (v1)
    }
    const cx = position.x + target.world.width / 2;
    const cy = position.y + target.world.height / 2;
    let found = null;
    for (const zone of zoneTargets()) {
      const { x, y, width, height } = zone.world;
      if (cx >= x && cx <= x + width && cy >= y && cy <= y + height) {
        found = zone;
      }
    }
    return found === null ? null : found.id;
  };
  const requestHighlightFrames = () => {
    const tick = () => {
      onDemand.request();
      if (performance.now() < highlightUntil) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  };
  const commit = (target, position) => {
    if (target.kind === "zone") {
      // L08: dragging a zone moves it and all its members as exactly one group
      // operation (never one operation per member).
      const deltaX = position.x - target.world.x;
      const deltaY = position.y - target.world.y;
      const members = port.members(target.id);
      const groupMembers = [
        { objectKind: "zone", objectId: target.id, position },
        ...members.cards.map((card) => ({
          objectKind: "card",
          objectId: card.id,
          position: { x: card.x + deltaX, y: card.y + deltaY },
        })),
        ...members.blocks.map((block) => ({
          objectKind: "block",
          objectId: block.id,
          position: { x: block.x + deltaX, y: block.y + deltaY },
        })),
      ];
      lastDrop = null;
      const pair = seam.buildOperation(port, context, { kind: "drag-group", members: groupMembers });
      if (pair === null) {
        return;
      }
      seam.applyOperation(port, pair.operation);
      history.push(pair.operation, pair.inverse);
      lastPair = pair;
      onDemand.request();
      return;
    }
    const zoneId = dropZoneId(target, position);
    const gesture = {
      kind: "drag-single",
      objectKind: target.kind,
      objectId: target.id,
      position,
    };
    if (zoneId !== undefined) {
      gesture.zoneId = zoneId;
    }
    const pair = seam.buildOperation(port, context, gesture);
    if (pair === null) {
      return;
    }
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    lastPair = pair;
    lastDrop = {
      zoneId,
      operation: pair.operation.type,
      inverse: pair.inverse.type,
      highlighted: typeof zoneId === "string",
    };
    if (typeof zoneId === "string") {
      const zone = zoneTargets().find((candidate) => candidate.id === zoneId);
      if (zone !== undefined) {
        engine.setZoneHighlight(zone.slot);
        highlightSlot = zone.slot;
        highlightUntil = performance.now() + 1000;
        requestHighlightFrames();
      }
    }
    onDemand.request();
  };
  // L10 (P4-16): target of one entry with the current working-copy geometry.
  const targetOf = (entry) => {
    const entity = port.read(entry.kind, entry.id);
    const slot = port.slotOf(entry.kind, entry.id);
    if (entity === undefined || slot === undefined) {
      return null;
    }
    return {
      kind: entry.kind,
      id: entry.id,
      slot,
      world: { x: entity.x, y: entity.y, width: entity.width, height: entity.height },
      draggable: true,
    };
  };
  // P4-19 (L20): placement of new objects. The pure placement function lives in
  // the logic package; the playground passes the result here and this builds
  // exactly one `create` operation (createCard) at that position through the seam.
  const newUuidV7 = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const timestamp = Date.now();
    bytes[0] = (timestamp / 2 ** 40) & 0xff;
    bytes[1] = (timestamp / 2 ** 32) & 0xff;
    bytes[2] = (timestamp / 2 ** 24) & 0xff;
    bytes[3] = (timestamp / 2 ** 16) & 0xff;
    bytes[4] = (timestamp / 2 ** 8) & 0xff;
    bytes[5] = timestamp & 0xff;
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const visibleObjects = () => {
    const objects = [];
    for (const entry of entries) {
      const target = targetOf(entry);
      if (target !== null) {
        objects.push({ x: target.world.x, y: target.world.y, width: target.world.width, height: target.world.height });
      }
    }
    return objects;
  };
  const addCardAt = (position, size) => {
    const zIndices = port.zIndices("card");
    let z = "0";
    for (const key of zIndices) {
      if (key > z) {
        z = key;
      }
    }
    z = operations !== null ? operations.keyAfter(z) : `${z}a`;
    const draft = {
      kind: "card",
      id: newUuidV7(),
      noteId: newUuidV7(),
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      z,
    };
    const pair = seam.buildOperation(port, context, { kind: "create", draft });
    if (pair === null) {
      return null;
    }
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    recordPair(pair);
    entries.push({ kind: "card", id: draft.id });
    onDemand.request();
    return { operationId: pair.operation.id, objectId: draft.id, position: { x: draft.x, y: draft.y }, size: { width: draft.width, height: draft.height } };
  };
  const duplicateTargets = (targets) => {
    if (targets.length !== 1) {
      return null;
    }
    const target = targets[0];
    const entity = port.read(target.kind, target.id);
    if (entity === undefined) {
      return null;
    }
    const zIndices = port.zIndices(target.kind);
    let z = "0";
    for (const key of zIndices) { if (key > z) z = key; }
    z = operations !== null ? operations.keyAfter(z) : `${z}a`;
    const draft = target.kind === "card"
      ? { kind: "card", id: newUuidV7(), noteId: entity.noteId, x: entity.x + NUDGE_STEP_PX, y: entity.y + NUDGE_STEP_PX, width: entity.width, height: entity.height, z }
      : target.kind === "block"
        ? { kind: "block", id: newUuidV7(), type: entity.type, x: entity.x + NUDGE_STEP_PX, y: entity.y + NUDGE_STEP_PX, width: entity.width, height: entity.height, z }
        : { kind: "zone", id: newUuidV7(), title: entity.title, x: entity.x + NUDGE_STEP_PX, y: entity.y + NUDGE_STEP_PX, width: entity.width, height: entity.height };
    const pair = seam.buildOperation(port, context, { kind: "create", draft });
    if (pair === null) return null;
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    recordPair(pair);
    entries.push({ kind: draft.kind, id: draft.id });
    onDemand.request();
    return { operationId: pair.operation.id, objectId: draft.id, kind: draft.kind, offset: { x: NUDGE_STEP_PX, y: NUDGE_STEP_PX } };
  };
  const nudgeTargets = (targets, delta) => {
    if (targets.length === 0) return null;
    if (targets.length === 1) {
      const target = targets[0];
      const pair = seam.buildOperation(port, context, { kind: "keyboard-nudge", objectKind: target.kind, objectId: target.id, delta });
      if (pair === null) return null;
      seam.applyOperation(port, pair.operation);
      history.push(pair.operation, pair.inverse);
      recordPair(pair);
      onDemand.request();
      return { operationId: pair.operation.id, kind: "keyboard-nudge", delta };
    }
    const pair = seam.buildOperation(port, context, { kind: "drag-group", members: targets.map((target) => ({ objectKind: target.kind, objectId: target.id, position: { x: target.world.x + delta.x, y: target.world.y + delta.y } })) });
    if (pair === null) return null;
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    recordPair(pair);
    onDemand.request();
    return { operationId: pair.operation.id, kind: "drag-group", delta };
  };
  // L10: current geometry of the selected ids (the joint drag and the count bar).
  const selectionTargets = (ids) => {
    const wanted = ids === undefined ? null : new Set(ids);
    const targets = [];
    for (const entry of entries) {
      if (wanted !== null && !wanted.has(entry.id)) {
        continue;
      }
      const target = targetOf(entry);
      if (target !== null) {
        targets.push(target);
      }
    }
    return targets;
  };
  // L10 rubber band: the world-space intersect rule (bounds intersection, not
  // containment) over the live entries of the scene.
  const targetsInRect = (rect) => {
    const targets = [];
    for (const entry of entries) {
      const target = targetOf(entry);
      if (target === null) {
        continue;
      }
      if (worldRectsIntersect(target.world, rect)) {
        targets.push(target);
      }
    }
    return targets;
  };
  const recordPair = (pair) => {
    lastPair = pair;
  };
  const lastOperation = () => {
    if (lastPair === null) {
      return null;
    }
    const operation = lastPair.operation;
    return {
      operation: operation.type,
      inverse: lastPair.inverse.type,
      children:
        operation.type === "group"
          ? operation.payload.children.map((child) => child.type)
          : undefined,
    };
  };
  const previewGroup = (members) => {
    for (const member of members) {
      engine.updateGeometry(member.target.slot, {
        x: member.position.x,
        y: member.position.y,
        width: member.target.world.width,
        height: member.target.world.height,
      });
    }
    onDemand.request();
  };
  const revertGroup = (members) => {
    for (const member of members) {
      const entity = port.read(member.target.kind, member.target.id);
      if (entity === undefined) {
        continue;
      }
      engine.updateGeometry(member.target.slot, {
        x: entity.x,
        y: entity.y,
        width: entity.width,
        height: entity.height,
      });
    }
    onDemand.request();
  };
  // L10: one joint drag = exactly one drag-group gesture / group operation.
  const commitGroup = (members) => {
    const pair = seam.buildOperation(port, context, {
      kind: "drag-group",
      members: members.map((member) => ({
        objectKind: member.target.kind,
        objectId: member.target.id,
        position: member.position,
      })),
    });
    if (pair === null) {
      return;
    }
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    recordPair(pair);
    onDemand.request();
  };
  // L10/L08: delete the selection as one operation with inverse; a selected zone
  // deletes with its content policy ("keep" by default, L08/P4-27).
  const deleteTargets = (targets, zonePolicy = "keep") => {
    const members = [];
    const seen = new Set();
    for (const target of targets) {
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      members.push({ objectKind: target.kind, objectId: target.id });
    }
    if (members.length === 0) {
      return 0;
    }
    const pair = seam.buildOperation(port, context, {
      kind: "delete-selection",
      members,
      zonePolicy,
    });
    if (pair === null) {
      return 0;
    }
    lastDelete = {
      zonePolicy,
      operation: pair.operation.type,
      inverse: pair.inverse.type,
      children: pair.operation.type === "group" ? pair.operation.payload.children.map((child) => child.type) : [],
      policies:
        pair.operation.type === "group"
          ? pair.operation.payload.children.map((child) => (child.type === "deleteZone" ? child.payload.policy : null))
          : [],
    };
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    recordPair(pair);
    onDemand.request();
    return members.length;
  };
  // L08 (P4-29): zone parity preview + one-operation arrangement release. The
  // preview is presentation state (never a document write); only the release
  // builds one `zone-arrange` group operation with its inverse.
  let zonePreview = null;
  let zoneParityRender = null;
  let lastZoneRelease = null;
  const setZoneParityRenderer = (render) => {
    zoneParityRender = render;
  };
  const clearZonePreview = () => {
    if (zonePreview === null) {
      return;
    }
    zonePreview = null;
    zoneParityRender?.(null);
  };
  const zoneMembers = (zoneId) => {
    const members = port.members(zoneId);
    return [
      ...members.cards.map((card) => ({
        objectKind: "card",
        objectId: card.id,
        width: card.width,
        height: card.height,
      })),
      ...members.blocks.map((block) => ({
        objectKind: "block",
        objectId: block.id,
        width: block.width,
        height: block.height,
      })),
    ];
  };
  const visibleWorld = () => ({
    width: Math.max(1, (canvas?.clientWidth ?? 1000) / Math.max(0.0001, camera.zoom)),
    height: Math.max(1, (canvas?.clientHeight ?? 700) / Math.max(0.0001, camera.zoom)),
  });
  const previewZoneDrag = (target, position) => {
    if (!zoneParity || target.kind === "zone") {
      return null;
    }
    const dragged = { x: position.x, y: position.y, width: target.world.width, height: target.world.height };
    const pointer = { x: position.x + target.world.width / 2, y: position.y + target.world.height / 2, width: target.world.width, height: target.world.height };
    let zone = null;
    let coverage = 0;
    for (const candidate of zoneTargets()) {
      const frame = candidate.world;
      const overX = Math.max(0, Math.min(pointer.x, frame.x + frame.width) - Math.max(pointer.x, frame.x));
      const overY = Math.max(0, Math.min(pointer.y, frame.y + frame.height) - Math.max(pointer.y, frame.y));
      coverage = (overX * overY) / Math.max(1, frame.width * frame.height);
      const inside = pointer.x >= frame.x && pointer.x <= frame.x + frame.width && pointer.y >= frame.y && pointer.y <= frame.y + frame.height;
      if (inside || coverage >= 0.25) {
        zone = candidate;
        break;
      }
    }
    if (zone === null && zonePreview === null) {
      // The drag started inside a zone: use that frame so the first move that
      // already leaves the frame previews the detach instead of doing nothing.
      const startX = target.world.x + target.world.width / 2;
      const startY = target.world.y + target.world.height / 2;
      for (const candidate of zoneTargets()) {
        const frame = candidate.world;
        if (startX >= frame.x && startX <= frame.x + frame.width && startY >= frame.y && startY <= frame.y + frame.height) {
          zone = candidate;
          break;
        }
      }
    }
    if (zone === null) {
      if (zonePreview === null) {
        return null;
      }
      const state = previewZoneRelease({
        zoneFrame: zonePreview.zoneFrame,
        pointer,
        dragged,
        dragStart: zonePreview.dragStart,
        previewing: true,
        coverage: 0,
        currentOrientation: zonePreview.orientation,
        desiredOrientation: zonePreview.orientation,
        zoom: camera.zoom,
      });
      zonePreview = { ...zonePreview, ...state };
      zoneParityRender?.(zonePreview);
      return zonePreview;
    }
    const others = zoneMembers(zone.id).filter((member) => member.objectId !== target.id);
    const all = [{ objectKind: target.kind, objectId: target.id, width: target.world.width, height: target.world.height }, ...others];
    const frameCentreX = zone.world.x + zone.world.width / 2;
    const frameCentreY = zone.world.y + zone.world.height / 2;
    const offsets = all.map((member, index) => {
      const current = index === 0 ? pointer : (() => {
        const info = others[index - 1];
        const entity = port.read(info.objectKind, info.objectId);
        return { x: (entity?.x ?? centreFallback(zone)[0]) + member.width / 2, y: (entity?.y ?? centreFallback(zone)[1]) + member.height / 2 };
      })();
      return { ...member, offsetX: current.x - frameCentreX, offsetY: current.y - frameCentreY, order: index };
    });
    const currentOrientation = zonePreview?.orientation ?? "vertical";
    const desired = zoneOrientation(offsets, currentOrientation);
    const arrangement = arrangeZone(
      all.map((member) => ({ id: member.objectId, width: member.width, height: member.height })),
      desired,
      visibleWorld(),
    );
    const dragStart = zonePreview?.dragStart ?? { x: position.x, y: position.y };
    const state = previewZoneRelease({
      zoneFrame: zone.world,
      pointer,
      dragged,
      dragStart,
      previewing: zonePreview !== null,
      coverage,
      currentOrientation,
      desiredOrientation: arrangement.orientation,
      zoom: camera.zoom,
    });
    zonePreview = {
      ...state,
      zoneId: zone.id,
      zoneFrame: zone.world,
      draggedId: target.id,
      orientation: arrangement.orientation,
      dragStart,
      arrangement,
      order: all.map((member) => member.objectId),
    };
    zoneParityRender?.(zonePreview);
    return zonePreview;
  };
  const centreFallback = (zone) => [zone.world.x + zone.world.width / 2, zone.world.y + zone.world.height / 2];
  const commitZoneArrangement = () => {
    if (zonePreview === null || zonePreview.arrangement === undefined || zonePreview.zoneId === undefined) {
      return false;
    }
    const preview = zonePreview;
    const zone = port.read("zone", preview.zoneId);
    if (zone === undefined) {
      clearZonePreview();
      return true;
    }
    const members = preview.order.map((objectId, index) => {
      const placement = preview.arrangement.placements[index];
      const kind = preview.order[index] === preview.draggedId ? (entries.find((entry) => entry.id === objectId)?.kind ?? "card") : (entries.find((entry) => entry.id === objectId)?.kind ?? "card");
      return {
        objectKind: kind,
        objectId,
        position: {
          x: zone.x + ZONE_PADDING + (placement?.x ?? 0),
          y: zone.y + ZONE_HEADER_HEIGHT + ZONE_PADDING + (placement?.y ?? 0),
        },
      };
    });
    const pair = seam.buildOperation(port, context, {
      kind: "zone-arrange",
      zoneId: preview.zoneId,
      size: { width: preview.arrangement.frame.width, height: preview.arrangement.frame.height },
      members,
    });
    if (pair === null) {
      clearZonePreview();
      return true;
    }
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    recordPair(pair);
    lastZoneRelease = {
      operation: pair.operation.type,
      inverse: pair.inverse.type,
      children: pair.operation.payload.children.map((child) => child.type),
      zoneId: preview.zoneId,
    };
    onDemand.request();
    clearZonePreview();
    return true;
  };
  // Deterministic at-rest demo: arrange the members of the first filled zone and
  // leave a landing-slot preview visible for the visual/diff capture.
  const arrangeZoneDemo = () => {
    const zone = zoneTargets().find((candidate) => zoneMembers(candidate.id).length >= 2) ?? zoneTargets()[0];
    if (zone === undefined) {
      return null;
    }
    const members = zoneMembers(zone.id);
    const arrangement = arrangeZone(
      members.map((member) => ({ id: member.objectId, width: member.width, height: member.height })),
      "vertical",
      visibleWorld(),
    );
    const pair = seam.buildOperation(port, context, {
      kind: "zone-arrange",
      zoneId: zone.id,
      size: { width: arrangement.frame.width, height: arrangement.frame.height },
      members: arrangement.placements.map((placement, index) => ({
        objectKind: members[index].objectKind,
        objectId: members[index].objectId,
        position: {
          x: zone.world.x + ZONE_PADDING + placement.x,
          y: zone.world.y + ZONE_HEADER_HEIGHT + ZONE_PADDING + placement.y,
        },
      })),
    });
    if (pair !== null) {
      seam.applyOperation(port, pair.operation);
      history.push(pair.operation, pair.inverse);
      recordPair(pair);
      lastZoneRelease = {
        operation: pair.operation.type,
        inverse: pair.inverse.type,
        children: pair.operation.payload.children.map((child) => child.type),
        zoneId: zone.id,
      };
      onDemand.request();
    }
    const moved = targetOf(entries.find((entry) => entry.id === zone.id)) ?? zone;
    const landing = {
      x: moved.world.x + ZONE_PADDING + 8,
      y: moved.world.y + ZONE_HEADER_HEIGHT + ZONE_PADDING + 8,
      width: 96,
      height: 48,
    };
    zoneParityRender?.({
      kind: "dock",
      inside: true,
      frame: { ...moved.world, width: arrangement.frame.width, height: arrangement.frame.height },
      landing,
      shrinking: false,
      makeRoom: true,
    });
    return { zoneId: zone.id, arrangement };
  };
  if (zoneParity) {
    globalThis.__zoneParity = {
      state: () => ({
        preview: zonePreview,
        release: lastZoneRelease,
        zones: zoneState().zones,
        objects: entries
          .filter((entry) => port.read(entry.kind, entry.id) !== undefined)
          .map((entry) => {
            const entity = port.read(entry.kind, entry.id);
            return { kind: entry.kind, id: entry.id, zoneId: entity.zoneId ?? null, world: { x: entity.x, y: entity.y, width: entity.width, height: entity.height } };
          }),
      }),
      // The browser port has no in-memory snapshot; a canonical per-object JSON of
      // the live working copy is enough to prove a cancel wrote nothing.
      snapshot: () =>
        JSON.stringify(
          entries
            .filter((entry) => port.read(entry.kind, entry.id) !== undefined)
            .map((entry) => ({ kind: entry.kind, id: entry.id, entity: port.read(entry.kind, entry.id) }))
            .sort((left, right) => (left.kind + left.id < right.kind + right.id ? -1 : 1)),
        ),
      arrange: arrangeZoneDemo,
      clearPreview: clearZonePreview,
      settle: () => zoneSettlePolicy(matchMedia("(prefers-reduced-motion: reduce)").matches),
    };
  }

  // L08 (P4-30) lifecycle + names: session operations (one operation each) and
  // the deterministic demo states. Frames/fields below are presentation only.
  let lifecycleRender = null;
  let lifecycleCounter = 0;
  let lastLifecycle = null;
  const setLifecycleRenderer = (render) => {
    lifecycleRender = render;
  };
  const lifecycleFreeObjects = () =>
    entries
      .filter((entry) => entry.kind !== "zone")
      .map((entry) => {
        const entity = port.read(entry.kind, entry.id);
        return entity === undefined ? null : { objectKind: entry.kind, objectId: entry.id, world: { x: entity.x, y: entity.y, width: entity.width, height: entity.height }, zoneId: entity.zoneId ?? null };
      })
      .filter((object) => object !== null && object.zoneId === null);
  const lifecycleZones = () =>
    zoneTargets().map((zone) => {
      const entity = port.read("zone", zone.id);
      return { id: zone.id, slot: zone.slot, title: entity?.title ?? "", world: zone.world, members: zoneMembers(zone.id) };
    });
  const applyLifecycle = (pair, record) => {
    if (pair === null) {
      return null;
    }
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    recordPair(pair);
    lastLifecycle = record;
    onDemand.request();
    return { operation: pair.operation.type, inverse: pair.inverse.type, payload: record };
  };
  const detachAllZones = () => {
    const results = [];
    for (const zone of lifecycleZones()) {
      const pair = seam.buildOperation(port, context, { kind: "delete-zone", zoneId: zone.id, policy: "keep" });
      const record = applyLifecycle(pair, { kind: "emptied-zone-removal", zoneId: zone.id });
      if (record !== null) {
        results.push(record);
      }
    }
    return results;
  };
  const removeAllMembers = (zoneId) => {
    const members = zoneMembers(zoneId);
    const pair = seam.buildOperation(port, context, {
      kind: "delete-selection",
      members: members.map((member) => ({ objectKind: member.objectKind, objectId: member.objectId })),
    });
    return applyLifecycle(pair, { kind: "remove-members", zoneId });
  };
  const removeEmptyZones = () => {
    const results = [];
    for (const zone of lifecycleZones()) {
      if (zone.members.length > 0) {
        continue;
      }
      const pair = seam.buildOperation(port, context, { kind: "delete-zone", zoneId: zone.id, policy: "keep" });
      const record = applyLifecycle(pair, { kind: "emptied-zone-removal", zoneId: zone.id });
      if (record !== null) {
        results.push(record);
      }
    }
    return results;
  };
  const renameZone = (zoneId, rawTitle, language = "en") => {
    const entity = port.read("zone", zoneId);
    if (entity === undefined) {
      return null;
    }
    const normalized = normalizeZoneTitle(rawTitle, language);
    const pair = seam.buildOperation(port, context, { kind: "zone-rename", zoneId, title: normalized.title });
    const applied = applyLifecycle(pair, { kind: "zone-rename", zoneId, previousTitle: entity.title });
    return { title: normalized.title, changed: normalized.changed, applied };
  };
  const groupTwo = (objectA, objectB, title = defaultZoneTitle("en")) => {
    const a = lifecycleFreeObjects().find((object) => object.objectId === objectA);
    const b = lifecycleFreeObjects().find((object) => object.objectId === objectB);
    if (a === undefined || b === undefined) {
      return null;
    }
    const layout = planZoneGroup([a.world, b.world].map((world, index) => ({ id: index === 0 ? a.objectId : b.objectId, ...world })), null, "vertical", visibleWorld());
    const newZoneId = layersUuid(0x51000 + lifecycleCounter);
    lifecycleCounter += 1;
    const pair = seam.buildOperation(port, context, {
      kind: "zone-group",
      newZoneId,
      title,
      frame: layout.frame,
      members: layout.members.map((member) => ({ objectKind: member.id === a.objectId ? a.objectKind : b.objectKind, objectId: member.id, position: { x: member.x, y: member.y } })),
    });
    const applied = applyLifecycle(pair, { kind: "group", zoneId: newZoneId, title });
    if (applied !== null && !entries.some((entry) => entry.id === newZoneId)) {
      entries.push({ kind: "zone", id: newZoneId });
    }
    return applied === null ? null : { zoneId: newZoneId, title, layout, applied };
  };
  globalThis.__zoneLifecycle = {
    state: () => ({
      zones: lifecycleZones(),
      freeObjects: lifecycleFreeObjects(),
      lastLifecycle,
      header: headerGeometry(1),
      titleMax: ZONE_TITLE_MAX,
      thresholds: { overlap: GROUP_OVERLAP, pointer: GROUP_POINTER_PX, contact: 32 },
      look: zoneFrameLook({ grouping: false, memberCount: lifecycleZones().reduce((sum, zone) => sum + zone.members.length, 0), lastMemberLeaving: false }),
    }),
    detachAllZones,
    removeAllMembers,
    removeEmptyZones,
    renameZone,
    groupTwo,
    normalizeTitle: (raw, language) => normalizeZoneTitle(raw, language),
    defaultTitle: (language) => defaultZoneTitle(language),
    snapshot: () =>
      JSON.stringify(
        entries
          .filter((entry) => port.read(entry.kind, entry.id) !== undefined)
          .map((entry) => ({ kind: entry.kind, id: entry.id, entity: port.read(entry.kind, entry.id) }))
          .sort((left, right) => (left.kind + left.id < right.kind + right.id ? -1 : 1)),
      ),
  };
  const setLifecycleRender = (render) => setLifecycleRenderer(render);
  const renderLifecycle = (state) => lifecycleRender?.(state);

  // P4-17 (L14) resize: preview through the bridge geometry update, one resize
  // gesture per release (a group with the anchoring move for west/north handles),
  // and the clamped minimum per type and, for a zone, its member extent + 16 px.
  const resizeMinimum = (target) => {
    if (target.kind === "card") {
      return resizeMinimumFor("card");
    }
    if (target.kind === "zone") {
      const members = port.members(target.id);
      return resizeMinimumFor("zone", "checklist", [
        ...members.cards.map((card) => ({ x: card.x, y: card.y, width: card.width, height: card.height })),
        ...members.blocks.map((block) => ({ x: block.x, y: block.y, width: block.width, height: block.height })),
      ]);
    }
    const entity = port.read("block", target.id);
    return resizeMinimumFor("block", entity?.type ?? "checklist");
  };
  const previewResize = (target, rect) => {
    engine.updateGeometry(target.slot, rect);
    onDemand.request();
  };
  const revertResize = (target) => {
    const entity = port.read(target.kind, target.id);
    if (entity !== undefined) {
      engine.updateGeometry(target.slot, {
        x: entity.x,
        y: entity.y,
        width: entity.width,
        height: entity.height,
      });
      onDemand.request();
    }
  };
  const commitResize = (target, rect) => {
    const entity = port.read(target.kind, target.id);
    if (entity === undefined) {
      return;
    }
    const position =
      rect.x !== entity.x || rect.y !== entity.y ? { x: rect.x, y: rect.y } : undefined;
    const pair = seam.buildOperation(port, context, {
      kind: "resize",
      objectKind: target.kind,
      objectId: target.id,
      size: { width: rect.width, height: rect.height },
      ...(position === undefined ? {} : { position }),
    });
    if (pair === null) {
      return;
    }
    seam.applyOperation(port, pair.operation);
    history.push(pair.operation, pair.inverse);
    recordPair(pair);
    onDemand.request();
  };
  const resizeInfo = (ids) => {
    const targets = selectionTargets(ids);
    const target = targets[0];
    if (target === undefined) {
      return null;
    }
    return {
      id: target.id,
      kind: target.kind,
      world: target.world,
      minimum: resizeMinimum(target),
      handles: Array.from({ length: 8 }, (_, index) => index),
      last: lastPair === null
        ? null
        : {
            operation: lastPair.operation.type,
            inverse: lastPair.inverse.type,
            children:
              lastPair.operation.type === "group"
                ? lastPair.operation.payload.children.map((child) => child.type)
                : undefined,
          },
    };
  };
  if (typeof globalThis !== "undefined") {
    globalThis.__engineResize = {
      info: (ids) => resizeInfo(ids),
      worldToScreen: (world) => ({
        x: (world.x - camera.panX) * camera.zoom,
        y: (world.y - camera.panY) * camera.zoom,
      }),
    };
  }

  const tap = (target) => {
    if (target !== null && onTap !== null) {
      onTap(target);
    }
  };
  // Evidence hook for the browser check and manual verification: the last
  // committed operation (types only, never board state).
  const zoneState = () => ({
    zones: zoneTargets().map((zone) => ({
      id: zone.id,
      slot: zone.slot,
      world: zone.world,
      members: {
        cards: port.members(zone.id).cards.map((card) => card.id),
        blocks: port.members(zone.id).blocks.map((block) => block.id),
      },
    })),
    lastDrop,
    lastDelete,
    highlight: {
      slot: highlightSlot,
      active: highlightSlot !== null && performance.now() < highlightUntil,
    },
  });
  globalThis.__engineZones = {
    state: zoneState,
    objects: () =>
      entries
        .filter((entry) => port.read(entry.kind, entry.id) !== undefined)
        .map((entry) => {
          const entity = port.read(entry.kind, entry.id);
          const slot = port.slotOf(entry.kind, entry.id);
        return {
          kind: entry.kind,
          id: entry.id,
          slot,
          zoneId: entity === undefined ? null : entity.zoneId ?? null,
          world:
            entity === undefined
              ? null
              : { x: entity.x, y: entity.y, width: entity.width, height: entity.height },
        };
      }),
    zones: () => zoneState().zones,
    lastDrop: () => lastDrop,
    lastDelete: () => lastDelete,
    highlight: () => zoneState().highlight,
    deleteZone: (id, policy) => {
      const zone = zoneTargets().find((candidate) => candidate.id === id);
      if (zone === undefined) {
        return 0;
      }
      return deleteTargets([zone], policy);
    },
  };
  globalThis.__engineDrag = {
    last: lastOperation,
    targetAt,
  };
  return {
    targetAt,
    preview,
    revert,
    commit,
    tap,
    selectionTargets,
    targetsInRect,
    previewGroup,
    revertGroup,
    commitGroup,
    deleteTargets,
    lastOperation,
    previewZoneDrag,
    commitZoneArrangement,
    duplicateTargets,
    nudgeTargets,
    undo: () => {
      const label = history.describe();
      const pair = history.undo();
      if (pair === null || pair === undefined) {
        return null;
      }
      onDemand.request();
      return { label, operation: pair.operation.type };
    },
    redo: () => {
      const pair = history.redo();
      if (pair === null || pair === undefined) {
        return null;
      }
      onDemand.request();
      return { operation: pair.operation.type };
    },
    undoDepth: () => history.undoDepth(),
    redoDepth: () => history.redoDepth(),
    visibleObjects,
    addCardAt,
    resizeMinimum,
    previewResize,
    commitResize,
    revertResize,
    setLifecycleRender,
    renderLifecycle,
    setZoneParityRenderer,
    clearZonePreview,
    arrangeZoneDemo,
  };
}

// Builds the contract entity of a scene object that was loaded as packed
// rectangles (the sample board). The engine document already holds the
// rectangles in array order, so the projection backend below assigns exactly
// those slots instead of adding them again; the port then gives the drag session
// the entity reads and the single `move` write of the P4-05 seam.
function rectangleEntity(object, index, uuidOf, boardId) {
  const base = {
    id: uuidOf.get(object.id),
    boardId,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    z: "0",
    createdAt: LAYERS_TIMESTAMP,
    updatedAt: LAYERS_TIMESTAMP,
  };
  const zoneId = object.parent === null ? {} : { zoneId: uuidOf.get(object.parent) };
  if (object.kind === "zone") {
    return { ...base, title: object.id };
  }
  if (object.kind === "block") {
    return { ...base, ...zoneId, type: "checklist" };
  }
  return { ...base, ...zoneId, noteId: layersUuid(0x9000 + index) };
}

// Drag session for a rectangle scene: the engine document stays exactly the
// packed `loadRectangles` board (pixels unchanged), while the contract port
// projects the same objects onto the already assigned slots, so a drag commits
// one contract move operation without reloading the document.
async function loadRectangleDragSession(engine, loaded) {
  const [{ applyOperation, buildOperation, keyAfter }, { createEngineDocumentPort }, { createHistory }] =
    await Promise.all([
      import("@project-air/engine/logic/operations.js"),
      import("@project-air/engine/logic/document-port.js"),
      import("@project-air/engine/logic/history.js"),
    ]);
  const boardId = layersUuid(0xb0b2);
  const uuidOf = new Map(
    loaded.objects.map((object, index) => [object.id, layersUuid(0x2000 + index)]),
  );
  const sceneIdOf = new Map([...uuidOf].map(([sceneId, uuid]) => [uuid, sceneId]));
  let nextSlot = 0;
  const projection = {
    addRectangle() {
      const slot = nextSlot;
      nextSlot += 1;
      return slot;
    },
    updateGeometry(slot, geometry) {
      engine.updateGeometry(slot, geometry);
    },
    updateZ() {
      // Rectangle scenes carry no fractional z (their order is the packed array
      // order); a drag never changes it, so the projection ignores the call.
    },
    removeObject(slot) {
      engine.removeObject(slot);
    },
  };
  const port = createEngineDocumentPort(projection);
  loaded.objects.forEach((object, index) => {
    port.add(object.kind, rectangleEntity(object, index, uuidOf, boardId));
  });
  const history = createHistory(port);
  let operationCount = 0;
  const context = {
    boardId,
    actorId: layersUuid(0xac02),
    createOperationId: () => layersUuid(0x30000 + operationCount),
    now: () => LAYERS_TIMESTAMP,
  };
  return createDragSession({
    engine,
    port,
    context,
    history,
    seam: { buildOperation, applyOperation },
    operations: { keyAfter },
    entries: loaded.objects.map((object) => ({ kind: object.kind, id: uuidOf.get(object.id) })),
    sceneIdOf,
    onTap: null,
    zoneParity: zoneParityRequested,
  });
}

// ---------------------------------------------------------------------------
// L03 (P4-14) pointer input: one layer for click, drag and pan/zoom.
//
// The DOM listeners live here and nowhere else: every pointer/wheel event goes
// through the `PointerInput` state machine from `@project-air/engine/input.js`,
// which owns the token 4 px drag threshold, the grip policy (cards: whole body;
// blocks and zones: the 40 px header band), field/scroll suppression, pointer
// capture and the right-button/multi-touch rules. This function only translates
// DOM events into the layer's samples and applies the layer's presentation state
// (cursor, header hover surface, titles hover/selection). Pan and zoom stay
// view-only `setCamera` calls; a completed drag is committed by the scene's drag
// session as one `drag-single` operation through the P4-05 seam.
// ---------------------------------------------------------------------------

// Applies the page camera and requests exactly one frame (on-demand rendering).
function applyCamera(engine) {
  engine.setCamera(camera);
  onDemand.request();
}

// View-only zoom around a screen point: keep the world point under the pointer.
function zoomAround(engine, screenX, screenY, requestedZoom) {
  const nextZoom = clampNumber(requestedZoom, zoomRange.minimumZoom, zoomRange.maximumZoom);
  if (nextZoom === camera.zoom) {
    return;
  }
  const worldX = camera.panX + screenX / camera.zoom;
  const worldY = camera.panY + screenY / camera.zoom;
  camera.zoom = nextZoom;
  camera.panX = worldX - screenX / nextZoom;
  camera.panY = worldY - screenY / nextZoom;
  applyCamera(engine);
}

// Maps a world rectangle to the overlay box that exactly covers the canvas.
function worldToOverlay(worldRect) {
  const bounds = canvas.getBoundingClientRect();
  const engineWidth = Math.max(1, Math.round(bounds.width));
  const contentScale = canvas.clientWidth > 0 ? canvas.clientWidth / engineWidth : 1;
  return {
    x: canvas.clientLeft + (worldRect.x - camera.panX) * camera.zoom * contentScale,
    y: canvas.clientTop + (worldRect.y - camera.panY) * camera.zoom * contentScale,
    width: worldRect.width * camera.zoom * contentScale,
    height: worldRect.height * camera.zoom * contentScale,
  };
}

// Describes the event target for the suppression policy of the input layer:
// `input`, `textarea`, `select`, `button`, editable and `[data-field]` elements
// and elements whose computed overflow scrolls never start a drag (L03).
function describeSuppression(target) {
  if (!(target instanceof Element)) {
    return { suppressed: false, editable: false, cursor: "default" };
  }
  const element = target;
  const style = getComputedStyle(element);
  const tagName = element.tagName;
  const contentEditable = element instanceof HTMLElement ? element.isContentEditable : false;
  const descriptor = {
    tagName,
    contentEditable,
    dataField: element.closest("[data-field]") !== null,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
  };
  const suppressed = isSuppressedTarget(descriptor);
  const editable =
    contentEditable ||
    tagName.toLowerCase() === "input" ||
    tagName.toLowerCase() === "textarea";
  return { suppressed, editable, cursor: suppressed ? cursorForSuppressed(descriptor) : "default" };
}

function positionHeaderSurface() {
  if (headerSurface === null || hoverHeaderTarget === null) {
    return;
  }
  const box = worldToOverlay({
    x: hoverHeaderTarget.world.x,
    y: hoverHeaderTarget.world.y,
    width: hoverHeaderTarget.world.width,
    height: dragTokens["header-height"],
  });
  headerSurface.style.left = `${box.x}px`;
  headerSurface.style.top = `${box.y}px`;
  headerSurface.style.width = `${box.width}px`;
  headerSurface.style.height = `${box.height}px`;
}

// Header hover chrome (design rule §6, ADR-0009): a DOM `--faint` band over the
// hovered block/zone header, faded in with the 120 ms motion token. It is never a
// canvas glyph and never document state; at rest it is fully transparent, so the
// committed reference images stay 0-diff.
function applyHeaderHover(state) {
  if (headerSurface === null) {
    return;
  }
  const shown = state.header && state.suppressed !== true && state.target !== null;
  hoverHeaderTarget = shown ? state.target : null;
  headerSurface.classList.toggle("is-visible", shown);
  if (shown) {
    positionHeaderSurface();
  }
}

// Repositions the pointer-driven DOM chrome after a camera change. The titles
// overlay does the same for its delete affordances; the header surface and the
// optional input demo follow the same camera.
function updateChrome() {
  if (headerSurface !== null && hoverHeaderTarget !== null) {
    positionHeaderSurface();
  }
  selectionBarUpdate?.();
  inlineDemo?.update();
  inputDemo?.update();
}

// L18 (P4-23) inline comfort demo: plain DOM fields anchored over the layers
// scene, a 24 px colour control and the pure keyboard policy. The demo owns no
// board state: it never writes the engine document, an operation or storage — it
// only creates, focuses and removes its own DOM fields in memory.
function installInlineDemo(engine, session) {
  const wrap = canvas.parentElement;
  if (!(wrap instanceof HTMLElement) || session === null) {
    return null;
  }
  const layer = document.createElement("div");
  layer.className = "field-overlay";
  wrap.append(layer);
  let update = () => {};

  let focusedId = null;
  let lastIntent = null;
  let nextEntryId = 1;
  const host = new OverlayHost({
    layer,
    canvas,
    onFocusChange: (id) => {
      focusedId = id;
    },
  });
  // The entries in focus order: checklist entries, column entries, table entries,
  // then the scrollable note and the colour field.
  const entries = [];
  const groups = [
    { id: "checklist", title: "Checklist", base: { x: 128, y: 184 }, width: 224, count: 3 },
    { id: "column", title: "Column", base: { x: 560, y: 392 }, width: 200, count: 2 },
    { id: "table", title: "Table", base: { x: 368, y: 216 }, width: 220, count: 2 },
  ];
  const ENTRY_HEIGHT = 24;
  const ENTRY_STEP = 30;

  const entryWorld = (group, index) => ({
    x: group.base.x,
    y: group.base.y + index * ENTRY_STEP,
    width: group.width,
    height: ENTRY_HEIGHT,
  });
  const reflowGroup = (groupId) => {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (group === undefined) {
      return;
    }
    let index = 0;
    for (const entry of entries) {
      if (entry.group !== groupId || entry.kind !== "text") {
        continue;
      }
      entry.world = entryWorld(group, index);
      host.setWorld(entry.id, entry.world);
      index += 1;
    }
  };
  const fieldList = () =>
    entries.map((entry) => ({ id: entry.id, empty: entry.input.value.trim().length === 0 }));
  const entryIndex = (id) => entries.findIndex((entry) => entry.id === id);
  const focusEntry = (id) => {
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      return;
    }
    host.open(id);
    entry.input.focus();
  };
  const removeEntry = (entry, focusIndex) => {
    const index = entryIndex(entry.id);
    if (index < 0) {
      return;
    }
    entries.splice(index, 1);
    host.unregister(entry.id);
    entry.input.remove();
    reflowGroup(entry.group);
    update();
    if (focusIndex === null) {
      host.close();
      return;
    }
    const target = entries[focusIndex];
    if (target !== undefined) {
      focusEntry(target.id);
    } else {
      host.close();
    }
  };
  const insertEntry = (focused) => {
    const group = groups.find((candidate) => candidate.id === focused.group);
    if (group === undefined) {
      return;
    }
    const index = entryIndex(focused.id);
    const entry = createTextEntry(group, index + 1);
    entries.splice(index + 1, 0, entry);
    host.register({ id: entry.id, world: entry.world, element: entry.input });
    reflowGroup(group.id);
    update();
    focusEntry(entry.id);
  };
  const handleFieldKey = (entry, event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      lastIntent = { kind: "close", id: entry.id };
      host.close();
      canvas.focus();
      return;
    }
    if (entry.kind !== "text") {
      lastIntent = { kind: "none", key: event.key, id: entry.id };
      return;
    }
    const intent = applyInlineKey(fieldList(), entryIndex(entry.id), {
      key: event.key,
      shiftKey: event.shiftKey,
    });
    lastIntent = { ...intent, key: event.key, id: entry.id };
    if (intent.kind === "none") {
      return;
    }
    event.preventDefault();
    if (intent.kind === "insert") {
      insertEntry(entries[entryIndex(entry.id)]);
    } else if (intent.kind === "focus") {
      const target = entries[intent.index];
      if (target !== undefined) {
        focusEntry(target.id);
      }
    } else if (intent.kind === "remove") {
      removeEntry(entry, intent.focusIndex);
    }
  };
  const createTextEntry = (group, index) => {
    const id = `entry-${nextEntryId}`;
    nextEntryId += 1;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-field";
    input.dataset.field = "";
    input.setAttribute("aria-label", `${group.title} entry ${index + 1}`);
    const entry = { id, group: group.id, kind: "text", world: entryWorld(group, index), input };
    input.addEventListener("keydown", (event) => handleFieldKey(entry, event));
    input.addEventListener("focus", () => host.open(id));
    return entry;
  };
  const createSpecialEntry = (kind, world, element, label) => {
    const id = `${kind}-${nextEntryId}`;
    nextEntryId += 1;
    element.dataset.field = "";
    element.setAttribute("aria-label", label);
    element.classList.add("inline-field");
    if (kind === "colour") {
      element.classList.add("inline-colour");
    } else if (kind === "scroll") {
      element.classList.add("inline-scroll");
    }
    const entry = { id, group: kind, kind, world, input: element };
    element.addEventListener("keydown", (event) => handleFieldKey(entry, event));
    element.addEventListener("focus", () => host.open(id));
    return entry;
  };
  for (const group of groups) {
    for (let index = 0; index < group.count; index += 1) {
      entries.push(createTextEntry(group, index));
    }
  }
  const note = document.createElement("textarea");
  note.value =
    "A scrollable note: keep your wheel here, the canvas stays still. This text is deliberately longer than the field so the field scrolls, while stopping the wheel at the field keeps the canvas from zooming and never prevents the native scrolling.";
  entries.push(
    createSpecialEntry("scroll", { x: 368, y: 300, width: 220, height: 48 }, note, "Scrollable note"),
  );
  const colour = document.createElement("input");
  colour.type = "color";
  colour.value = readTokenColour("accent");
  entries.push(createSpecialEntry("colour", { x: 560, y: 456, width: 24, height: 24 }, colour, "Colour"));
  for (const entry of entries) {
    host.register({ id: entry.id, world: entry.world, element: entry.input });
  }

  update = () => {
    host.update(
      camera,
      { width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) },
      window.devicePixelRatio,
    );
    // The colour control keeps its 24 px token size instead of the anchored
    // width (L18: a 24 px colour field, not a scaled native button).
    colour.style.removeProperty("width");
    colour.style.removeProperty("height");
  };
  update();

  // Evidence hook: anchored fields, focus, intents, the colour control and the
  // (always zero) board writes of the demo.
  globalThis.__inlineDemo = {
    fields: () =>
      entries.map((entry) => {
        const anchor = anchorToScreen(
          entry.world,
          camera,
          { width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) },
          window.devicePixelRatio,
        );
        return {
          id: entry.id,
          group: entry.group,
          kind: entry.kind,
          world: entry.world,
          value: entry.input.value,
          focused: entry.input === document.activeElement,
          visible: entry.input.hidden !== true && anchor.visible,
          screen: anchor,
        };
      }),
    focusedId: () => focusedId,
    focus: (id) => {
      focusEntry(id);
      return focusedId;
    },
    lastIntent: () => lastIntent,
    colourSize: () => {
      const rect = colour.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    },
    boardWrites: () => 0,
    counts: () => ({
      text: entries.filter((entry) => entry.kind === "text").length,
      checklist: entries.filter((entry) => entry.group === "checklist").length,
      column: entries.filter((entry) => entry.group === "column").length,
      table: entries.filter((entry) => entry.group === "table").length,
      colour: entries.filter((entry) => entry.kind === "colour").length,
      scroll: entries.filter((entry) => entry.kind === "scroll").length,
    }),
    overlayVisible: () => !layer.hidden,
  };
  return { update };
}

// L08 (P4-30): lifecycle/name chrome in the DOM overlay: the dashed grouping /
// emptying frame, the dashed landing slot, the 40 px header title label and the
// inline rename field. Presentation only (ADR-0009).
function installZoneLifecycleOverlay() {
  const wrap = canvas.parentElement;
  if (!(wrap instanceof HTMLElement)) {
    return null;
  }
  const layer = document.createElement("div");
  layer.className = "zone-lifecycle-layer";
  layer.hidden = true;
  const frame = document.createElement("div");
  frame.className = "zone-lifecycle-frame";
  const slot = document.createElement("div");
  slot.className = "zone-lifecycle-slot";
  const title = document.createElement("div");
  title.className = "zone-lifecycle-title";
  const rename = document.createElement("input");
  rename.className = "zone-lifecycle-rename";
  rename.type = "text";
  rename.dataset.field = "";
  rename.hidden = true;
  layer.append(frame, slot, title, rename);
  wrap.append(layer);
  const place = (element, rect) => {
    const bounds = canvas.getBoundingClientRect();
    element.style.left = `${bounds.left + (rect.x - camera.panX) * camera.zoom}px`;
    element.style.top = `${bounds.top + (rect.y - camera.panY) * camera.zoom}px`;
    element.style.width = `${rect.width * camera.zoom}px`;
    element.style.height = `${rect.height * camera.zoom}px`;
  };
  let editing = null;
  const commitRename = (value) => {
    if (editing === null) {
      return;
    }
    const zoneId = editing;
    editing = null;
    rename.hidden = true;
    window.__zoneLifecycle?.renameZone?.(zoneId, value);
    const next = window.__zoneLifecycle?.state?.().zones.find((zone) => zone.id === zoneId);
    if (next !== undefined) {
      title.textContent = next.title;
      title.hidden = false;
    }
  };
  rename.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename(rename.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      editing = null;
      rename.hidden = true;
      title.hidden = false;
    }
  });
  rename.addEventListener("blur", () => commitRename(rename.value));
  title.addEventListener("dblclick", () => {
    const zoneId = title.dataset.zoneId;
    if (zoneId === undefined) {
      return;
    }
    editing = zoneId;
    rename.value = title.textContent ?? "";
    rename.hidden = false;
    title.hidden = true;
    rename.focus();
    rename.select();
  });
  return {
    render(state) {
      if (state === null || state === undefined) {
        layer.hidden = true;
        return;
      }
      layer.hidden = false;
      place(frame, state.frame);
      frame.classList.toggle("is-dashed", state.dashed === true);
      frame.classList.toggle("is-dimmed", state.dimmed === true);
      if (state.slot === null || state.slot === undefined) {
        slot.hidden = true;
      } else {
        slot.hidden = false;
        place(slot, state.slot);
      }
      title.hidden = editing !== null;
      title.textContent = state.title ?? "";
      title.dataset.zoneId = state.zoneId ?? "";
      title.classList.toggle("is-grouping", state.mode === "group");
      const bounds = canvas.getBoundingClientRect();
      title.style.left = `${bounds.left + (state.frame.x + ZONE_PADDING - camera.panX) * camera.zoom}px`;
      title.style.top = `${bounds.top + (state.frame.y + 10 - camera.panY) * camera.zoom}px`;
      onDemand.request();
    },
  };
}

function installZoneLifecycleDemo(session, mode) {
  const overlay = installZoneLifecycleOverlay();
  if (overlay === null) {
    return null;
  }
  session.setLifecycleRender((state) => overlay.render(state));
  const render = (state) => session.renderLifecycle(state);
  window.__zoneLifecycle.render = render;
  const zones = () => window.__zoneLifecycle.state().zones;
  if (mode === "names") {
    const zone = zones()[0];
    if (zone !== undefined) {
      window.__zoneLifecycle.renameZone(zone.id, "Lake trip");
      const updated = window.__zoneLifecycle.state().zones[0];
      render({ mode: "names", frame: updated.world, title: updated.title, zoneId: updated.id });
    }
    return overlay;
  }
  if (mode === "emptied") {
    const zone = zones().find((candidate) => candidate.members.length > 0) ?? zones()[0];
    if (zone !== undefined) {
      window.__zoneLifecycle.removeAllMembers(zone.id);
      const updated = window.__zoneLifecycle.state().zones.find((candidate) => candidate.id === zone.id);
      render({ mode: "emptied", frame: updated?.world ?? zone.world, title: updated?.title ?? "", dashed: true, dimmed: true, zoneId: zone.id });
    }
    return overlay;
  }
  // grouping (also the default demo): free the zone members, then show the ghost
  // frame and landing slot between the first two free objects.
  window.__zoneLifecycle.detachAllZones();
  const free = window.__zoneLifecycle.state().freeObjects;
  if (free.length >= 2) {
    const layout = planZoneGroup(
      [free[0].world, free[1].world].map((world, index) => ({ id: index === 0 ? free[0].objectId : free[1].objectId, ...world })),
      null,
      "vertical",
      { width: 4000, height: 4000 },
    );
    render({
      mode: "group",
      frame: layout.frame,
      slot: { x: layout.frame.x + ZONE_PADDING, y: layout.frame.y + ZONE_HEADER + ZONE_PADDING, width: free[0].world.width, height: free[0].world.height },
      title: defaultZoneTitle("en"),
      dashed: true,
      dimmed: false,
    });
  }
  return overlay;
}

// L08 (P4-29): minimal release-preview chrome in the DOM overlay (ADR-0009):
// the previewed zone frame outline and the dashed landing slot. Presentation
// state only; a cancel simply hides it.
function installZoneParityOverlay() {
  const wrap = canvas.parentElement;
  if (!(wrap instanceof HTMLElement)) {
    return null;
  }
  const layer = document.createElement("div");
  layer.className = "zone-parity-layer";
  layer.hidden = true;
  const frame = document.createElement("div");
  frame.className = "zone-parity-frame";
  const slot = document.createElement("div");
  slot.className = "zone-parity-slot";
  layer.append(frame, slot);
  wrap.append(layer);
  const place = (element, rect) => {
    const bounds = canvas.getBoundingClientRect();
    element.style.left = `${bounds.left + (rect.x - camera.panX) * camera.zoom}px`;
    element.style.top = `${bounds.top + (rect.y - camera.panY) * camera.zoom}px`;
    element.style.width = `${rect.width * camera.zoom}px`;
    element.style.height = `${rect.height * camera.zoom}px`;
  };
  return {
    render(state) {
      if (state === null || state === undefined) {
        layer.hidden = true;
        return;
      }
      layer.hidden = false;
      place(frame, state.frame);
      if (state.landing === null || state.landing === undefined) {
        slot.hidden = true;
      } else {
        slot.hidden = false;
        place(slot, state.landing);
      }
      onDemand.request();
    },
  };
}

// Installs the one pointer input layer of the page. `session` is the drag
// session of the loaded scene (null for scenes that are not contract entities);
// `titlesController` handles the titles gallery's hover/selection.
function installPointerInput(engine, session, titlesController) {
  const wrap = canvas.parentElement;
  if (!(wrap instanceof HTMLElement)) {
    throw new Error("engine-playground: the canvas needs a .canvas-wrap parent");
  }
  headerSurface = document.querySelector("#header-surface");
  dragTokens = readTokenPixels([
    "drag-threshold",
    "header-height",
    "motion-hover",
    "snap-tolerance",
    "canvas-grid",
    "space-8",
  ]);
  // L07 (P4-15): the last snap of the current drag, for the capture record and
  // manual verification (presentation state, never board state).
  let lastSnap = null;
  // L10 (P4-16): the presentation selection, the live band and the DOM count bar.
  // None of this is document state.
  let selectedTargets = [];
  let lastBand = null;
  let selectionBar = null;
  let selectionCountNode = null;
  const overlay = document.querySelector("#overlay");
  if (session !== null && overlay instanceof HTMLElement) {
    selectionBar = document.createElement("div");
    selectionBar.className = "selection-bar";
    selectionBar.hidden = true;
    selectionCountNode = document.createElement("span");
    selectionCountNode.className = "selection-bar__count";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "selection-bar__delete";
    deleteButton.setAttribute("aria-label", "Delete selection");
    deleteButton.setAttribute("data-label", "Delete selection");
    deleteButton.innerHTML = DELETE_ICON;
    deleteButton.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteSelection();
    });
    selectionBar.append(selectionCountNode, deleteButton);
    overlay.append(selectionBar);
  }

  const selectionBounds = () => {
    if (selectedTargets.length === 0) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const target of selectedTargets) {
      minX = Math.min(minX, target.world.x);
      minY = Math.min(minY, target.world.y);
      maxX = Math.max(maxX, target.world.x + target.world.width);
      maxY = Math.max(maxY, target.world.y + target.world.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };
  const updateSelectionBar = () => {
    if (selectionBar === null || selectionCountNode === null) {
      return;
    }
    const bounds = selectionBounds();
    if (bounds === null) {
      selectionBar.hidden = true;
      return;
    }
    selectionBar.hidden = false;
    selectionCountNode.textContent = `${selectedTargets.length} selected`;
    const box = worldToOverlay(bounds);
    // Above the bounding box; when the box touches the top of the canvas (a
    // zoomed-out mobile view) the bar flips inside the box. The bar is clamped to
    // the visible canvas so the delete control is always clickable (the overlay
    // clips at the canvas edge).
    const barHeight = selectionBar.offsetHeight;
    const barWidth = selectionBar.offsetWidth;
    const above = box.y - barHeight - dragTokens["space-8"];
    const inside = above < canvas.clientTop;
    const margin = dragTokens["space-8"];
    const maximumLeft = canvas.clientLeft + Math.max(0, canvas.clientWidth - barWidth);
    const maximumTop = canvas.clientTop + Math.max(0, canvas.clientHeight - barHeight);
    const left = Math.min(Math.max(box.x, canvas.clientLeft), maximumLeft);
    const top = inside ? box.y + margin : box.y;
    selectionBar.classList.toggle("is-inside", inside);
    selectionBar.style.left = `${left}px`;
    selectionBar.style.top = `${Math.min(Math.max(top, canvas.clientTop), maximumTop)}px`;
  };
  const applySelection = (targets) => {
    selectedTargets = [...targets];
    // Native chrome: the selection frames draw in the existing chrome pass.
    engine.setSelection(selectedTargets.map((target) => target.slot));
    updateSelectionBar();
    // Presentation change only: request the one frame that shows the chrome.
    onDemand.request();
  };
  const refreshSelection = () => {
    if (session === null) {
      return;
    }
    applySelection(session.selectionTargets(selectedTargets.map((target) => target.id)));
  };
  const deleteSelection = () => {
    if (session === null || selectedTargets.length === 0) {
      return;
    }
    const deleted = session.deleteTargets(selectedTargets);
    if (deleted > 0) {
      input.clearSelection();
      applySelection([]);
    }
  };
  // The bar follows the camera with the rest of the pointer-driven DOM chrome.
  selectionBarUpdate = updateSelectionBar;

  const targetAt = (screenX, screenY) => {
    if (session !== null) {
      return session.targetAt(screenX, screenY);
    }
    if (titlesController !== null) {
      return titlesController.targetAt(screenX, screenY);
    }
    return null;
  };

  let lastAutoPanDrag = null;
  const host = {
    hitTest: targetAt,
    screenToWorld: (screenX, screenY) => ({
      x: camera.panX + screenX / camera.zoom,
      y: camera.panY + screenY / camera.zoom,
    }),
    panByScreen: (deltaX, deltaY) => {
      camera.panX -= deltaX / camera.zoom;
      camera.panY -= deltaY / camera.zoom;
      applyCamera(engine);
      markViewChangedGlobal();
    },
    viewportSize: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
    zoomByFactor: (factor, screenX, screenY) => {
      zoomAround(engine, screenX, screenY, camera.zoom * factor);
      markViewChangedGlobal();
    },
    previewDrag: (target, position) => {
      session?.preview(target, position);
    },
    commitDrag: (target, position) => {
      if (zoneParityRequested && session?.commitZoneArrangement?.() === true) {
        return;
      }
      session?.commit(target, position);
    },
    onDragMove: (target, position) => {
      lastAutoPanDrag = { targetId: target.id, position: { x: position.x, y: position.y } };
      if (zoneParityRequested) {
        session?.previewZoneDrag?.(target, position);
      }
    },
    revertDrag: (target) => {
      session?.revert(target);
    },
    snapDrag: (target, position, free) => {
      const snapped = engine.snapDrag(target.slot, position, free);
      lastSnap = { position: snapped.position, guides: snapped.guides, free };
      return snapped.position;
    },
    clearSnap: () => {
      engine.clearSnapGuides();
      lastSnap = null;
    },
    selectionTargets: () =>
      session !== null ? session.selectionTargets(selectedTargets.map((target) => target.id)) : [],
    targetsInRect: (rect) => (session !== null ? session.targetsInRect(rect) : []),
    previewGroupDrag: (members) => {
      session?.previewGroup(members);
    },
    commitGroupDrag: (members) => {
      session?.commitGroup(members);
      refreshSelection();
    },
    revertGroupDrag: (members) => {
      session?.revertGroup(members);
    },
    onSelectionChange: (targets) => {
      applySelection(targets);
    },
    onBandChange: (band) => {
      lastBand = band;
      engine.setBand(band);
      onDemand.request();
    },
    onTap: (target) => {
      session?.tap(target);
      titlesController?.tapById(target === null ? null : target.id);
    },
    onHover: (state) => {
      canvas.style.cursor = state.cursor;
      applyHeaderHover(state);
      if (state.suppressed !== true) {
        titlesController?.setHovered(state.target === null ? null : state.target.id);
      }
    },
    onCursor: (cursor) => {
      canvas.style.cursor = cursor;
    },
    worldToScreen: (world) => ({
      x: (world.x - camera.panX) * camera.zoom,
      y: (world.y - camera.panY) * camera.zoom,
    }),
    previewResize: (target, rect) => {
      session?.previewResize(target, rect);
    },
    commitResize: (target, rect) => {
      session?.commitResize(target, rect);
    },
    revertResize: (target) => {
      session?.revertResize(target);
    },
    resizeMinimum: (target) =>
      session?.resizeMinimum(target) ?? resizeMinimumFor(target.kind, "checklist"),
    capturePointer: (pointerId) => {
      try {
        wrap.setPointerCapture(pointerId);
      } catch {
        // A pointer that already ended cannot be captured; the next event fixes it.
      }
    },
    releasePointer: (pointerId) => {
      if (wrap.hasPointerCapture(pointerId)) {
        wrap.releasePointerCapture(pointerId);
      }
    },
  };

  const input = createPointerInput({
    thresholdPx: dragTokens["drag-threshold"],
    headerHeightPx: dragTokens["header-height"],
    hoverTransitionMs: dragTokens["motion-hover"],
    host,
  });
  if (typeof globalThis !== "undefined") {
    globalThis.__engineAutoPan = {
      lastDrag: () => lastAutoPanDrag,
      viewport: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
    };
  }

  // P4-19 (L20): add a note at the placed position through the seam. The size is
  // the playground's card default (the same geometry the sample cards use); the
  // placement itself is the pure logic rule, computed from the current camera.
  const addNoteAdds = [];
  const addNoteAction = async () => {
    if (session === null || typeof session.addCardAt !== "function") {
      return null;
    }
    const { placeNewObject } = await import("@project-air/engine/placement.js");
    const visible = {
      x: camera.panX,
      y: camera.panY,
      width: Math.max(1, canvas.clientWidth / camera.zoom),
      height: Math.max(1, canvas.clientHeight / camera.zoom),
    };
    // The contract card minimum (176x80) is the smallest usable note size and
    // keeps five consecutive notes inside a crowded view without overlapping.
    const size = { width: 176, height: 80 };
    const visibleObjects = session.visibleObjects();
    const placement = placeNewObject({ visible, objects: visibleObjects, size });
    const created = session.addCardAt(placement, size);
    const entry = {
      ...placement,
      operationId: created?.operationId ?? null,
      objectId: created?.objectId ?? null,
      visible,
      size,
    };
    addNoteAdds.push(entry);
    globalThis.__enginePlacement = {
      adds: () => addNoteAdds.map((add) => ({ ...add })),
      last: () => addNoteAdds.at(-1) ?? null,
      addNote: () => addNoteAction(),
      visible: () => ({ ...visible }),
      size: () => ({ ...size }),
    };
    return entry;
  };
  if (typeof globalThis !== "undefined") {
    globalThis.__enginePlacement = {
      adds: () => addNoteAdds.map((add) => ({ ...add })),
      last: () => addNoteAdds.at(-1) ?? null,
      addNote: () => addNoteAction(),
    };
  }
  const addNoteButton = document.querySelector("#note-add");
  if (addNoteButton instanceof HTMLButtonElement) {
    addNoteButton.addEventListener("click", () => {
      void addNoteAction();
    });
    if (query.get("tools") === "1") {
      addNoteButton.hidden = false;
    }
  }
  window.addEventListener("keydown", (event) => {
    if (event.key !== "n" && event.key !== "N") {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    void addNoteAction();
  });

  const NOT_SUPPRESSED = { suppressed: false, editable: false, cursor: "default" };
  const sampleOf = (event) => {
    const point = screenPointOf(event);
    // The canvas is never a suppressed target; only DOM chrome needs the
    // computed style, so the hot pan/zoom path avoids a style read per move.
    const suppression = event.target === canvas ? NOT_SUPPRESSED : describeSuppression(event.target);
    return {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      screen: point,
      suppressed: suppression.suppressed,
      editable: suppression.editable,
      shiftKey: event.shiftKey,
    };
  };

  // The listeners sit on the canvas wrapper (not the canvas), so events from the
  // DOM chrome bubble here too and the suppression policy can reject them.
  wrap.addEventListener("pointerdown", (event) => {
    input.pointerDown(sampleOf(event));
  });
  wrap.addEventListener("pointermove", (event) => {
    if (event.buttons === 0) {
      input.pointerHover(sampleOf(event));
      return;
    }
    input.pointerMove(sampleOf(event));
  });
  wrap.addEventListener("pointerup", (event) => {
    input.pointerUp(sampleOf(event));
  });
  wrap.addEventListener("pointercancel", (event) => {
    input.pointerCancel(event.pointerId);
  });
  wrap.addEventListener("lostpointercapture", (event) => {
    input.pointerCancel(event.pointerId);
  });
  wrap.addEventListener("pointerleave", () => {
    input.pointerLeave();
  });
  wrap.addEventListener(
    "wheel",
    (event) => {
      const suppression = describeSuppression(event.target);
      // P4-24 (L15): one normalised wheel intent; a suppressed field/scrollable
      // keeps its own wheel handling (no preventDefault, no camera move), and an
      // active object drag/resize consumes the wheel without moving the view.
      const intent = input.wheelGesture({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        screen: screenPointOf(event),
        suppressed: suppression.suppressed,
        dragging: false,
        zoom: camera.zoom,
        minimumZoom: zoomRange.minimumZoom,
        maximumZoom: zoomRange.maximumZoom,
      });
      if (intent.kind !== "none" || !suppression.suppressed) {
        event.preventDefault();
      }
    },
    { passive: false },
  );
  window.addEventListener("blur", () => {
    input.cancelAll();
  });
  // L10: Esc clears the selection (and a live band).
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (zoneParityRequested || input.phase === "dragging")) {
      if (input.phase === "dragging") {
        session?.clearZonePreview?.();
        input.cancelAll();
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Escape" && input.keyDown("Escape")) {
      event.preventDefault();
      return;
    }
    // L08 (P4-27): Delete deletes the selection as one operation; a zone keeps
    // its content by default and Shift+Delete deletes the content with it.
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      input.selection.length > 0 &&
      session !== null
    ) {
      event.preventDefault();
      session.deleteTargets([...input.selection], event.shiftKey ? "delete" : "keep");
      input.clearSelection();
    }
  });
  // P4-20 (L12): one keyboard intent layer and the DOM context menu. Shortcuts
  // and menu entries call the same intents; fields (P4-14 suppression) win.
  const nudgeSeries = new NudgeSeries();
  const menuModel = new ContextMenuModel();
  const menuElement = document.querySelector("#context-menu");
  const hintElement = document.querySelector("#history-hint");
  let hintTimer = null;
  let nudgeTimer = null;
  let lastIntent = null;
  const recordIntent = (intent, extra = {}) => {
    lastIntent = { intent, ...extra, at: Date.now() };
    globalThis.__engineKeyboard?.push?.(lastIntent);
    return lastIntent;
  };
  const commitNudge = () => {
    nudgeTimer = null;
    const delta = nudgeSeries.flush();
    if (delta === null) return null;
    const result = session?.nudgeTargets([...input.selection], { x: delta.dx, y: delta.dy }) ?? null;
    refreshSelection();
    return recordIntent("nudge", { delta, operationId: result?.operationId ?? null, kind: result?.kind ?? null });
  };
  const scheduleNudgeCommit = () => {
    if (nudgeTimer !== null) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { nudgeTimer = null; commitNudge(); }, 300);
  };
  const flushNudgeBefore = () => { if (nudgeSeries.pending) { if (nudgeTimer !== null) clearTimeout(nudgeTimer); commitNudge(); } };
  const intentHandlers = {
    open: () => { refreshSelection(); return recordIntent("open"); },
    duplicate: () => {
      flushNudgeBefore();
      const result = session?.duplicateTargets([...input.selection]) ?? null;
      refreshSelection();
      return recordIntent("duplicate", { operationId: result?.operationId ?? null, offset: result?.offset ?? null });
    },
    "bring-forward": () => recordIntent("bring-forward", { supported: false }),
    "send-backward": () => recordIntent("send-backward", { supported: false }),
    delete: () => { flushNudgeBefore(); deleteSelection(); return recordIntent("delete"); },
  };
  const runIntent = (intent) => (intentHandlers[intent] === undefined ? null : intentHandlers[intent]());
  const closeMenu = () => { if (menuModel.open) { menuModel.close(); menuElement?.setAttribute("hidden", ""); } };
  const paintMenu = () => {
    if (!(menuElement instanceof HTMLElement)) return;
    const items = [...menuElement.querySelectorAll(".context-menu__item")];
    items.forEach((item, index) => { item.dataset.active = String(index === menuModel.index); });
  };
  const openMenu = (clientX, clientY) => {
    if (!(menuElement instanceof HTMLElement)) return null;
    if (input.selection.length === 0) return null;
    menuModel.openAt(0);
    const width = CONTEXT_MENU_WIDTH_PX;
    const height = CONTEXT_MENU_ROW_PX * 5 + 8;
    menuElement.style.left = `${Math.max(0, Math.min(clientX, window.innerWidth - width))}px`;
    menuElement.style.top = `${Math.max(0, Math.min(clientY, window.innerHeight - height))}px`;
    menuElement.removeAttribute("hidden");
    paintMenu();
    recordIntent("menu-open");
    return menuElement;
  };
  if (menuElement instanceof HTMLElement) {
    for (const item of [...menuElement.querySelectorAll(".context-menu__item")]) {
      item.addEventListener("click", () => {
        const intent = item.dataset.intent;
        menuModel.close();
        menuElement.setAttribute("hidden", "");
        if (typeof intent === "string") runIntent(intent);
      });
    }
    document.addEventListener("mousedown", (event) => {
      if (!menuModel.open) return;
      if (event.target instanceof Node && menuElement.contains(event.target)) return;
      menuModel.outsideClick();
      menuElement.setAttribute("hidden", "");
      recordIntent("menu-close", { by: "outside" });
    }, true);
    window.addEventListener("blur", () => { closeMenu(); });
  }
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openMenu(event.clientX, event.clientY);
  });
  window.addEventListener("keydown", (event) => {
    // Capture phase: the menu and field/overlay priority come before the
    // existing selection/Delete handlers; fields suppress every shortcut.
    const descriptor = describeSuppression(event.target);
    if (menuModel.open) {
      if (event.key === "Escape") { closeMenu(); recordIntent("menu-close", { by: "escape" }); event.preventDefault(); event.stopPropagation(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { menuModel.move(event.key === "ArrowDown" ? 1 : -1); paintMenu(); event.preventDefault(); event.stopPropagation(); return; }
      if (event.key === "Enter" || event.key === " ") { const intent = menuModel.activate(); if (intent !== null) runIntent(intent); paintMenu(); event.preventDefault(); event.stopPropagation(); return; }
    }
    const shortcutMenu = (event.key === "F10" && event.shiftKey) || event.key === "ContextMenu";
    const intent = keyboardIntent({
      key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey,
      suppressed: descriptor.suppressed, contextMenuKey: shortcutMenu,
    });
    if (intent === null) return;
    if (intent.kind === "escape") {
      const target = escapePriority({ menuOpen: menuModel.open, overlayOpen: descriptor.editable || descriptor.suppressed, hasSelection: input.selection.length > 0 });
      if (target === "menu") { closeMenu(); event.preventDefault(); event.stopPropagation(); return; }
      if (target === "overlay") { if (event.target instanceof HTMLElement) event.target.blur(); event.preventDefault(); event.stopPropagation(); return; }
      return; // selection Esc stays with the existing input/session handler
    }
    if (intent.kind === "menu-open") { openMenu(canvas.getBoundingClientRect().left + 40, canvas.getBoundingClientRect().top + 40); event.preventDefault(); event.stopPropagation(); return; }
    if (intent.kind === "undo" || intent.kind === "redo") {
      if (menuModel.open) return;
      const result = intent.kind === "undo" ? session?.undo?.() ?? null : session?.redo?.() ?? null;
      if (result === null) {
        event.preventDefault();
        return;
      }
      if (intent.kind === "undo" && hintElement instanceof HTMLElement) {
        hintElement.textContent = undoHintLabel(result.label);
        hintElement.removeAttribute("hidden");
        if (hintTimer !== null) clearTimeout(hintTimer);
        hintTimer = setTimeout(() => { hintElement.setAttribute("hidden", ""); hintTimer = null; }, HISTORY_HINT_MS);
      }
      refreshSelection();
      recordIntent(intent.kind, { operation: result.operation ?? null, label: result.label ?? null });
      event.preventDefault();
      return;
    }
    if (descriptor.suppressed || input.selection.length === 0) return;
    if (intent.kind === "nudge") {
      nudgeSeries.add(intent.dx, intent.dy, Date.now());
      const previewDelta = nudgeSeries.delta;
      for (const target of input.selection) {
        session?.preview?.(target, { x: target.world.x + previewDelta.dx, y: target.world.y + previewDelta.dy });
      }
      scheduleNudgeCommit();
      event.preventDefault();
      return;
    }
    if (intent.kind === "duplicate" || intent.kind === "delete") {
      event.preventDefault();
      if (intent.kind === "duplicate") flushNudgeBefore();
      runIntent(intent.kind);
      return;
    }
  }, true);
  globalThis.__engineKeyboard = {
    last: () => lastIntent,
    menu: () => ({ open: menuModel.open, index: menuModel.index }),
    series: () => ({ pending: nudgeSeries.pending, delta: nudgeSeries.delta }),
    lastOperation: () => (session === null ? null : session.lastOperation()),
    flushNudge: () => commitNudge(),
    hint: () => (hintElement instanceof HTMLElement ? { visible: !hintElement.hidden, text: hintElement.textContent } : null),
    history: () => ({ undoDepth: session?.undoDepth?.() ?? 0, redoDepth: session?.redoDepth?.() ?? 0 }),
  };

  // Evidence hook: the browser/manual check reads the layer state next to the
  // pixels (threshold, phase, hover target and cursor), never document state.
  globalThis.__engineInput = {
    phase: () => input.phase,
    cursor: () => input.cursor,
    hover: () => input.hover,
    tokens: () => ({ ...dragTokens }),
    dragSession: session !== null,
  };
  // Evidence hook: the capture record reads the live snap (position, guides and
  // the free/Shift state) next to the pixels.
  globalThis.__engineSnap = {
    last: () => lastSnap,
  };
  // Evidence hook: selection presentation state and the last committed operation
  // (types only) for the selection capture.
  globalThis.__engineSelection = {
    size: () => selectedTargets.length,
    ids: () => selectedTargets.map((target) => target.id),
    bounds: selectionBounds,
    barVisible: () => selectionBar !== null && !selectionBar.hidden,
    band: () => lastBand,
    lastOperation: () => (session === null ? null : session.lastOperation()),
  };
  return input;
}

// L03 (P4-14) demo chrome for `?input=demo` on the layers scene: one editable
// field and one scrollable area inside block-0001's body. Presses there must not
// drag the block, and the scroll area keeps its own wheel. The elements are DOM
// chrome (ADR-0009) and only exist in this query mode, so no reference image or
// baseline changes.
function installInputDemo(enabled) {
  const overlay = document.querySelector("#overlay");
  if (!enabled || !(overlay instanceof HTMLElement)) {
    return null;
  }
  const field = document.createElement("div");
  field.className = "input-demo__field";
  field.dataset.field = "";
  const label = document.createElement("span");
  label.className = "input-demo__label";
  label.textContent = "Field: no drag";
  const input = document.createElement("input");
  input.className = "input-demo__input";
  input.type = "text";
  input.value = "Editable field";
  input.setAttribute("aria-label", "Editable demo field inside a block");
  field.append(label, input);

  const scroll = document.createElement("div");
  scroll.className = "input-demo__scroll";
  scroll.dataset.field = "";
  scroll.tabIndex = 0;
  scroll.setAttribute("aria-label", "Scrollable demo area inside a block");
  for (let index = 1; index <= 12; index += 1) {
    const line = document.createElement("p");
    line.className = "input-demo__line";
    line.textContent = `Scrollable row ${index}`;
    scroll.append(line);
  }
  overlay.append(field, scroll);

  const anchors = {
    field: { x: 120, y: 184, width: 232, height: 56 },
    scroll: { x: 120, y: 252, width: 232, height: 52 },
  };
  const update = () => {
    const fieldBox = worldToOverlay(anchors.field);
    field.style.left = `${fieldBox.x}px`;
    field.style.top = `${fieldBox.y}px`;
    field.style.width = `${fieldBox.width}px`;
    updateScroll(scroll, anchors.scroll);
  };
  const updateScroll = (element, rect) => {
    const box = worldToOverlay(rect);
    element.style.left = `${box.x}px`;
    element.style.top = `${box.y}px`;
    element.style.width = `${box.width}px`;
    element.style.height = `${box.height}px`;
  };
  update();
  return { update };
}

// L19 fit action on the keyboard: `f` ("show all"). It calls the same fit function
// as the exposed `fit()` hook, so the browser evidence and the visual scene drive
// exactly the user path; a modifier or an already-handled key is left alone.
// P4-28: deterministic stage showcase state. Pure presentation: the titles are
// already bound by installTitles, the selection chrome and snap guides are the
// engine's own presentation state, and the camera is fixed by ?view= or the
// showcase default (200 %). No board content is written and no animation runs;
// the capture waits for the paused scheduler before taking the screenshot.
function installShowcase(engine, loaded) {
  const slotOf = (id) => loaded.objects.findIndex((object) => object.id === id);
  const selection = ["block-0001", "card-0001", "card-0002"]
    .map(slotOf)
    .filter((slot) => slot >= 0);
  if (selection.length > 0) {
    engine.setSelection(selection);
  }
  const cardSlot = slotOf("card-0001");
  const blockSlot = slotOf("block-0001");
  const block = loaded.objects[blockSlot] ?? { x: 48 };
  const card = loaded.objects[cardSlot] ?? { y: 256 };
  const snapped = engine.snapDrag(cardSlot, { x: block.x + 1, y: card.y }, false);
  globalThis.__showcase = {
    scene: "showcase",
    counts: { ...loaded.counts },
    camera: { panX: camera.panX, panY: camera.panY, zoom: camera.zoom },
    selection,
    guides: snapped.guides.length,
    snapped: snapped.position,
    framesBefore: framesNode.textContent,
    framesAfter: null,
    scheduler: "on-demand (paused after the showcase frame)",
  };
  onDemand.request();
  requestAnimationFrame(() => {
    globalThis.__showcase.framesAfter = framesNode.textContent;
    globalThis.__showcase.camera = { panX: camera.panX, panY: camera.panY, zoom: camera.zoom };
  });
}

function installFitKey() {
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      onDemand.fit();
    }
  });
}

function startBenchmark(engine, benchmarkState) {
  benchmarkState.status = "warmup";
  benchmarkState.renderer = readRendererString();
  benchmarkState.startedAt = Date.now();
  benchmarkState.canvas = {
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
  framesNode.textContent = "benchmark";

  let previousTimestamp = 0;
  let renderedFrames = 0;
  const frame = (timestamp) => {
    try {
      engine.renderFrame();
    } catch (error) {
      benchmarkState.status = "error";
      benchmarkState.error = String(error);
      console.error(error);
      return;
    }
    renderedFrames += 1;
    // Discard warm-up frames; sample the interval between rendered frames.
    if (renderedFrames > benchmarkState.warmup) {
      if (previousTimestamp !== 0) {
        benchmarkState.frameTimesMs.push(timestamp - previousTimestamp);
      }
      if (benchmarkState.frameTimesMs.length >= benchmarkState.samples) {
        benchmarkState.status = "done";
        benchmarkState.framesRendered = renderedFrames;
        benchmarkState.finishedAt = Date.now();
        framesNode.textContent = "benchmark done";
        console.log(`PERF_RESULT ${JSON.stringify(benchmarkState)}`);
        return;
      }
    }
    previousTimestamp = timestamp;
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

// Engine-core perf mode. The camera path is a pure function of the frame index:
// one zoom cycle (fit zoom -> fit zoom * 6 -> fit zoom, a sine over the whole
// run) and one horizontal pan sweep across the reachable document range, with
// the view vertically centred. Every frame calls exactly one setCamera and then
// renders; the document is loaded once before the loop, so the spatial index is
// never rebuilt by the measurement itself.
function startEngineCoreMeasurement(engine, loaded) {
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(bounds.width));
  const cssHeight = Math.max(1, Math.round(bounds.height));
  const fitZoom = clampNumber(
    Math.min(cssWidth / loaded.world.width, cssHeight / loaded.world.height),
    zoomRange.minimumZoom,
    zoomRange.maximumZoom,
  );
  const maximumZoom = clampNumber(
    fitZoom * PERF_ZOOM_CYCLE_FACTOR,
    zoomRange.minimumZoom,
    zoomRange.maximumZoom,
  );
  const totalFrames = warmupFrames + sampleFrames;
  const perfState = {
    status: "warming-up",
    scenario: PERF_SCENARIO,
    scene: loaded.name,
    counts: { ...loaded.counts },
    objectCount: loaded.counts.total,
    world: { ...loaded.world },
    warmup: warmupFrames,
    samples: sampleFrames,
    totalFrames,
    frameTimesMs: [],
    cameras: [],
    documentLoads,
    renderer: readRendererString(),
    canvas: {
      cssWidth,
      cssHeight,
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    cameraPath: {
      fitZoom,
      maximumZoom,
      zoomCycleFactor: PERF_ZOOM_CYCLE_FACTOR,
      oneSetCameraPerFrame: true,
      description:
        "one zoom cycle fitZoom -> fitZoom * 6 -> fitZoom (sine over the run) plus one left-to-right pan sweep, view vertically centred",
    },
    verifyCulling: verifyCullingRequested,
    culling: null,
    framesRendered: 0,
  };
  globalThis.__enginePerf = perfState;
  framesNode.textContent = "measuring";
  captionNode.textContent = sceneCaption(loaded);
  hudVisibleNode.textContent = "0";

  let renderedFrames = 0;
  let previousTimestamp = 0;
  // The culling proof replays a representative subset of the sampled cameras,
  // not every frame: an object allocated per frame would add GC work to the
  // measurement it is supposed to observe.
  const cullingCameraStride = Math.max(1, Math.floor(sampleFrames / 100));
  const frame = (timestamp) => {
    const t = totalFrames <= 1 ? 0 : renderedFrames / (totalFrames - 1);
    camera.zoom = clampNumber(
      fitZoom + (maximumZoom - fitZoom) * Math.sin(Math.PI * t),
      zoomRange.minimumZoom,
      zoomRange.maximumZoom,
    );
    const reachableX = Math.max(0, loaded.world.width - cssWidth / camera.zoom);
    const reachableY = Math.max(0, loaded.world.height - cssHeight / camera.zoom);
    camera.panX = reachableX * t;
    camera.panY = reachableY / 2;
    try {
      engine.setCamera(camera);
      engine.renderFrame();
    } catch (error) {
      state.stopped = true;
      perfState.status = "error";
      perfState.error = String(error);
      showError(error);
      settleReady({ ok: false, error: String(error) });
      return;
    }
    renderedFrames += 1;
    perfState.framesRendered = renderedFrames;
    // Discard the warm-up frames; sample the interval between rendered frames.
    if (renderedFrames > warmupFrames) {
      if (previousTimestamp !== 0) {
        perfState.frameTimesMs.push(timestamp - previousTimestamp);
        if (verifyCullingRequested && perfState.frameTimesMs.length % cullingCameraStride === 0) {
          perfState.cameras.push({ panX: camera.panX, panY: camera.panY, zoom: camera.zoom });
        }
      }
      if (perfState.frameTimesMs.length >= sampleFrames) {
        finishEngineCoreMeasurement(engine, loaded, perfState, cssWidth, cssHeight);
        return;
      }
    }
    previousTimestamp = timestamp;
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

function finishEngineCoreMeasurement(engine, loaded, perfState, cssWidth, cssHeight) {
  perfState.status = "verifying";
  if (verifyCullingRequested) {
    perfState.culling = verifyCullingAgainstVisibleSet(engine, loaded, perfState, cssWidth, cssHeight);
  }
  perfState.status = "done";
  perfState.finishedAt = Date.now();
  console.log(
    `PERF_SCENARIO ${JSON.stringify({
      status: "done",
      scenario: PERF_SCENARIO,
      scene: perfState.scene,
      samples: perfState.frameTimesMs.length,
    })}`,
  );
}

// Replays the sampled cameras off the measured path and compares the engine's
// command-buffer instance count with the visible set computed independently from
// the scene geometry and the camera's world bounds (the engine's inclusive-edge
// intersection rule in packages/engine/include/engine/geometry.h). It proves two
// things for the L01 final proof: every frame draws exactly the visible objects,
// and at least one frame draws fewer than the document, so offscreen content is
// culled instead of drawn.
function verifyCullingAgainstVisibleSet(engine, loaded, perfState, cssWidth, cssHeight) {
  let mismatches = 0;
  let culledFrames = 0;
  let minimumInstances = Number.POSITIVE_INFINITY;
  let maximumInstances = 0;
  for (const sampleCamera of perfState.cameras) {
    const visible = {
      x: sampleCamera.panX,
      y: sampleCamera.panY,
      width: cssWidth / sampleCamera.zoom,
      height: cssHeight / sampleCamera.zoom,
    };
    let expected = 0;
    for (const object of loaded.objects) {
      if (
        object.x <= visible.x + visible.width &&
        visible.x <= object.x + object.width &&
        object.y <= visible.y + visible.height &&
        visible.y <= object.y + object.height
      ) {
        expected += 1;
      }
    }
    engine.setCamera(sampleCamera);
    const actual = engine.visibleInstanceCount();
    if (actual !== expected) {
      mismatches += 1;
    }
    if (actual < perfState.objectCount) {
      culledFrames += 1;
    }
    minimumInstances = Math.min(minimumInstances, actual);
    maximumInstances = Math.max(maximumInstances, actual);
  }
  return {
    framesChecked: perfState.cameras.length,
    mismatches,
    expectedEqualsCommandBuffer: mismatches === 0,
    documentSize: perfState.objectCount,
    minInstances: Number.isFinite(minimumInstances) ? minimumInstances : 0,
    maxInstances: maximumInstances,
    culledFrames,
    drawsFewerThanDocument: culledFrames > 0,
    method:
      "brute-force inclusive bounds intersection of every scene object against the camera's visible world bounds, compared with engine.visibleInstanceCount() for each sampled camera",
  };
}

let viewPersistence = null;
let markViewChangedGlobal = () => {};

async function start() {
  try {
    const loaded = await loadScene();
    world = loaded.world;
    zoomRange = loaded.camera ?? { minimumZoom: MINIMUM_ZOOM, maximumZoom: MAXIMUM_ZOOM };
    state.scene = loaded.name;
    state.counts = loaded.counts;
    state.objectCount = loaded.counts.total;
    hudObjectsNode.textContent = String(state.objectCount);
    hudCardsNode.textContent = String(loaded.counts.cards);
    hudZonesNode.textContent = String(loaded.counts.zones);

    if (backendRequested !== null && backendRequested !== "webgl2" && backendRequested !== "webgpu") {
      throw new Error(`unknown backend ${JSON.stringify(backendRequested)}; expected webgl2 or webgpu`);
    }
    // P4-13: `?backend=webgpu` is a preference with automatic fallback (A1), so it
    // selects through the P4-12 `auto` rule; an explicit `webgl2` stays direct and
    // the default path passes no option (byte-identical WebGL2).
    const backendOption =
      backendRequested === "webgpu" ? "auto" : backendRequested === "webgl2" ? "webgl2" : null;
    const engine = await createEngine(canvas, backendOption === null ? {} : { backend: backendOption });
    // The titles scene draws the scene as plain rectangles: its presentation text
    // is bound in the caller, not through the contract seam (AD-4).
    const layers =
      loaded.name === "layers" && !titlesRequested
        ? await loadLayersDocument(engine, loaded)
        : null;
    if (layers === null) {
      engine.loadRectangles(loaded.objects);
    }
    documentLoads += 1;
    state.backend = engine.activeBackend === "webgpu" ? "WebGPU" : "WebGL2";
    state.backendReason = engine.backendReason;
    state.backendAdapter = engine.backendAdapter;
    state.backendFallback = engine.backendFallback;
    // HUD: the default WebGL2 label stays exactly "WebGL2" (the measured
    // reference images are byte-identical); a WebGPU or fallback state names the
    // active backend and its renderer/adapter.
    if (engine.activeBackend === "webgpu") {
      const identity = engine.backendAdapter;
      hudBackendNode.textContent =
        identity === null || identity.vendor.length === 0
          ? "WebGPU"
          : `WebGPU ${identity.vendor}/${identity.architecture}`;
    } else if (engine.backendFallback) {
      hudBackendNode.textContent = `WebGL2 (fallback: ${engine.backendReason})`;
    } else {
      hudBackendNode.textContent = "WebGL2";
    }

    const benchmarkState = benchmarkRequested
      ? {
          status: "loading",
          count: loaded.counts.total,
          warmup: warmupFrames,
          samples: sampleFrames,
          frameTimesMs: [],
          renderer: readRendererString(),
        }
      : null;
    if (benchmarkState !== null) {
      globalThis.__engineBenchmark = benchmarkState;
    }

    // The demo's initial camera is the P4-04 at-rest view: a plain world-centred
    // fit clamped to the camera range. That view is the committed reference
    // contract of this task; the L19 "show all" fit action below uses the engine's
    // padded 100 % fit, and L17/P4-22 will reuse that helper for the restored view.
    // P4-22 (L17): remember the camera per board and device. The record is read
    // before the first fitted frame; the L19 fit remains the fallback when there
    // is no valid record (or storage throws). Writes only follow user camera
    // actions, debounced, and are flushed on page hide.
    const viewIdentity = {
      boardId: `scene:${loaded.name}`,
      deviceKey: deviceKeyFor(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1),
    };
    // Deterministic harness captures run with `?store=off`: persistence is off so
    // the L19 fit always frames the reference scenes (no stale camera).
    // Deterministic/automated contexts disable persistence so the L19 fit always
    // frames a reference or evidence capture: `view=`/`backend=` are harness-only
    // parameters and `store=off` is the deterministic-store switch.
    const viewPersistenceEnabled =
      query.get("store") !== "off" && query.get("view") === null && query.get("backend") === null;
    const viewStorage = viewPersistenceEnabled ? safeBrowserStorage() : null;
    const restoredView = viewStorage === null ? null : loadView(viewStorage, viewIdentity);
    let restoreApplied = false;
    let persistenceReady = false;
    let pendingViewTimer = null;
    let viewWrites = 0;
    const persistView = () => {
      pendingViewTimer = null;
      if (!persistenceReady || viewStorage === null) {
        return;
      }
      if (saveView(viewStorage, viewIdentity, camera)) {
        viewWrites += 1;
      }
    };
    const markViewChanged = () => {
      if (!persistenceReady || viewStorage === null) {
        return;
      }
      if (pendingViewTimer !== null) {
        clearTimeout(pendingViewTimer);
      }
      pendingViewTimer = setTimeout(persistView, 300);
    };
    markViewChangedGlobal = markViewChanged;
    const flushView = () => {
      if (pendingViewTimer !== null) {
        clearTimeout(pendingViewTimer);
        pendingViewTimer = null;
      }
      persistView();
    };
    window.addEventListener("pagehide", flushView);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushView();
      }
    });
    globalThis.__engineView = {
      identity: () => ({ ...viewIdentity }),
      storageAvailable: viewStorage !== null,
      restored: () => restoreApplied,
      camera: () => ({ panX: camera.panX, panY: camera.panY, zoom: camera.zoom }),
      writes: () => viewWrites,
      saveNow: flushView,
      clear: () => {
        try {
          viewStorage?.removeItem(storageKeyFor(viewIdentity.boardId, viewIdentity.deviceKey));
        } catch { /* guarded */ }
      },
    };
    let cameraPlaced = false;
    const canvasViewport = () => {
      const bounds = canvas.getBoundingClientRect();
      return {
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      };
    };
    const placeInitialCamera = () => {
      if (restoredView !== null && !restoreApplied) {
        // Restore before the first fitted frame; a programmatic restore never
        // writes (persistenceReady stays false until after the initial fit).
        restoreApplied = true;
        camera.panX = restoredView.panX;
        camera.panY = restoredView.panY;
        camera.zoom = restoredView.zoom;
        engine.setCamera(camera);
        persistenceReady = true;
        return;
      }
      const viewport = canvasViewport();
      const rawZoom = Math.min(viewport.width / world.width, viewport.height / world.height);
      camera.zoom = clampNumber(rawZoom, zoomRange.minimumZoom, zoomRange.maximumZoom);
      camera.panX = (world.width - viewport.width / camera.zoom) / 2;
      camera.panY = (world.height - viewport.height / camera.zoom) / 2;
      engine.setCamera(camera);
      persistenceReady = true;
    };

    // L19 fit action ("show all"): the engine's pure fit helper returns the padded,
    // at-most-100 % camera; the page never keeps a second copy of the rule.
    const fitBoard = () => {
      const viewport = canvasViewport();
      const fitted = engine.fitView(
        { x: 0, y: 0, width: world.width, height: world.height },
        { width: viewport.width, height: viewport.height },
      );
      camera.panX = fitted.panX;
      camera.panY = fitted.panY;
      camera.zoom = fitted.zoom;
      engine.setCamera(camera);
      onDemand.request();
    };

    // On-demand rendering (L19): a camera, document or resize change requests one
    // frame; while idle no animation frame is scheduled at all, so the canvas
    // produces zero frames. The HUD frame counter makes the idle state visible and
    // `frameCount()` exposes the same counter to the browser evidence.
    const renderState = { lastHudAt: 0 };
    const writeHud = (timestamp) => {
      if (!readyResolved) {
        state.visibleCount = engine.visibleInstanceCount();
        hudVisibleNode.textContent = String(state.visibleCount);
        framesNode.textContent = String(framesRendered);
        renderState.lastHudAt = timestamp;
        settleReady({
          ok: true,
          scene: state.scene,
          counts: { ...state.counts },
          objectCount: state.objectCount,
          visibleCount: state.visibleCount,
        });
        return;
      }
      // At most four HUD text updates per second: the visible count builds the
      // command buffer again, so a per-change update must not double the work.
      if (timestamp - renderState.lastHudAt < 250) {
        return;
      }
      renderState.lastHudAt = timestamp;
      state.visibleCount = engine.visibleInstanceCount();
      hudVisibleNode.textContent = String(state.visibleCount);
      framesNode.textContent = String(framesRendered);
    };
    const renderFrameNow = (timestamp) => {
      frameScheduled = false;
      pendingFrameHandle = 0;
      if (state.stopped) {
        return;
      }
      try {
        engine.renderFrame();
      } catch (error) {
        state.stopped = true;
        showError(error);
        settleReady({ ok: false, error: String(error) });
        return;
      }
      framesRendered += 1;
      titlesOverlay?.update();
      updateChrome();
      writeHud(timestamp);
    };
    const requestFrame = () => {
      if (!onDemand.active || state.stopped || frameScheduled) {
        return;
      }
      frameScheduled = true;
      pendingFrameHandle = window.requestAnimationFrame(renderFrameNow);
    };
    onDemand.request = requestFrame;
    onDemand.fit = fitBoard;
    onDemand.active = benchmarkState === null && !perfRequested;

    const resize = () => {
      const viewport = canvasViewport();
      engine.resize(viewport.width, viewport.height, window.devicePixelRatio || 1);
      if (!cameraPlaced) {
        placeInitialCamera();
        cameraPlaced = true;
      }
      onDemand.request();
    };

    const watchPixelRatio = () => {
      const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media.addEventListener(
        "change",
        () => {
          resize();
          watchPixelRatio();
        },
        { once: true },
      );
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    const observer = new ResizeObserver(() => {
      resize();
    });
    observer.observe(canvas);
    watchPixelRatio();

    if (benchmarkState !== null) {
      settleReady({
        ok: true,
        scene: "benchmark",
        counts: { ...state.counts },
        objectCount: state.objectCount,
        visibleCount: 0,
      });
      startBenchmark(engine, benchmarkState);
      return;
    }

    if (perfRequested) {
      settleReady({
        ok: true,
        scene: state.scene,
        counts: { ...state.counts },
        objectCount: state.objectCount,
        visibleCount: 0,
      });
      startEngineCoreMeasurement(engine, loaded);
      return;
    }

    const requestedView = parseViewQuery(query.get("view"));
    if (requestedView !== null) {
      const viewport = canvasViewport();
      camera.zoom = clampNumber(requestedView.zoom, zoomRange.minimumZoom, zoomRange.maximumZoom);
      camera.panX = requestedView.worldX - viewport.width / camera.zoom / 2;
      camera.panY = requestedView.worldY - viewport.height / camera.zoom / 2;
      engine.setCamera(camera);
      onDemand.request();
    }

    if (titlesRequested || showcaseRequested || overlappingRequested) {
      titlesOverlay = installTitles(engine, loaded);
    }
    if (showcaseRequested) {
      // Deterministic stage showcase: a fixed 200 % camera (sharp atlas bucket),
      // selection chrome on three objects and the snap guides of a fixed drag.
      if (requestedView === null) {
        const viewport = canvasViewport();
        camera.zoom = 2;
        camera.panX = 512 - viewport.width / camera.zoom / 2;
        camera.panY = 288 - viewport.height / camera.zoom / 2;
        engine.setCamera(camera);
        onDemand.request();
      }
      installShowcase(engine, loaded);
    }

    if (textDemoRequested) {
      // Sample board content, not UI text: Latin-1 letters exercise the atlas and
      // U+4E2D is outside the default glyph set, so it draws the placeholder box.
      state.textAtlas = engine.buildTextAtlas();
      engine.addTextRun({ x: 32, y: 32, role: "title", text: "Card title: caf\u00e9, na\u00efve" });
      engine.addTextRun({ x: 32, y: 56, role: "body", text: "Body preview 0123456789 \u4e2d" });
      onDemand.request();
    }

    if (textLayoutRequested) {
      // Sample board content, not UI text. Boxes are the card width (176 px), a
      // zone header width (240 px) and a three-line preview block; the layout runs
      // once inside the engine, so zoom never changes a line break.
      state.textAtlas = engine.buildTextAtlas();
      engine.addTextRun({
        x: 32,
        y: 32,
        role: "title",
        flow: "ellipsis",
        box: { width: 176, height: 0 },
        text: "Moodboard",
      });
      engine.addTextRun({
        x: 32,
        y: 64,
        role: "title",
        flow: "ellipsis",
        box: { width: 176, height: 0 },
        text: "Trip to the Walensee with a Z\u00fcrich stopover",
      });
      engine.addTextRun({
        x: 256,
        y: 32,
        role: "title",
        flow: "ellipsis",
        box: { width: 240, height: 0 },
        text: "Summer at Walensee \u2014 photos and notes for the planning",
      });
      engine.addTextRun({
        x: 32,
        y: 104,
        role: "body",
        flow: "wrap",
        box: { width: 240, height: 60 },
        text: "Meet at the station at nine o'clock.\nThen walk to the shore together, bring a picnic, go to the caf\u00e9 by the harbour if it rains and come back later.",
      });
      engine.addTextRun({
        x: 288,
        y: 104,
        role: "body",
        flow: "wrap",
        box: { width: 176, height: 120 },
        text: "Short text fits.",
      });
      onDemand.request();
    }

    captionNode.textContent = sceneCaption(loaded);
    const requestedFront = query.get("front");
    if (layers !== null && requestedFront !== null) {
      layers.front(requestedFront);
    }
    // L03 (P4-14): one pointer input layer owns click, drag and pan/zoom. The
    // sample and layers scenes get a drag session (preview + one operation per
    // drag); the titles gallery is presentation-only and keeps its hover/select.
    sceneSession = layers !== null ? layers.session : null;
    if (sceneSession === null && loaded.name === "sample" && !titlesRequested) {
      sceneSession = await loadRectangleDragSession(engine, loaded);
    }
    if (zoneLifecycleMode !== null && sceneSession !== null) {
      installZoneLifecycleDemo(sceneSession, zoneLifecycleMode === "demo" ? "grouping" : zoneLifecycleMode);
    }
    if (zoneParityRequested && sceneSession !== null) {
      const overlay = installZoneParityOverlay();
      sceneSession.setZoneParityRenderer?.((state) => overlay?.render(state));
      sceneSession.arrangeZoneDemo?.();
    }
    pointerInput = installPointerInput(engine, sceneSession, titlesOverlay);
    if (inputDemoRequested && layers !== null) {
      inputDemo = installInputDemo(true);
    }
    if (inlineDemoRequested) {
      inlineDemo = installInlineDemo(engine, layers !== null ? layers.session : null);
    }
    installFitKey();
    // One frame is requested by the initial resize; a document or camera change
    // after that only requests a frame when it actually happens.
    onDemand.request();
  } catch (error) {
    showError(error);
    settleReady({ ok: false, error: String(error) });
  }
}

start().catch((error) => {
  showError(error);
  settleReady({ ok: false, error: String(error) });
});
