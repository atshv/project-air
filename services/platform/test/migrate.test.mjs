/**
 * Migration runner: file order and checksums, idempotent application against
 * the slot database, and failure when an applied migration changed or
 * disappeared.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import pg from "pg";

import { loadMigrations, migrate } from "../src/db/migrate.ts";
import { databaseUrl, repositoryRoot } from "./helpers/slot.mjs";

const { Client } = pg;
const migrationsDir = path.join(repositoryRoot(), "infra", "migrations");

async function withClient(run) {
  const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

test("migration runner", async (t) => {
  await t.test("loads the migrations in file-name order with SHA-256 checksums", async () => {
    const migrations = await loadMigrations(migrationsDir);
    assert.ok(migrations.length >= 1, "infra/migrations must contain at least one migration");
    const names = migrations.map((migration) => migration.name);
    assert.deepEqual(names, [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
    for (const migration of migrations) {
      assert.match(migration.version, /^[0-9A-Za-z][0-9A-Za-z_-]*$/);
      assert.match(migration.checksum, /^[0-9a-f]{64}$/);
      assert.equal(migration.checksum, await checksumOf(path.join(migrationsDir, migration.name)));
    }
  });

  await t.test("applies the migrations once and records versions in schema_migrations", async () => {
    const migrations = await loadMigrations(migrationsDir);
    const result = await migrate({ connectionString: databaseUrl(), migrationsDir });
    assert.equal(result.applied.length + result.skipped.length, migrations.length);

    await withClient(async (client) => {
      const rows = (await client.query("SELECT version, name, checksum FROM schema_migrations ORDER BY version")).rows;
      for (const migration of migrations) {
        const row = rows.find((candidate) => candidate.version === migration.version);
        assert.ok(row !== undefined, `missing schema_migrations row for ${migration.version}`);
        assert.equal(row.checksum, migration.checksum);
        assert.equal(row.name, migration.name);
      }
      const schema = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'app'");
      assert.equal(schema.rowCount, 1, "migration 0001 must create the app schema");
    });
  });

  await t.test("a second run is a no-op", async () => {
    const result = await migrate({ connectionString: databaseUrl(), migrationsDir });
    assert.deepEqual(result.applied, []);
  });

  await t.test("fails when an applied migration changed", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "project-air-migrations-"));
    try {
      const migrations = await loadMigrations(migrationsDir);
      for (const migration of migrations) {
        const content = await readFile(path.join(migrationsDir, migration.name), "utf8");
        const changed = migration === migrations[0] ? `${content}\n-- changed after it was applied\n` : content;
        await writeFile(path.join(directory, migration.name), changed, "utf8");
      }
      await assert.rejects(migrate({ connectionString: databaseUrl(), migrationsDir: directory }), /checksum mismatch/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  await t.test("fails when an applied migration disappeared", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "project-air-migrations-"));
    try {
      await assert.rejects(migrate({ connectionString: databaseUrl(), migrationsDir: directory }), /is missing/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function checksumOf(file) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(await readFile(file), "utf8").digest("hex");
}
