// @ts-check
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

export default defineConfig(
  {
    name: "project-air/ignores",
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/*.tsbuildinfo",
      "reference/**",
    ],
  },
  {
    name: "project-air/typescript",
    files: tsFiles,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
