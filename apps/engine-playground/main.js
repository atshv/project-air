// Engine playground: a deterministic 50,000-rectangle demo over the WebGL2
// engine spike. Render state lives in C++/WASM; this module only builds the
// scene once, sizes the canvas and reports frames per second.

import { createEngine, EngineError } from "@project-air/engine";

const canvas = document.querySelector("#canvas");
const fpsNode = document.querySelector("#fps");
const errorNode = document.querySelector("#error");

if (!(canvas instanceof HTMLCanvasElement) || fpsNode === null || errorNode === null) {
  throw new Error("engine-playground: expected #canvas, #fps and #error in the page");
}

// Deterministic 50,000-rectangle document: 250 x 200 cells, world 8000 x 4500
// (exactly 16:9, like the canvas, so the fitted view fills it without letterbox).
const COLUMNS = 250;
const ROWS = 200;
const SPACING_X = 32;
const SPACING_Y = 22.5;
const RECTANGLE_WIDTH = 20;
const RECTANGLE_HEIGHT = 14;
const WORLD_WIDTH = COLUMNS * SPACING_X;
const WORLD_HEIGHT = ROWS * SPACING_Y;
const TONES = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];
const LAYERS = ["zones", "blocks", "note-cards"];

function createDemoRectangles() {
  const rectangles = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const index = row * COLUMNS + column;
      rectangles.push({
        x: column * SPACING_X,
        y: row * SPACING_Y,
        width: RECTANGLE_WIDTH,
        height: RECTANGLE_HEIGHT,
        tone: TONES[index % TONES.length],
        layer: LAYERS[Math.floor(index / 2000) % LAYERS.length],
      });
    }
  }
  return rectangles;
}

function showError(error) {
  const message = error instanceof EngineError ? error.message : String(error);
  errorNode.hidden = false;
  errorNode.textContent = `engine could not start: ${message}`;
  console.error(error);
}

async function start() {
  try {
    const engine = await createEngine(canvas);
    engine.loadRectangles(createDemoRectangles());

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
      // Fit and centre the whole demo plane; the camera clamps the zoom at 0.1,
      // so narrow viewports crop the document instead of shrinking it further.
      const zoom = Math.min(cssWidth / WORLD_WIDTH, cssHeight / WORLD_HEIGHT);
      const visibleWidth = cssWidth / zoom;
      const visibleHeight = cssHeight / zoom;
      engine.setCamera({
        panX: (WORLD_WIDTH - visibleWidth) / 2,
        panY: (WORLD_HEIGHT - visibleHeight) / 2,
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

    frameTimes.lastUpdate = performance.now();
    window.requestAnimationFrame(frame);
  } catch (error) {
    showError(error);
  }
}

start().catch(showError);
