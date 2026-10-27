#!/usr/bin/env node
// L02 (P4-10) before/after evidence for the engine-owned visible-quality defects.
//
//   node apps/engine-playground/tools/capture-titles.mjs --mode before|after|all
//
// Starts its own static server on the worktree's playground port and headless
// Chrome for Testing with the documented WebGL2 flags, waits for the playground's
// ready hook, pauses the on-demand scheduler and captures deterministic
// screenshots plus one JSON record per run:
//
//   before — the P4-09 playground: no bound titles, no 40 px header chrome, no
//            quiet delete affordance (canvas text still floats in `?text=layout`).
//   after  — the P4-10 `?text=titles` scene: titles/previews bound to the layers
//            board, the 40 px header band, the grown block, at 100 % and 200 %
//            (the sharp zoom bucket) and the delete affordance at rest, on hover
//            and on keyboard focus.
//
// The record `reviews/evidence/P4-10-capture-<mode>-<timestamp>.json` stores the
// URL, camera, atlas raster scale, binding and affordance state of every shot, so
// the images and the numbers agree. The 200 % shot records the atlas raster scale
// the zoom bucket selected. Node builtins only; it starts and stops only its own
// server and browser and removes its temporary folder.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVIDENCE_DIR = join(REPO_ROOT, "reviews", "evidence");
const PLAYWRIGHT_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const TASK = "P4-10";

const DESKTOP = { name: "desktop", width: 1440, height: 900, mobile: false };
const MOBILE = { name: "mobile", width: 390, height: 844, mobile: true };

// Scene cameras: the layers world is 1024 x 576 px, so at 100 % the whole board
// fits a desktop viewport and at 200 % the zone header and the grown block fill
// the frame.
const LAYERS_VIEW = "512,288,1";
const LAYERS_VIEW_200 = "512,240,2";
const CARD_HOVER_WORLD = { x: 400, y: 288 };

const BEFORE_SHOTS = [
  {
    file: "P4-10-before-titles-desktop.png",
    viewport: DESKTOP,
    url: `?scene=layers&store=off&view=${LAYERS_VIEW}`,
    note: "P4-09 playground: the layers board without bound titles, headers or previews",
  },
  {
    file: "P4-10-before-titles-zoom200-desktop.png",
    viewport: DESKTOP,
    url: `?scene=layers&store=off&view=${LAYERS_VIEW_200}`,
    note: "P4-09 playground at 200 %: no title text, no 40 px header, no zone inset",
  },
  {
    file: "P4-10-before-floating-text-desktop.png",
    viewport: DESKTOP,
    url: "?scene=stress&count=0&text=layout&view=272,112,1",
    note: "P4-09 `?text=layout`: text floats at world coordinates, not bound to an object",
  },
  {
    file: "P4-10-before-delete-hover-desktop.png",
    viewport: DESKTOP,
    url: `?scene=layers&store=off&view=${LAYERS_VIEW}`,
    hoverWorld: CARD_HOVER_WORLD,
    note: "P4-09 playground hovered over card-0002: no delete affordance exists",
  },
];

const AFTER_SHOTS = [
  {
    file: "P4-10-after-titles-desktop.png",
    viewport: DESKTOP,
    url: `?text=titles&view=${LAYERS_VIEW}`,
    note: "P4-10 at 100 %: ellipsis titles, 40 px headers, zone inset, grown block",
  },
  {
    file: "P4-10-after-titles-zoom200-desktop.png",
    viewport: DESKTOP,
    url: `?text=titles&view=${LAYERS_VIEW_200}`,
    note: "P4-10 at 200 %: the zoom bucket re-rasterises the atlas, text stays sharp",
  },
  {
    file: "P4-10-after-titles-mobile.png",
    viewport: MOBILE,
    url: `?text=titles&view=${LAYERS_VIEW}`,
    note: "P4-10 at 390 x 844: bound titles and the quiet affordance on a narrow viewport",
  },
  {
    file: "P4-10-after-delete-rest-desktop.png",
    viewport: DESKTOP,
    url: `?text=titles&view=${LAYERS_VIEW}`,
    note: "P4-10 delete affordance at rest: invisible, no character icon",
  },
  {
    file: "P4-10-after-delete-selection-desktop.png",
    viewport: DESKTOP,
    url: `?text=titles&view=${LAYERS_VIEW}`,
    clickWorld: CARD_HOVER_WORLD,
    note: "P4-10 delete affordance visible after a tap selects card-0002",
  },
  {
    file: "P4-10-after-delete-hover-desktop.png",
    viewport: DESKTOP,
    url: `?text=titles&view=${LAYERS_VIEW}`,
    hoverWorld: CARD_HOVER_WORLD,
    note: "P4-10 delete affordance visible while the card is hovered",
  },
  {
    file: "P4-10-after-delete-focus-desktop.png",
    viewport: DESKTOP,
    url: `?text=titles&view=${LAYERS_VIEW}`,
    pressTab: true,
    note: "P4-10 delete affordance visible on keyboard focus after Tab",
  },
];

