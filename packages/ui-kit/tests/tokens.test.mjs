// A1: every token group and design-law value is present, in the expected form,
// and nothing outside docs/design-rules.md (values: blueprint 21.1 first, then
// reference/src/app/globals.css) was invented.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tokens = JSON.parse(readFileSync(new URL("../tokens.json", import.meta.url), "utf8"));

const EXPECTED_COLOURS = {
  bg: "#121412",
  canvas: "#151815",
  surface: "#1a1d1a",
  card: "#202420",
  fg: "rgba(255, 255, 255, 0.92)",
  muted: "rgba(255, 255, 255, 0.66)",
  faint: "rgba(255, 255, 255, 0.12)",
  border: "rgba(255, 255, 255, 0.08)",
  "border-strong": "rgba(255, 255, 255, 0.16)",
  accent: "#8fbfaf",
  "accent-soft": "rgba(143, 191, 175, 0.14)",
  "accent-line": "rgba(143, 191, 175, 0.4)",
  danger: "#f0a8a0",
  "tone-a": "#8fbfaf",
  "tone-b": "#d9bd8f",
  "tone-c": "#b8a6e0",
  "tone-d": "#8fb0dc",
  "tone-e": "#dca48f",
};

const EXPECTED_SPACING = {
  "space-4": "4px",
  "space-8": "8px",
  "space-12": "12px",
  "space-16": "16px",
  "space-24": "24px",
  "space-32": "32px",
  "space-48": "48px",
};

const EXPECTED_SIZES = {
  "border-width": "1px",
  "border-width-strong": "1.5px",
  "outline-width": "2px",
  "outline-offset": "2px",
  "canvas-grid": "16px",
  "drag-threshold": "4px",
  "snap-tolerance": "6px",
  "header-height": "40px",
  "click-target": "32px",
  "click-target-coarse": "44px",
  "icon-bar": "20px",
  "button-bar": "36px",
  "icon-card": "16px",
  "button-card": "28px",
};

const EXPECTED_RADII = {
  "radius-sm": "10px",
  "radius-md": "14px",
  "radius-lg": "20px",
  "radius-tooltip": "6px",
  "radius-pill": "9999px",
};

const EXPECTED_TYPOGRAPHY = {
  "font-sans": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  "font-serif": '"Source Serif 4", Georgia, serif',
  "text-28": "28px",
  "text-24": "24px",
  "text-22": "22px",
  "text-15": "15px",
  "text-13": "13px",
  "text-11": "11px",
  "text-12": "12px",
  "weight-regular": 400,
  "weight-medium": 500,
  "weight-semibold": 600,
  "line-height": 1.4,
  "tracking-label": "0.1em",
};

const EXPECTED_MOTION = {
  "motion-hover": "120ms",
  "motion-fade": "150ms",
  "motion-panel": "180ms",
  "motion-tooltip": "300ms",
  "motion-saved": "2000ms",
};

const EXPECTED_SHADOWS = {
  "card-shadow": "0 10px 30px -16px rgba(0, 0, 0, 0.7)",
  shadow: "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 24px 60px -24px rgba(0, 0, 0, 0.6)",
};

const EXPECTED_LAYERS = [
  ["canvas-background", "1", 1],
  ["zones", "2", 2],
  ["edges", "3", 3],
  ["blocks", "4", 4],
  ["note-cards", "5", 5],
  ["dragged-or-selected", "6", 6],
  ["snap-guides", "7", 7],
  ["remote-cursors", "7a", 7],
  ["canvas-chrome", "8", 8],
  ["side-panel", "9", 9],
  ["context-menu", "10", 10],
  ["dialogs", "11", 11],
];

test("tokens.json holds token data only", () => {
  assert.deepEqual(Object.keys(tokens).sort(), [
    "colours",
    "layers",
    "motion",
    "radii",
    "shadows",
    "sizes",
    "spacing",
    "typography",
  ]);
  assert.ok(!Object.hasOwn(tokens, "open_questions"), "open questions are not token data");
});

test("colours carry the design-law names and the blueprint/reference values", () => {
  assert.deepEqual(tokens.colours, EXPECTED_COLOURS);
  const hex = /^#[0-9a-f]{6}$/;
  const rgba = /^rgba\((\d+), (\d+), (\d+), (0|1|0?\.\d+)\)$/;
  for (const [name, value] of Object.entries(tokens.colours)) {
    assert.ok(hex.test(value) || rgba.test(value), `colour ${name} is a hex or rgba value`);
  }
  // Blueprint 21.1 gives the alpha colours as percentages of white or of the accent.
  assert.equal(tokens.colours["fg"], "rgba(255, 255, 255, 0.92)");
  assert.equal(tokens.colours["muted"], "rgba(255, 255, 255, 0.66)");
  assert.equal(tokens.colours["faint"], "rgba(255, 255, 255, 0.12)");
  assert.equal(tokens.colours["border"], "rgba(255, 255, 255, 0.08)");
  assert.equal(tokens.colours["border-strong"], "rgba(255, 255, 255, 0.16)");
  assert.equal(tokens.colours["accent-soft"], "rgba(143, 191, 175, 0.14)");
  assert.equal(tokens.colours["accent-line"], "rgba(143, 191, 175, 0.4)");
});

