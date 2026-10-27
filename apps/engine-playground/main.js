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
//   ?perf=engine-core&scene=<name>&samples=<n>&warmup=<n>[&verifyCulling=1]
//                                  engine-core perf measurement driven by
//                                  packages/engine/test/perf/run-perf.mjs: one
//                                  deterministic pan/zoom camera path, one
//                                  setCamera per frame, frame intervals after
//                                  the warm-up, optional culling verification
//   ?bench=<n>&samples=<n>&warmup=<n>
//                                  benchmark loop kept unchanged for
//                                  packages/engine/test/perf/run-perf.mjs
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
};
let zoomRange = { minimumZoom: MINIMUM_ZOOM, maximumZoom: MAXIMUM_ZOOM };
let world = { width: 1, height: 1 };

// On-demand rendering state (L19): at most one frame is scheduled at a time and
// the scheduler stops while idle. `onDemand` is armed only in the normal
// (non-benchmark, non-perf) mode; the benchmark and perf loops stay continuous.
let framesRendered = 0;
let frameScheduled = false;
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

async function loadScene() {
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

// Pointer drag pan and wheel/pinch zoom for the demo. L15 (P4-24) refines the
// exact trackpad defaults later; this is the basic demo behaviour.
function installInteraction(engine) {
  const pointers = new Map();
  let lastPointer = null;
  let pinch = null;

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
      canvas.classList.add("is-dragging");
      return;
    }
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
    engine.loadRectangles(loaded.objects);
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

    captionNode.textContent = sceneCaption(loaded);
    installInteraction(engine);
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
