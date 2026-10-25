/**
 * Client for the auth service's `GET /session` (the single session check, AD-5).
 *
 * The platform never trusts a client-sent account id: the only source is the
 * auth service, which forwards the browser cookie (or the test-session header)
 * to Ory Kratos. Cookies and test tokens are forwarded unchanged and never
 * logged.
 */

import { authRequired, serviceUnavailable } from "../http/errors.ts";

export interface AuthSessionUser {
  readonly accountId: string;
  readonly email: string;
  readonly displayName: string;
}

export interface AuthHeaders {
  readonly cookie?: string;
  readonly testSession?: string;
}

export interface AuthSessionClientOptions {
  /** Base URL from `AUTH_SERVICE_URL`, e.g. `http://127.0.0.1:4120`. */
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 3_000;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AuthSessionClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: AuthSessionClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /** 200 → the session user; 401 → `AUTH_REQUIRED`; anything else → 503 INTERNAL. */
  async getSession(headers: AuthHeaders): Promise<AuthSessionUser> {
    const requestHeaders: Record<string, string> = { accept: "application/json" };
    if (headers.cookie !== undefined && headers.cookie !== "") {
      requestHeaders.cookie = headers.cookie;
    }
    if (headers.testSession !== undefined && headers.testSession !== "") {
      requestHeaders["x-test-session"] = headers.testSession;
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/session`, {
        method: "GET",
        headers: requestHeaders,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw serviceUnavailable("the auth service is not reachable");
    }

    if (response.status === 401) {
      throw authRequired();
    }
    if (!response.ok) {
      throw serviceUnavailable("the auth service returned an error");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw serviceUnavailable("the auth service returned an invalid session");
    }
    const data = isRecord(body) ? body.data : undefined;
    if (
      !isRecord(data) ||
      typeof data.accountId !== "string" ||
      typeof data.email !== "string" ||
      typeof data.displayName !== "string" ||
      data.accountId === ""
    ) {
      throw serviceUnavailable("the auth service returned an invalid session");
    }
    return { accountId: data.accountId, email: data.email, displayName: data.displayName };
  }
}