const REQUIRED_ARTEFACTS = [
  "apps/engine-playground/index.html",
  "apps/engine-playground/main.js",
  "apps/engine-playground/playground.css",
  "packages/ui-kit/tokens.css",
  "packages/engine/dist/bridge/engine.js",
  "packages/engine/dist/bridge/text-atlas.js",
  "packages/engine/build-wasm/engine.js",
  "packages/engine/build-wasm/engine.wasm",
  "packages/test-kit/dist/scenes.js",
];

const BASE_CHROME_FLAGS = [
  "--headless=new",
  "--use-angle=metal",
  "--enable-gpu",
  "--hide-scrollbars",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--window-size=1440,900",
];

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function usage(message) {
  process.stderr.write(`capture-titles: ${message}\n`);
  process.stderr.write(
    "usage: node apps/engine-playground/tools/capture-titles.mjs --mode before|after|all\n",
  );
  process.exit(2);
}

function parseMode(argv) {
  const index = argv.indexOf("--mode");
  const mode = index >= 0 ? argv[index + 1] : "all";
  if (mode !== "before" && mode !== "after" && mode !== "all") {
    usage(`unknown --mode "${String(mode)}"`);
  }
  return mode;
}

function requireArtefacts() {
  const missing = REQUIRED_ARTEFACTS.filter((relative) => !existsSync(join(REPO_ROOT, relative)));
  if (missing.length > 0) {
    throw new Error(
      `missing build artefacts: ${missing.join(", ")}; run the bridge, WASM and test-kit builds first`,
    );
  }
}

function playgroundPort() {
  const slotPath = join(REPO_ROOT, ".polier-slot");
  if (!existsSync(slotPath)) {
    throw new Error(`missing ${slotPath}; acquire a Polier slot for this worktree first`);
  }
  const slot = JSON.parse(readFileSync(slotPath, "utf8"));
  const port = slot?.ports?.playground;
  if (!Number.isInteger(port)) {
    throw new Error(`${slotPath} has no integer ports.playground`);
  }
  return port;
}

// Best-effort cleanup: a killed Chrome may still write into its user-data dir for
// a moment, and a cleanup failure must never hide the capture error.
function removeDirectory(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // The temporary directory is outside the repository; leaving it is harmless.
  }
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function startStaticServer(port) {
  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) {
        pathname += "index.html";
      }
      const filePath = resolve(REPO_ROOT, `.${pathname}`);
      if (!filePath.startsWith(resolve(REPO_ROOT) + "/")) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const body = readFileSync(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        rejectServer(new Error(`port ${port} is already in use; rerun the capture alone`));
        return;
      }
      rejectServer(error);
    });
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

function findChrome() {
  const candidates = [];
  const override = process.env.CHROME_PATH;
  if (typeof override === "string" && override.length > 0) {
    candidates.push(override);
  }
  if (existsSync(PLAYWRIGHT_CACHE)) {
    for (const entry of readdirSync(PLAYWRIGHT_CACHE).sort()) {
      if (!entry.startsWith("chromium-")) {
        continue;
      }
      for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
        candidates.push(
          join(
            PLAYWRIGHT_CACHE,
            entry,
            arch,
            "Google Chrome for Testing.app",
            "Contents",
            "MacOS",
            "Google Chrome for Testing",
          ),
        );
      }
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("no Chrome found; set CHROME_PATH to a Chrome for Testing binary");
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForDebugPort(port, timeoutMilliseconds = 20000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // not up yet
    }
    await delay(200);
  }
  throw new Error(`Chrome debug port ${port} did not open`);
}

function createClient(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  return (method, params = {}) =>
    new Promise((resolveCall) => {
      nextId += 1;
      pending.set(nextId, resolveCall);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
}

async function evaluate(send, expression, options = {}) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: options.awaitPromise === true,
  });
  const details = response.result?.exceptionDetails;
  if (details !== undefined) {
    throw new Error(`page evaluation failed: ${details.text ?? JSON.stringify(details)}`);
  }
  return response.result?.result?.value;
}

