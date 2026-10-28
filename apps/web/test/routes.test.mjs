import assert from "node:assert/strict";
import test from "node:test";

import { boardPath, isShellRoute, ROUTES, routeByPath } from "../src/routes.ts";

test("every required route exists with message-backed title and body keys", () => {
  const paths = ROUTES.map((route) => route.path);
  for (const required of ["/", "/login", "/boards", "/boards/:id", "/settings"]) assert.ok(paths.includes(required), required);
  for (const route of ROUTES) assert.match(route.titleKey, /^routes\./);
});

test("route helpers stay pure and encode board ids", () => {
  assert.equal(routeByPath("/settings")?.titleKey, "routes.settings.title");
  assert.equal(routeByPath("/nope"), undefined);
  assert.equal(isShellRoute("/"), true);
  assert.equal(isShellRoute("/settings"), true);
  assert.equal(isShellRoute("/boards"), false);
  assert.equal(boardPath("a b"), "/boards/a%20b");
});
