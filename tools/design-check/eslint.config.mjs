// Local ESLint config: this tool is plain Node.js ESM, so the root type-aware
// TypeScript config does not apply. The fixtures are intentionally violating
// samples for the design-check tests and are not linted.

import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    name: "project-air/design-check/ignores",
    ignores: ["test/fixtures/**"],
  },
]);