async function waitForPlayground(send) {
  const deadline = Date.now() + 30000;
  let lastError = "the playground object never appeared";
  while (Date.now() < deadline) {
    const present = await evaluate(send, "typeof globalThis.__enginePlayground === 'object'");
    if (present === true) {
      const ready = await evaluate(
        send,
        "globalThis.__enginePlayground.ready.then((state) => JSON.stringify(state))",
        { awaitPromise: true },
      );
      if (typeof ready === "string") {
        const state = JSON.parse(ready);
        if (state.ok === true) {
          return state;
        }
        lastError = state.error ?? "the engine reported that it did not start";
        break;
      }
      lastError = "the ready hook did not resolve";
    }
    await delay(250);
  }
  throw new Error(`the playground did not become ready: ${lastError}`);
}

const HIDE_VOLATILE_HUD_EXPRESSION = `(() => {
  const frames = document.querySelector("#frames");
  const item = frames === null ? null : frames.closest(".hud__item") ?? frames;
  if (item instanceof HTMLElement) {
    item.style.setProperty("display", "none");
  }
  return true;
})()`;

const SETTLE_EXPRESSION = `new Promise((resolve) => {
  const frames = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  };
  if (document.fonts !== undefined && document.fonts.ready !== undefined) {
    document.fonts.ready.then(frames, frames);
  } else {
    frames();
  }
})`;

// Screen point of a world point in the canvas, from the page's own camera and
// canvas box, so the hover shot hits the same object the camera shows.
const worldToScreenExpression = (world) => `(() => {
  const canvas = document.querySelector("#canvas");
  const state = globalThis.__enginePlayground.getState();
  const bounds = canvas.getBoundingClientRect();
  const camera = state.camera;
  return {
    x: bounds.left + (${world.x} - camera.panX) * camera.zoom,
    y: bounds.top + (${world.y} - camera.panY) * camera.zoom
  };
})()`;

// Affordance state of every delete control. Besides the reveal states (opacity,
// hovered/selected object, active element) this records the L02/F2 pointer rule:
// a control that is invisible at rest must not be a pointer target, so
// `elementFromPoint` at its centre has to return something other than the button.
// `invisibleHitTests` lists invisible controls whose centre still hits the button
// (0 = pass) and `invisiblePassThrough` is the aggregate check.
const AFFORDANCE_EXPRESSION = `(() => {
  const buttons = [...document.querySelectorAll(".object-action")];
  const states = buttons.map((button) => {
    const style = getComputedStyle(button);
    const opacity = Number(style.opacity);
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      visible: opacity > 0.5,
      opacity,
      pointerEvents: style.pointerEvents,
      hitIsSelf: hit === button
    };
  });
  const active = document.activeElement;
  return {
    deleteControls: buttons.length,
    visibleControls: states.filter((state) => state.visible).length,
    minOpacity: states.length === 0 ? null : Math.min(...states.map((state) => state.opacity)),
    pointerEvents: states.map((state) => state.pointerEvents),
    invisibleHitTests: states.filter((state) => !state.visible && state.hitIsSelf).length,
    invisiblePassThrough: states.filter((state) => !state.visible).every((state) => !state.hitIsSelf),
    iconCharacters: buttons.map((button) => (button.textContent ?? "").trim()).filter((text) => text.length > 0),
    iconSvgs: buttons.filter((button) => button.querySelector("svg") !== null).length,
    activeElement:
      active instanceof HTMLElement
        ? { tag: active.tagName.toLowerCase(), label: active.getAttribute("aria-label") ?? null }
        : null
  };
})()`;

const STATE_EXPRESSION = `JSON.stringify({
  state: globalThis.__enginePlayground.getState(),
  error: document.querySelector("#error")?.textContent ?? "",
  textBindings: globalThis.__engineTitles?.summary?.() ?? null
})`;

