// Contract 0.4.0: body <-> plainText semantic consistency (schema validates the
// body shape; the derivation is the source of truth).
import assert from "node:assert/strict";
import test from "node:test";

import { derivePlainText, plainTextMatches } from "../plaintext.mjs";

test("plainText is derived deterministically from the structured body", () => {
  const body = { version: "1", blocks: [
    { type: "heading", text: "Summary", level: 2 },
    { type: "paragraph", text: "Hello   world." },
    { type: "list", text: "One", ordered: false },
    { type: "list", text: "Two", ordered: false },
    { type: "list", text: "First", ordered: true },
  ] };
  assert.equal(derivePlainText(body), "Summary\nHello world.\n- One\n- Two\n1. First");
  assert.equal(plainTextMatches(body, derivePlainText(body)), true);
  assert.equal(plainTextMatches(body, "different"), false);
  assert.equal(derivePlainText({ version: "1", blocks: [] }), "");
  assert.equal(plainTextMatches(null, ""), false);
});
