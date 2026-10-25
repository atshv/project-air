// @ts-check
// Package-local flat config: reuse the repository rules and additionally ignore
// the C++/CMake and tsc build outputs, which contain generated `.ts` dependency
// files that are not part of the package sources.
import { defineConfig } from "eslint/config";

import rootConfig from "../../eslint.config.mjs";

export default defineConfig(
  {
    name: "project-air/engine/ignores",
    ignores: ["build/**", "build-wasm/**", "dist/**"],
  },
  rootConfig,
);
