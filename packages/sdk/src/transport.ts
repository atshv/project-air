/**
 * Transport of the SDK: base URL, session headers, request ids and the single
 * fetch call. No runtime dependency; `fetch` comes from the host.
 */

import { toApiError, toTransportError } from "./envelopes.ts";
import { defaultFetch, type FetchLike, type FetchResponse } from "./fetch.ts";
import { createRequestId } from "./uuid.ts";

export interface SessionCredentials {
  /** Value for the `cookie` header (a Kratos browser session). */
  readonly cookie?: string | undefined;
  /** Value for the `x-test-session` header (non-production integration tests). */
  readonly testSession?: string | undefined;
}

export interface TransportOptions {
  readonly baseUrl: string;
  readonly session?: SessionCredentials | string | undefined;
  readonly fetch?: FetchLike | undefined;
  readonly requestId?: (() => string) | undefined;
}

const DEFAULT_HEADERS: Readonly<Record<string, string>> = { accept: "application/json" };

function sessionHeaders(session: SessionCredentials | string | undefined): Record<string, string> {
  if (session === undefined) {
    return {};
  }
  const credentials: SessionCredentials = typeof session === "string" ? { testSession: session } : session;
  const headers: Record<string, string> = {};
  if (credentials.cookie !== undefined && credentials.cookie !== "") {
    headers.cookie = credentials.cookie;
  }
  if (credentials.testSession !== undefined && credentials.testSession !== "") {
    headers["x-test-session"] = credentials.testSession;
  }
  return headers;
}

export class Transport {
  readonly #baseUrl: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: FetchLike;
  readonly #requestId: () => string;

  constructor(options: TransportOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^/]+/.test(baseUrl)) {
      throw new Error("baseUrl must be an absolute http(s) URL");
    }
    this.#baseUrl = baseUrl;
    this.#headers = sessionHeaders(options.session);
    this.#fetch = options.fetch ?? defaultFetch;
    this.#requestId = options.requestId ?? (() => createRequestId());
  }

  newRequestId(): string {
    return this.#requestId();
  }

  async send(method: string, path: string, requestId: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...this.#headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    let response: FetchResponse;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw toTransportError(error, requestId);
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      throw toApiError(parsed, response.status, requestId);
    }
    return parsed;
  }
}

/** Builds `path?key=value` for the defined query parameters. */
export function withQuery(path: string, parameters: Readonly<Record<string, string | number | undefined>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length === 0 ? path : `${path}?${parts.join("&")}`;
}
