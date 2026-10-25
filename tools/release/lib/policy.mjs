/**
 * Which changed paths count as code for the `changelog-entry` gate.
 *
 * Code lives under the package roots or in a root manifest; docs, board, planning, reviews and
 * release notes do not require an entry.
 */

export const CODE_PREFIXES = ["apps/", "packages/", "services/", "tools/", "infra/"];

export const ROOT_MANIFESTS = [
  ".npmrc",
  ".nvmrc",
  "eslint.config.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "turbo.json",
];

export function isCodePath(path) {
  const normalized = String(path ?? "").replace(/^\.\//, "");
  if (normalized === "") {
    return false;
  }
  if (ROOT_MANIFESTS.includes(normalized)) {
    return true;
  }
  return CODE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
