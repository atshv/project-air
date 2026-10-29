// P6-07: plain-text paste/drop sanitising; HTML is never trusted.

import assert from "node:assert/strict";
import test from "node:test";

import {
  blocksFromPastedText,
  decodePastedEntities,
  pastedBlocks,
  plainTextFromHtml,
  sanitizePastePayload,
  sanitizePastedText,
} from "../src/model/paste.ts";

test("HTML is reduced to plain text: tags, scripts and styles never survive", () => {
  const html = "<p>Hello <strong>world</strong></p><script>alert('x')</script><style>p{color:red}</style><p>Second</p>";
  const text = plainTextFromHtml(html);
  assert.equal(text.includes("<"), false);
  assert.equal(text.includes("script"), false);
  assert.equal(text.includes("color:red"), false);
  assert.match(text, /Hello world/);
  assert.match(text, /Second/);
});

test("entities are decoded to text and never re-interpreted as markup", () => {
  assert.equal(decodePastedEntities("&lt;b&gt;not bold&lt;/b&gt; &amp; &quot;quoted&quot;"), "<b>not bold</b> & \"quoted\"");
  const decoded = plainTextFromHtml("&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(decoded, "<img src=x onerror=alert(1)>");
});

test("plain text normalises newlines, control characters and trailing spaces", () => {
  assert.equal(sanitizePastedText("a\r\nb\rc"), "a\nb\nc");
  assert.equal(sanitizePastedText("a  \nb\t"), "a\nb");
  assert.equal(sanitizePastedText("a\u0000b\u0007c"), "abc");
  assert.equal(sanitizePastedText("  keep leading"), "  keep leading");
});

test("the paste payload prefers plain text and falls back to sanitised HTML", () => {
  assert.equal(sanitizePastePayload({ plainText: "plain <b>", html: "<p>html</p>" }), "plain <b>");
  assert.equal(sanitizePastePayload({ plainText: "   ", html: "<p>html</p>" }), "html");
  assert.equal(sanitizePastePayload({}), "");
  const blocks = pastedBlocks({ html: "<p>one</p><p>two</p>" });
  assert.deepEqual(blocks.map((block) => block.text), ["one", "two"]);
  assert.ok(blocks.every((block) => block.type === "paragraph"));
});

test("pasted text becomes paragraph blocks and over-long lines are chunked, not truncated", () => {
  assert.deepEqual(blocksFromPastedText("one\ntwo\n").map((block) => block.text), ["one", "two", ""]);
  assert.deepEqual(blocksFromPastedText("").length, 0);
  const long = blocksFromPastedText("x".repeat(10001));
  assert.equal(long.length, 2);
  assert.equal(long[0].text.length, 10000);
  assert.equal(long[1].text.length, 1);
});
