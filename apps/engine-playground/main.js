// Engine playground: a deterministic 50,000-rectangle demo over the WebGL2
// engine spike. Render state lives in C++/WASM; this module builds the scene
// once, sizes the canvas, reports frames per second, and offers the benchmark
// mode used by packages/engine/test/perf/run-perf.mjs.
//
// Benchmark mode (query parameters, normal demo unchanged without them):
//   ?bench=<rectangles>&samples=<n>&warmup=<n>
// Writes window.__engineBenchmark = { status, count, warmup, samples,
// frameTimesMs, renderer, ... } and logs one PERF_RESULT JSON line when done.

import { createEngine, EngineError } from "@project-air/engine";

const canvas = document.querySelector("#canvas");
const fpsNode = document.querySelector("#fps");
const errorNode = document.querySelector("#error");

if (!(canvas instanceof HTMLCanvasElement) || fpsNode === null || errorNode === null) {
  throw new Error("engine-playground: expected #canvas, #fps and #error in the page");
}

// Deterministic document: 250 columns, 200 rows = 50,000 rectangles, world
// 8000 x 4500 (exactly 16:9, like the canvas, so the fitted view fills it).
const COLUMNS = 250;
const ROWS = 200;
const SPACING_X = 32;
const SPACING_Y = 22.5;
const RECTANGLE_WIDTH = 20;
const RECTANGLE_HEIGHT = 14;
const TONES = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];
const LAYERS = ["zones", "blocks", "note-cards"];

const query = new URLSearchParams(window.location.search);
const benchQuery = query.get("bench");
const benchmarkRequested = benchQuery !== null;
const requestedCount = clampInteger(parseInteger(benchQuery, COLUMNS * ROWS), 0, 1000000);
const warmupFrames = clampInteger(parseInteger(query.get("warmup"), 120), 0, 10000);
const sampleFrames = clampInteger(parseInteger(query.get("samples"), 600), 1, 10000);
const scene = createScene(benchmarkRequested ? requestedCount : COLUMNS * ROWS);

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

function startBenchmark(engine, state) {
  state.status = "warmup";
  state.renderer = readRendererString();
  state.startedAt = Date.now();
  state.canvas = {
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
  fpsNode.textContent = "benchmark";

  let previousTimestamp = 0;
  let renderedFrames = 0;
  const frame = (timestamp) => {
    try {
      engine.renderFrame();
    } catch (error) {
      state.status = "error";
      state.error = String(error);
      console.error(error);
      return;
    }
    renderedFrames += 1;
    // Discard warm-up frames; sample the interval between rendered frames.
    if (renderedFrames > state.warmup) {
      if (previousTimestamp !== 0) {
        state.frameTimesMs.push(timestamp - previousTimestamp);
      }
      if (state.frameTimesMs.length >= state.samples) {
        state.status = "done";
        state.framesRendered = renderedFrames;
        state.finishedAt = Date.now();
        fpsNode.textContent = "benchmark done";
        console.log(`PERF_RESULT ${JSON.stringify(state)}`);
        return;
      }
    }
    previousTimestamp = timestamp;
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

async function start() {
  try {
    const engine = await createEngine(canvas);
    engine.loadRectangles(scene.rectangles);

    const benchmarkState = benchmarkRequested
      ? {
          status: "loading",
          count: scene.rectangles.length,
          warmup: warmupFrames,
          samples: sampleFrames,
          frameTimesMs: [],
          renderer: null,
        }
      : null;
    if (benchmarkState !== null) {
      globalThis.__engineBenchmark = benchmarkState;
    }

    const frameTimes = { frames: 0, lastUpdate: performance.now() };
    let disposed = false;

    // Evidence hook for apps/engine-playground/tools/capture.mjs: pausing stops
    // the loop so the captured screenshot's fps label matches the logged value.
    globalThis.__enginePlayground = {
      pause: () => {
        disposed = true;
      },
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.round(bounds.width));
      const cssHeight = Math.max(1, Math.round(bounds.height));
      const devicePixelRatio = window.devicePixelRatio || 1;
      engine.resize(cssWidth, cssHeight, devicePixelRatio);
      // Fit and centre the whole document; the camera clamps the zoom at 0.1,
      // so narrow viewports crop the document instead of shrinking it further.
      const zoom = Math.min(
        cssWidth / scene.worldWidth,
        cssHeight / scene.worldHeight,
      );
      const visibleWidth = cssWidth / zoom;
      const visibleHeight = cssHeight / zoom;
      engine.setCamera({
        panX: (scene.worldWidth - visibleWidth) / 2,
        panY: (scene.worldHeight - visibleHeight) / 2,
        zoom,
      });
    };

    const frame = (timestamp) => {
      if (disposed) {
        return;
      }
      try {
        engine.renderFrame();
      } catch (error) {
        disposed = true;
        showError(error);
        return;
      }
      frameTimes.frames += 1;
      const elapsed = timestamp - frameTimes.lastUpdate;
      if (elapsed >= 1000) {
        const fps = (frameTimes.frames * 1000) / elapsed;
        fpsNode.textContent = `${fps.toFixed(0)} fps`;
        frameTimes.frames = 0;
        frameTimes.lastUpdate = timestamp;
      }
      window.requestAnimationFrame(frame);
    };

    const watchPixelRatio = () => {
      const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      query.addEventListener(
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
      startBenchmark(engine, benchmarkState);
      return;
    }
    frameTimes.lastUpdate = performance.now();
    window.requestAnimationFrame(frame);
  } catch (error) {
    showError(error);
  }
}

start().catch(showError);
