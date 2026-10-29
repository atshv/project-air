// P6-10 (integration fix): an honest account label when the platform session
// probe carries no profile (test-mode environment), never an invented name.
import assert from "node:assert/strict";
import test from "node:test";

import { accountLabel } from "../src/auth/session-label.ts";

test("the display name wins, then the e-mail, then a short account-id fragment", () => {
  assert.equal(accountLabel({ accountId: "0192f0a1-7000-7000-8000-000000000001", displayName: "Ada", email: "ada@example.test" }), "Ada");
  assert.equal(accountLabel({ accountId: "0192f0a1-7000-7000-8000-000000000001", displayName: "  ", email: "ada@example.test" }), "ada@example.test");
  assert.equal(accountLabel({ accountId: "0192f0a1-7000-7000-8000-000000000001" }), "00000001");
  assert.equal(accountLabel({ accountId: "----" }), "?");
});