test("spacing is the 4-px series only", () => {
  assert.deepEqual(tokens.spacing, EXPECTED_SPACING);
  for (const [name, value] of Object.entries(tokens.spacing)) {
    const match = /^(\d+)px$/.exec(value);
    assert.ok(match !== null, `spacing ${name} is a px length`);
    assert.ok([4, 8, 12, 16, 24, 32, 48].includes(Number(match[1])));
  }
});

test("sizes cover borders, focus outline, grid, thresholds, targets, icons and header", () => {
  assert.deepEqual(tokens.sizes, EXPECTED_SIZES);
  // Design rule 3: 1 px resting border, 1.5 px selected border.
  assert.equal(tokens.sizes["border-width"], "1px");
  assert.equal(tokens.sizes["border-width-strong"], "1.5px");
  // Design rule 6: 2 px focus outline with a 2 px offset.
  assert.equal(tokens.sizes["outline-width"], "2px");
  assert.equal(tokens.sizes["outline-offset"], "2px");
  assert.equal(tokens.sizes["canvas-grid"], "16px");
  assert.equal(tokens.sizes["drag-threshold"], "4px");
  assert.equal(tokens.sizes["snap-tolerance"], "6px");
  assert.equal(tokens.sizes["header-height"], "40px");
  assert.deepEqual(
    [tokens.sizes["icon-bar"], tokens.sizes["button-bar"]],
    ["20px", "36px"],
  );
  assert.deepEqual(
    [tokens.sizes["icon-card"], tokens.sizes["button-card"]],
    ["16px", "28px"],
  );
});

test("radii carry the design-law names and values, including the tooltip radius", () => {
  assert.deepEqual(tokens.radii, EXPECTED_RADII);
  assert.equal(tokens.radii["radius-tooltip"], "6px");
});

test("typography has both stacks, the seven sizes and the three weights", () => {
  assert.deepEqual(tokens.typography, EXPECTED_TYPOGRAPHY);
  const sizes = Object.entries(tokens.typography)
    .filter(([name]) => name.startsWith("text-"))
    .map(([, value]) => value);
  assert.deepEqual(sizes, ["28px", "24px", "22px", "15px", "13px", "11px", "12px"]);
  for (const stack of [tokens.typography["font-sans"], tokens.typography["font-serif"]]) {
    assert.ok(!stack.includes("var("), "font stacks are self-contained, not framework variables");
    assert.ok(!stack.includes("--font"), "font stacks carry no framework font variables");
  }
  assert.ok(tokens.typography["font-sans"].includes("sans-serif"));
  assert.ok(tokens.typography["font-serif"].includes("serif"));
  assert.equal(tokens.typography["line-height"], 1.4);
  assert.equal(tokens.typography["tracking-label"], "0.1em");
});

test("motion has the four design-law durations plus the 2 s saved fade", () => {
  assert.deepEqual(tokens.motion, EXPECTED_MOTION);
});

test("shadows are exactly card-shadow and shadow", () => {
  assert.deepEqual(tokens.shadows, EXPECTED_SHADOWS);
  assert.deepEqual(Object.keys(tokens.shadows), ["card-shadow", "shadow"]);
});

test("layers keep the design-law order 1-11 including 7a", () => {
  assert.deepEqual(
    tokens.layers.map((layer) => [layer.name, layer.order, layer["z-index"]]),
    EXPECTED_LAYERS,
  );
  const orders = tokens.layers.map((layer) => layer.order);
  assert.deepEqual(orders, ["1", "2", "3", "4", "5", "6", "7", "7a", "8", "9", "10", "11"]);
  const zIndexes = tokens.layers.map((layer) => layer["z-index"]);
  assert.deepEqual(zIndexes, [1, 2, 3, 4, 5, 6, 7, 7, 8, 9, 10, 11]);
  const remote = tokens.layers.findIndex((layer) => layer.name === "remote-cursors");
  assert.equal(tokens.layers[remote].order, "7a");
  assert.ok(remote > tokens.layers.findIndex((layer) => layer.name === "snap-guides"));
  assert.ok(remote < tokens.layers.findIndex((layer) => layer.name === "canvas-chrome"));
});

test("no token value is null, empty or a placeholder", () => {
  const walk = (value, path) => {
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      return;
    }
    assert.notEqual(value, null, `${path} is not null`);
    assert.notEqual(String(value).trim(), "", `${path} is not empty`);
    assert.ok(!/TODO|TBD|FIXME|<\.\.\.>/.test(String(value)), `${path} is not a placeholder`);
  };
  walk(tokens, "tokens");
});
