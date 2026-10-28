/**
 * P6-02: auth/session client. All calls send cookies (`credentials: "include"`)
 * so the browser session stays in the provider's HttpOnly cookie; the SDK never
 * exposes or stores a token. Auth routes live on the auth service, the session
 * probe on the platform (`/v1/session`) or a configured session base URL.
 */
import { toApiError, toTransportError } from "./envelopes.ts";
import { defaultFetch, type FetchLike, type FetchResponse } from "./fetch.ts";
import { createRequestId } from "./uuid.ts";

export interface SessionUser {
  readonly accountId: string;
  readonly email: string;
  readonly displayName: string;
}

export interface AuthResourceOptions {
  readonly baseUrl: string;
  readonly authBaseUrl?: string | undefined;
  readonly sessionBaseUrl?: string | undefined;
  readonly fetch?: FetchLike | undefined;
  readonly requestId?: (() => string) | undefined;
}

interface Envelope {
  readonly requestId?: string;
  readonly data?: unknown;
}

export class AuthResource {
  readonly #authBase: string;
  readonly #sessionBase: string;
  readonly #fetch: FetchLike;
  readonly #requestId: () => string;

  constructor(options: AuthResourceOptions) {
    this.#authBase = (options.authBaseUrl ?? options.baseUrl).replace(/\/+$/, "");
    this.#sessionBase = (options.sessionBaseUrl ?? options.baseUrl).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? defaultFetch;
    this.#requestId = options.requestId ?? (() => createRequestId());
  }

  async #request(method: string, url: string, body?: unknown): Promise<unknown> {
    const requestId = this.#requestId();
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: FetchResponse;
    try {
      response = await this.#fetch(url, { method, headers, credentials: "include", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      throw toTransportError(error, requestId);
    }
    let parsed: unknown;
    try { parsed = await response.json(); } catch { parsed = undefined; }
    if (!response.ok) throw toApiError(parsed, response.status, requestId);
    return (parsed as Envelope | undefined)?.data;
  }

  /** `GET /v1/session`; throws `ApiError` AUTH_REQUIRED when unauthenticated. */
  async getSession(): Promise<SessionUser> {
    return await this.#request("GET", `${this.#sessionBase}/v1/session`) as SessionUser;
  }

  async login(email: string, password: string): Promise<void> {
    await this.#request("POST", `${this.#authBase}/v1/auth/login`, { email, password });
  }

  async registration(input: { email: string; password: string; displayName: string }): Promise<void> {
    await this.#request("POST", `${this.#authBase}/v1/auth/registration`, input);
  }

  async recovery(email: string): Promise<void> {
    await this.#request("POST", `${this.#authBase}/v1/auth/recovery`, { email });
  }

  async logout(): Promise<void> {
    await this.#request("POST", `${this.#authBase}/v1/auth/logout`);
  }
}
