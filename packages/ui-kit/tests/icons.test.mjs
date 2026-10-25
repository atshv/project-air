// A3: packages/ui-kit/icons holds exactly the ten toolbar icons, each a
// standalone 24x24 stroke SVG with currentColor, round caps/joins and no fill.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const ICON_DIR = new URL("../icons/", import.meta.url);

const GEOMETRY = {
  note: [
    '<path d="M5 4h14v10l-5 6H5z"/>',
    '<path d="M14 20v-6h5"/>',
    '<path d="M8.5 8.5h7M8.5 12h4"/>',
  ],
  source: [
    '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/>',
    '<path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ],
  image: [
    '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/>',
    '<circle cx="9" cy="10" r="1.6"/>',
    '<path d="M20.5 16l-5-5-8.5 8"/>',
  ],
  file: [
    '<path d="M7 3.5h6.5L18 8v12.5H7z"/>',
    '<path d="M13.5 3.5V8H18"/>',
    '<path d="M9.5 13h6M9.5 16.5h4"/>',
  ],
  zone: ['<rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke-dasharray="3 2.5"/>'],
  checklist: [
    '<path d="M4 7l1.6 1.6L8.5 5.5"/>',
    '<path d="M4 15l1.6 1.6 2.9-3.1"/>',
    '<path d="M11.5 7h8.5M11.5 15h8.5"/>',
  ],
  palette: [
    '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.8 0-1.4-1.2-1.7-1.2-2.9 0-1 .8-1.8 1.8-1.8h2.2a3.7 3.7 0 0 0 3.7-3.7C20.5 6.6 16.7 3.5 12 3.5z"/>',
    '<circle cx="7.8" cy="11" r="1"/>',
    '<circle cx="10.5" cy="7.3" r="1"/>',
    '<circle cx="15" cy="7.8" r="1"/>',
  ],
  columns: [
    '<rect x="3.5" y="4.5" width="4.5" height="15" rx="1.5"/>',
    '<rect x="9.75" y="4.5" width="4.5" height="10" rx="1.5"/>',
    '<rect x="16" y="4.5" width="4.5" height="12.5" rx="1.5"/>',
  ],
  timeline: [
    '<path d="M3 12h18"/>',
    '<circle cx="6.5" cy="12" r="1.8"/>',
    '<circle cx="12" cy="12" r="1.8"/>',
    '<circle cx="17.5" cy="12" r="1.8"/>',
    '<path d="M6.5 6.5v3.7M17.5 6.5v3.7M12 13.8v3.7"/>',
  ],
  table: [
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>',
    '<path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  ],
};

const NAMES = Object.keys(GEOMETRY);

function readIcon(name) {
  return readFileSync(new URL(`${name}.svg`, ICON_DIR), "utf8");
}

function rootTag(svg) {
  const match = /^<svg [^>]*>$/m.exec(svg);
  assert.ok(match !== null, "the file starts with one root svg element");
  return match[0];
}

function children(svg) {
  return svg
    .split("\n")
    .slice(1, -2)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

test("icons/ contains exactly the ten toolbar icons", () => {
  const files = readdirSync(ICON_DIR)
    .filter((file) => file.endsWith(".svg"))
    .sort();
  assert.deepEqual(files, NAMES.map((name) => `${name}.svg`).sort());
  assert.equal(files.length, 10);
});

for (const name of NAMES) {
  test(`${name}.svg is a valid standalone 24x24 stroke icon`, () => {
    const svg = readIcon(name);
    const root = rootTag(svg);
    assert.ok(!/\n{2,}/.test(svg), "no blank lines");
    assert.ok(svg.endsWith("</svg>\n"), "ends with a closing svg element and a newline");
    assert.ok(root.includes('xmlns="http://www.w3.org/2000/svg"'), "declares the SVG namespace");
    assert.ok(root.includes('viewBox="0 0 24 24"'), "uses the 24x24 grid");
    assert.ok(root.includes('fill="none"'), "has no fill");
    assert.ok(root.includes('stroke="currentColor"'), "strokes with currentColor");
    assert.ok(root.includes('stroke-width="1.6"'), "uses stroke width 1.6");
    assert.ok(root.includes('stroke-linecap="round"'), "uses round caps");
    assert.ok(root.includes('stroke-linejoin="round"'), "uses round joins");
    assert.ok(!/\bstyle=/.test(svg), "no inline styles");
    assert.ok(!/\bclass=/.test(svg), "no CSS classes");
    assert.ok(!/(?<![-\w])width="/.test(root) && !/(?<![-\w])height="/.test(root), "no fixed pixel size");
    assert.ok(!/fill="(?!none)/.test(svg), "no filled element");
    assert.deepEqual(children(svg), GEOMETRY[name]);
  });
}
