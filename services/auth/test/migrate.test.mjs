/**
 * The auth package ships the same migration runner as the platform service;
 * this test checks its file discovery and checksums without touching the
 * database (the platform test covers application against the slot database).
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadMigrations } from "../src/db/migrate.ts";

function repositoryRoot() {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml")) && existsSync(path.join(current, "infra", "compose", "compose.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error("cannot locate the repository root");
}

test("loads the migrations in file-name order with SHA-256 checksums", async () => {
  const migrationsDir = path.join(repositoryRoot(), "infra", "migrations");
  const migrations = await loadMigrations(migrationsDir);
  assert.ok(migrations.length >= 1, "infra/migrations must contain at least one migration");
  const names = migrations.map((migration) => migration.name);
  assert.deepEqual(names, [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[0-9a-f]{64}$/);
    const content = await readFile(path.join(migrationsDir, migration.name), "utf8");
    const { createHash } = await import("node:crypto");
    assert.equal(migration.checksum, createHash("sha256").update(content, "utf8").digest("hex"));
  }
});
