/**
 * P6-09: production session and board-authorization adapters for the browser
 * cookie handshake.
 *
 * The browser never puts a session token into JavaScript: the same-origin
 * session cookie travels with the WebSocket upgrade, the sync service hands the
 * `Cookie` header to this adapter, and the adapter validates it through the
 * auth service's `GET /session` route (AD-5, the single session check). The
 * platform board check receives the same credentials, so sync keeps the existing
 * platform authorization instead of trusting a client-sent user id.
 *
 * The tokenRef path stays for tests and non-browser clients: without a cookie
 * the hello token reference is forwarded as the auth service's test-session
 * header, which only works when `AUTH_TEST_MODE` is enabled. Cookie values are
 * never logged, echoed or included in an error message.
 */

import type {
  BoardAuthorizer,
  SessionAuthContext,
  SessionAuthenticator,
  SessionIdentity,
} from "./protocol.ts";

export const DEFAULT_SESSION_TIMEOUT_MS = 3_000;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface SessionAdapterOptions {
  /** Base URL from `AUTH_SERVICE_URL`, e.g. `http://127.0.0.1:4320`. */
  readonly authServiceUrl: string;
  /** Base URL from `PLATFORM_SERVICE_URL`, e.g. `http://127.0.0.1:4310`. */
  readonly platformServiceUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface SessionAdapters {
  readonly authenticator: SessionAuthenticator;
  readonly authorizer: BoardAuthorizer;
}

interface SessionUser {
  readonly accountId: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Builds the credentials for a downstream service; a cookie wins over a test token. */
export function credentialHeaders(context: SessionAuthContext | undefined): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const cookie = context?.cookie ?? "";
  if (cookie !== "") {
    headers["cookie"] = cookie;
    return headers;
  }
  const tokenRef = context?.tokenRef ?? "";
  if (tokenRef !== "") {
    // Only the auth service's test mode accepts this header; in production the
    // auth service ignores it and answers 401, so no bypass exists.
    headers["x-test-session"] = tokenRef;
  }
  return headers;
}

function hasCredentials(headers: Readonly<Record<string, string>>): boolean {
  return headers["cookie"] !== undefined || headers["x-test-session"] !== undefined;
}

/** The production session adapters: auth validation plus the platform board check. */
export function createSessionAdapters(options: SessionAdapterOptions): SessionAdapters {
  const authBase = options.authServiceUrl.replace(/\/+$/, "");
  const platformBase = options.platformServiceUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async (url: string, headers: Readonly<Record<string, string>>): Promise<unknown> => {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return undefined;
      try {
        return await response.json();
      } catch {
        return undefined;
      }
    } catch {
      // Deliberately no error text: a thrown fetch error must never carry the
      // cookie or a downstream body into a log or a rejection detail.
      return undefined;
    }
  };

  /** `GET /session` on the auth service; returns the contract account id or null. */
  const authSession = async (headers: Readonly<Record<string, string>>): Promise<SessionUser | null> => {
    const body = await request(`${authBase}/session`, headers);
    const data = isRecord(body) ? body["data"] : undefined;
    if (!isRecord(data) || typeof data["accountId"] !== "string" || data["accountId"] === "") return null;
    return { accountId: data["accountId"] };
  };

  /**
   * The auth service reports the Ory Kratos identity id, which may be a UUIDv4.
   * Contract entities (and presence identity) require the UUIDv7 account id, so
   * an identity id is resolved through the platform's `GET /v1/session`, which
   * validates the same credentials through the auth service (AD-5).
   */
  const platformAccountId = async (headers: Readonly<Record<string, string>>): Promise<string | null> => {
    const body = await request(`${platformBase}/v1/session`, headers);
    if (!isRecord(body) || typeof body["accountId"] !== "string" || !UUID_V7.test(body["accountId"])) return null;
    return body["accountId"];
  };

  const authenticator: SessionAuthenticator = {
    async authenticate(tokenRef: string, context?: SessionAuthContext): Promise<SessionIdentity | null> {
      const headers = credentialHeaders({ ...context, tokenRef });
      if (!hasCredentials(headers)) return null;
      const session = await authSession(headers);
      if (session === null) return null;
      if (UUID_V7.test(session.accountId)) return { userId: session.accountId };
      const accountId = await platformAccountId(headers);
      return accountId === null ? null : { userId: accountId };
    },
  };

  const authorizer: BoardAuthorizer = {
    async canJoin(_userId: string, boardId: string, context?: SessionAuthContext): Promise<boolean> {
      const headers = credentialHeaders(context);
      if (!hasCredentials(headers)) return false;
      const body = await request(`${platformBase}/v1/boards/${encodeURIComponent(boardId)}`, headers);
      // 200 = the session is a board member; 404/403 and any transport failure
      // all deny. The platform enforces membership and row-level security.
      return body !== undefined;
    },
  };

  return { authenticator, authorizer };
}
