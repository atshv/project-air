/**
 * P6-10: the e2e runtime environment written by `tools/dev/e2e-env.mjs`.
 *
 * The file lives in the gitignored `apps/web/e2e/.state/` directory and is
 * created before Playwright's webServer reports ready, so it is read lazily from
 * fixtures (never at module load, when the server may not have started yet).
 */

import { readFileSync } from "node:fs";

export interface E2eAccount {
  readonly accountId: string;
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  /** The gated HMAC test session minted by `POST /test/session` (AUTH_TEST_MODE). */
  readonly token: string;
}

export interface E2eEnvironment {
  readonly baseURL: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly seededBoardId: string;
  readonly seededBoardTitle: string;
  readonly accounts: readonly E2eAccount[];
}

let cached: E2eEnvironment | undefined;

/** Reads the state file; call inside fixtures/tests, not at module load. */
export function e2eEnvironment(): E2eEnvironment {
  if (cached !== undefined) {
    return cached;
  }
  const file = new URL("../.state/env.json", import.meta.url);
  cached = JSON.parse(readFileSync(file, "utf8")) as E2eEnvironment;
  return cached;
}

/** The e2e test-session cookie the server turns into `x-test-session`. */
export const TEST_SESSION_COOKIE = "air_e2e_session";
