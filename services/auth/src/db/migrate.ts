/**
 * Migration runner: applies `infra/migrations/*.sql` in file-name order.
 *
 * - records every applied version, its file name and its SHA-256 checksum in
 *   `schema_migrations`;
 * - is idempotent: an already applied, unchanged file is skipped;
 * - fails when an applied file changed or disappeared, so history cannot be
 *   rewritten — add a new numbered migration instead;
 * - never creates the database itself (`tools/dev/reset-db` removes and
 *   recreates the slot database before this runner applies migrations);
 * - holds a PostgreSQL advisory lock so two runners cannot apply at once.
 *
 * Run directly with `node services/auth/src/db/migrate.ts` (Node type
 * stripping) or `node services/platform/dist/db/migrate.js` after a build.
 * The connection string comes from `DATABASE_URL` and is never logged.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { createLogger, type Logger } from "../log.ts";

const { Client } = pg;

export const MIGRATIONS_DIRECTORY = path.join("infra", "migrations");
export const SCHEMA_MIGRATIONS_TABLE = "schema_migrations";
const MIGRATION_FILE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z_-]*\.sql$/;
const ADVISORY_LOCK_KEY = 7_270_001;
const CONNECTION_TIMEOUT_MS = 5_000;

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrateOptions {
  readonly connectionString: string;
  /** Defaults to the repository `infra/migrations` directory. */
  readonly migrationsDir?: string;
  readonly logger?: Logger;
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/** Walks up from `startDirectory` until the repository's migrations folder is found. */
export function resolveMigrationsDir(startDirectory: string): string {
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(current, MIGRATIONS_DIRECTORY);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`cannot find ${MIGRATIONS_DIRECTORY} above ${startDirectory}`);
}

/** Reads the migrations in deterministic file-name order. */
export async function loadMigrations(migrationsDir: string): Promise<readonly MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const migrations: MigrationFile[] = [];
  for (const name of names) {
    const sql = await readFile(path.join(migrationsDir, name), "utf8");
    migrations.push({
      version: name.slice(0, -".sql".length),
      name,
      sql,
      checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
    });
  }
  return migrations;
}

interface AppliedRow {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

interface AppliedMigrationRow extends AppliedRow {
  readonly applied_at: Date;
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const logger = options.logger ?? createLogger("info");
  const migrationsDir = options.migrationsDir ?? resolveMigrationsDir(path.dirname(fileURLToPath(import.meta.url)));
  const migrations = await loadMigrations(migrationsDir);

  const client = new Client({
    application_name: "project-air-migrations",
    connectionString: options.connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
         version text PRIMARY KEY,
         name text NOT NULL,
         checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const appliedResult = await client.query<AppliedMigrationRow>(
      `SELECT version, name, checksum, applied_at FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY version`,
    );
    const appliedRows: readonly AppliedRow[] = appliedResult.rows;
    const filesByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

    const appliedVersions = new Set<string>();
    for (const applied of appliedRows) {
      const file = filesByVersion.get(applied.version);
      if (file === undefined) {
        throw new Error(`applied migration ${applied.version} is missing from ${migrationsDir}`);
      }
      if (file.checksum !== applied.checksum) {
        throw new Error(
          `migration ${applied.version} changed after it was applied (checksum mismatch); add a new numbered migration instead of editing an applied one`,
        );
      }
      appliedVersions.add(applied.version);
    }

    const applied: string[] = [];
    const skipped: string[] = [];
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        skipped.push(migration.version);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(`INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`, [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`migration ${migration.version} failed: ${reason}`);
      }
      applied.push(migration.version);
      logger.info("migration applied", { version: migration.version, name: migration.name });
    }

    logger.info("migrations complete", { applied: applied.length, skipped: skipped.length });
    return { applied, skipped };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString === undefined || connectionString === "") {
    process.stderr.write("migrate: DATABASE_URL is required\n");
    process.exitCode = 2;
    return;
  }
  const logger = createLogger("info");
  try {
    const result = await migrate({ connectionString, logger });
    logger.info("migrate: done", { applied: result.applied.length, skipped: result.skipped.length });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`migrate: ${reason}\n`);
    process.exitCode = 1;
  }
}

const invokedAsEntryPoint =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsEntryPoint) {
  void main();
}
