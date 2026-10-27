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
//
// Interaction: pointer drag pans, wheel or two-pointer pinch zooms around the
// pointer, and `f` ("show all", L19) fits the board through the engine's fit
// helper. The scene data never changes.
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
  backend: "WebGL2",
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
    camera: { ...camera },
    textAtlas: state.textAtlas === null ? null : { ...state.textAtlas },
  }),
  frameCount: () => framesRendered,
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
      title: "Sommer am Walensee",
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
      title: "Wanderung an den Walensee mit \u00dcbernachtung im Berghaus am See",
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
      title: "Packliste",
      preview:
        "Zelt, Schlafsack, Isomatte, Kocher, Wasser, Caf\u00e9, Tee und eine warme Jacke f\u00fcr die Nacht am See. Am Morgen Fr\u00fchst\u00fcck am Ufer, danach gemeinsam aufr\u00e4umen und die R\u00fcckfahrt planen.",
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
      title: "Ablauf",
      preview:
        "Treffpunkt am Bahnhof um neun Uhr, danach gemeinsam zum Ufer. Picknick mitbringen und bei Regen ins Caf\u00e9 am Hafen.",
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
      preview: "Fotos, Farben und Referenzen f\u00fcr die Reise.",
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
      title: "Ausflug an den Walensee mit \u00dcbernachtung",
      preview:
        "Am Ufer entlang bis zur Br\u00fccke, dann zur\u00fcck \u00fcber den Hof. Bei Regen ins Caf\u00e9 am Hafen.",
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
      title: "Caf\u00e9-Notizen f\u00fcr die Reise",
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
      title: "Ideen",
      preview: "Kurz und gut.",
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

  const objectIdAt = (screenX, screenY) => {
    const index = engine.hitTest(screenX, screenY);
    const object = objects.find((candidate) => candidate.slot === index);
    return object === undefined || object.removed === true ? null : object.id;
  };

  const setHovered = (id) => {
    if (hovered === id) {
      return;
    }
    hovered = id;
    apply();
  };

  const tap = (screenX, screenY) => {
    const id = objectIdAt(screenX, screenY);
    selected = selected === id ? null : id;
    apply();
  };

  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons !== 0) {
      return;
    }
    const point = screenPointOf(event);
    setHovered(objectIdAt(point.x, point.y));
  });
  canvas.addEventListener("pointerleave", (event) => {
    const related = event.relatedTarget;
    if (related instanceof Element && related.closest(".object-action") !== null) {
      // The pointer moved onto the revealed affordance: the control keeps the
      // object hovered and its own pointerleave clears the state.
      return;
    }
    setHovered(null);
  });

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
  return { update: updatePositions, tap, remove };
}