async function captureShot({ send, shot, baseUrl, mode }) {
  const viewport = shot.viewport;
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  const url = `${baseUrl}${shot.url}`;
  await send("Page.navigate", { url });
  const ready = await waitForPlayground(send);
  await evaluate(send, HIDE_VOLATILE_HUD_EXPRESSION);
  await evaluate(send, "globalThis.__enginePlayground.pause()");
  await evaluate(send, SETTLE_EXPRESSION, { awaitPromise: true });
  await delay(150);

  let hoverPoint = null;
  if (shot.hoverWorld !== undefined) {
    hoverPoint = await evaluate(send, worldToScreenExpression(shot.hoverWorld));
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(hoverPoint.x),
      y: Math.round(hoverPoint.y),
      button: "none",
    });
    await delay(120);
  }
  let clickedPoint = null;
  if (shot.clickWorld !== undefined) {
    clickedPoint = await evaluate(send, worldToScreenExpression(shot.clickWorld));
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: Math.round(clickedPoint.x),
      y: Math.round(clickedPoint.y),
      button: "left",
      clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: Math.round(clickedPoint.x),
      y: Math.round(clickedPoint.y),
      button: "left",
      clickCount: 1,
    });
    await delay(150);
  }
  let tabPressed = false;
  if (shot.pressTab === true) {
    // A real Tab key event, so keyboard reachability is what is captured.
    const key = {
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    await delay(120);
    tabPressed = true;
  }

  const affordance = await evaluate(send, AFFORDANCE_EXPRESSION);
  const stateRaw = await evaluate(send, STATE_EXPRESSION);
  const pageState = typeof stateRaw === "string" ? JSON.parse(stateRaw) : null;
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(String(screenshot.result?.data ?? ""), "base64");
  if (bytes.length === 0) {
    throw new Error(`the screenshot of ${shot.file} was empty`);
  }
  const file = join(EVIDENCE_DIR, shot.file);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(file, bytes);
  process.stdout.write(`${shot.file} ${viewport.width}x${viewport.height} ${shot.url}\n`);
  return {
    mode,
    file: `reviews/evidence/${shot.file}`,
    url,
    viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
    note: shot.note,
    ready,
    camera: pageState?.state?.camera ?? null,
    textAtlas: pageState?.state?.textAtlas ?? null,
    textBindings: pageState?.textBindings ?? null,
    pageError: pageState?.error ?? "",
    hover: hoverPoint === null ? null : { world: shot.hoverWorld, screen: hoverPoint },
    click: clickedPoint === null ? null : { world: shot.clickWorld, screen: clickedPoint },
    tabPressed,
    affordance,
    sha256: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
  };
}

function rendererOf(send) {
  return evaluate(
    send,
    `(() => {
      const canvas = document.querySelector("#canvas");
      const gl = canvas === null ? null : canvas.getContext("webgl2");
      const extension = gl === null ? null : gl.getExtension("WEBGL_debug_renderer_info");
      return extension === null ? "unknown" : String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL));
    })()`,
  );
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  requireArtefacts();
  const shots = [
    ...(mode === "after" ? [] : BEFORE_SHOTS),
    ...(mode === "before" ? [] : AFTER_SHOTS),
  ];
  const port = playgroundPort();
  const baseUrl = `http://127.0.0.1:${port}/apps/engine-playground/`;
  const server = await startStaticServer(port);
  const debugPort = await getFreePort();
  const chrome = findChrome();
  const userDataDir = join("/tmp", `p410-titles-${process.pid}`);
  removeDirectory(userDataDir);
  const child = spawn(
    chrome,
    [
      ...BASE_CHROME_FLAGS,
      "--no-sandbox",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      baseUrl,
    ],
    { stdio: "ignore" },
  );

  const record = {
    task: TASK,
    mode,
    startedAt: new Date().toISOString(),
    chrome,
    flags: [...BASE_CHROME_FLAGS, "--no-sandbox"],
    viewports: { desktop: DESKTOP, mobile: MOBILE },
    shots: [],
  };

  try {
    const targets = await waitForDebugPort(debugPort);
    const target = targets.find((candidate) => candidate.type === "page");
    if (target === undefined) {
      throw new Error("no page target in Chrome");
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen) => socket.addEventListener("open", resolveOpen, { once: true }));
    const send = createClient(socket);
    await send("Page.enable");
    await send("Runtime.enable");
    await delay(500);

    for (const shot of shots) {
      record.shots.push(await captureShot({ send, shot, baseUrl, mode }));
    }
    record.renderer = await rendererOf(send);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const recordFile = join(EVIDENCE_DIR, `${TASK}-capture-${mode}-${stamp}.json`);
    writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    process.stdout.write(`record: reviews/evidence/${recordFile.split("/").pop()}\n`);
    await send("Browser.close");
    await new Promise((resolveExit) => child.once("exit", resolveExit));
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolveExit) => {
      const timer = setTimeout(resolveExit, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
    removeDirectory(userDataDir);
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