async function loadScene() {
  if (titlesRequested) {
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
  const name = testKit.isSceneName(requestedScene)
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
  if (titlesRequested) {
    return `${loaded.counts.total} objects — zone names, card titles cut with an ellipsis and block previews bound to the visible objects; blocks grow to their preview height and the delete affordance appears on hover, focus or selection.`;
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
  const [{ applyOperation, buildOperation }, { createEngineDocumentPort }, { createHistory }] =
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
  return { front, frontAt };
}

// Pointer drag pan and wheel/pinch zoom for the demo. L15 (P4-24) refines the
// exact trackpad defaults later; this is the basic demo behaviour.
function installInteraction(engine, onTap = null) {
  const pointers = new Map();
  let lastPointer = null;
  let pinch = null;
  // A press that moves less than the 4 px drag threshold is a tap, not a pan.
  let tap = null;

  const applyCamera = () => {
    engine.setCamera(camera);
    // On-demand rendering: one camera change requests exactly one frame.
    onDemand.request();
  };

  const distanceOf = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
  const midpointOf = (left, right) => ({
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  });

  const zoomAround = (screenX, screenY, requestedZoom) => {
    const nextZoom = clampNumber(requestedZoom, zoomRange.minimumZoom, zoomRange.maximumZoom);
    if (nextZoom === camera.zoom) {
      return;
    }
    // Keep the world point under the pointer fixed while the zoom changes.
    const worldX = camera.panX + screenX / camera.zoom;
    const worldY = camera.panY + screenY / camera.zoom;
    camera.zoom = nextZoom;
    camera.panX = worldX - screenX / nextZoom;
    camera.panY = worldY - screenY / nextZoom;
    applyCamera();
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    const point = screenPointOf(event);
    pointers.set(event.pointerId, point);
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      lastPointer = point;
      tap = { x: point.x, y: point.y };
      canvas.classList.add("is-dragging");
      return;
    }
    tap = null;
    const [first, second] = [...pointers.values()];
    if (first === undefined || second === undefined) {
      return;
    }
    const middle = midpointOf(first, second);
    pinch = {
      distance: Math.max(distanceOf(first, second), 1),
      zoom: camera.zoom,
      worldX: camera.panX + middle.x / camera.zoom,
      worldY: camera.panY + middle.y / camera.zoom,
    };
    lastPointer = null;
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }
    const point = screenPointOf(event);
    pointers.set(event.pointerId, point);
    if (pointers.size >= 2 && pinch !== null) {
      const [first, second] = [...pointers.values()];
      if (first === undefined || second === undefined) {
        return;
      }
      const middle = midpointOf(first, second);
      const nextZoom = clampNumber(
        pinch.zoom * (distanceOf(first, second) / pinch.distance),
        zoomRange.minimumZoom,
        zoomRange.maximumZoom,
      );
      camera.zoom = nextZoom;
      camera.panX = pinch.worldX - middle.x / nextZoom;
      camera.panY = pinch.worldY - middle.y / nextZoom;
      applyCamera();
      return;
    }
    if (tap !== null && Math.hypot(point.x - tap.x, point.y - tap.y) >= TAP_SLOP) {
      tap = null;
    }
    if (pointers.size === 1 && lastPointer !== null) {
      camera.panX -= (point.x - lastPointer.x) / camera.zoom;
      camera.panY -= (point.y - lastPointer.y) / camera.zoom;
      lastPointer = point;
      applyCamera();
    }
  });

  const endPointer = (event) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (tap !== null && event.type === "pointerup" && onTap !== null && pointers.size === 0) {
      onTap(tap.x, tap.y);
    }
    tap = null;
    pinch = null;
    if (pointers.size === 0) {
      lastPointer = null;
      canvas.classList.remove("is-dragging");
      return;
    }
    const [remaining] = [...pointers.values()];
    lastPointer = remaining ?? null;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const point = screenPointOf(event);
      // Normalise line/page deltas to pixels so mice and trackpads zoom alike.
      let delta = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        delta *= 16;
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        delta *= 100;
      }
      zoomAround(point.x, point.y, camera.zoom * Math.exp(-delta * 0.0015));
    },
    { passive: false },
  );
}

// L19 fit action on the keyboard: `f` ("show all"). It calls the same fit function
// as the exposed `fit()` hook, so the browser evidence and the visual scene drive
// exactly the user path; a modifier or an already-handled key is left alone.
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

    const engine = await createEngine(canvas);
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
    hudBackendNode.textContent = state.backend;

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
    let cameraPlaced = false;
    const canvasViewport = () => {
      const bounds = canvas.getBoundingClientRect();
      return {
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      };
    };
    const placeInitialCamera = () => {
      const viewport = canvasViewport();
      const rawZoom = Math.min(viewport.width / world.width, viewport.height / world.height);
      camera.zoom = clampNumber(rawZoom, zoomRange.minimumZoom, zoomRange.maximumZoom);
      camera.panX = (world.width - viewport.width / camera.zoom) / 2;
      camera.panY = (world.height - viewport.height / camera.zoom) / 2;
      engine.setCamera(camera);
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

    if (titlesRequested) {
      titlesOverlay = installTitles(engine, loaded);
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
        text: "Ausflug an den Walensee mit \u00dcbernachtung",
      });
      engine.addTextRun({
        x: 256,
        y: 32,
        role: "title",
        flow: "ellipsis",
        box: { width: 240, height: 0 },
        text: "Sommer am Walensee \u2014 Fotos und Notizen f\u00fcr die Planung",
      });
      engine.addTextRun({
        x: 32,
        y: 104,
        role: "body",
        flow: "wrap",
        box: { width: 240, height: 60 },
        text: "Treffpunkt am Bahnhof um neun Uhr.\nDanach gemeinsam zum Ufer, Picknick mitbringen, bei Regen ins Caf\u00e9 am Hafen und sp\u00e4ter zur\u00fcck.",
      });
      engine.addTextRun({
        x: 288,
        y: 104,
        role: "body",
        flow: "wrap",
        box: { width: 176, height: 120 },
        text: "Kurzer Text passt.",
      });
      onDemand.request();
    }

    captionNode.textContent = sceneCaption(loaded);
    const requestedFront = query.get("front");
    if (layers !== null && requestedFront !== null) {
      layers.front(requestedFront);
    }
    installInteraction(
      engine,
      layers !== null
        ? (screenX, screenY) => {
            layers.frontAt(screenX, screenY);
          }
        : titlesOverlay === null
          ? null
          : (screenX, screenY) => {
              titlesOverlay.tap(screenX, screenY);
            },
    );
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
