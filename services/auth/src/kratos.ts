/**
 * Small typed clients for the Ory Kratos public and admin APIs (ADR-0007).
 *
 * Kratos is the only identity source: this service never stores credentials,
 * passwords or session state. The clients are deliberately thin (built-in
 * `fetch`, a timeout per call) and never log cookies, tokens or request bodies.
 * Every failure becomes a `KratosError` with a code the routes can map to a
 * contract error envelope.
 */

import { isRecord } from "./http/body.ts";

export type KratosErrorCode =
  | "unavailable"
  | "unauthorized"
  | "conflict"
  | "not_found"
  | "bad_response"
  | "error";

export class KratosError extends Error {
  readonly code: KratosErrorCode;
  readonly status: number | undefined;

  constructor(code: KratosErrorCode, message: string, status?: number) {
    super(message);
    this.name = "KratosError";
    this.code = code;
    this.status = status;
  }
}

export interface KratosTraits {
  readonly email?: string;
  readonly displayName?: string;
  readonly locale?: string;
}

export interface KratosIdentity {
  readonly id: string;
  readonly traits: KratosTraits;
}

export interface CreateIdentityInput {
  readonly email: string;
  readonly displayName: string;
  readonly locale?: string;
}

export interface RecoveryLink {
  readonly link: string;
  readonly expiresAt: string;
}

export interface KratosFlow {
  readonly id: string;
  readonly action: string;
}

export interface KratosClientOptions {
  /** Public API base URL from `KRATOS_PUBLIC_URL`, e.g. `http://127.0.0.1:8433`. */
  readonly publicUrl: string;
  /** Admin API base URL from `KRATOS_ADMIN_URL`, e.g. `http://127.0.0.1:8434`. */
  readonly adminUrl: string;
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_SCHEMA_ID = "default";

interface RequestOptions {
  readonly method: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export class KratosClient {
  readonly #publicUrl: string;
  readonly #adminUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: KratosClientOptions) {
    this.#publicUrl = options.publicUrl.replace(/\/+$/, "");
    this.#adminUrl = options.adminUrl.replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /** `GET /health/ready` on the public API; false on any failure. */
  async ready(): Promise<boolean> {
    try {
      const response = await this.#request(`${this.#publicUrl}/health/ready`, { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Readiness for the health endpoint; throws `unavailable` instead of false. */
  async requireReady(): Promise<void> {
    if (!(await this.ready())) {
      throw new KratosError("unavailable", "Kratos is not ready");
    }
  }

  /**
   * `GET /sessions/whoami` with the request's Cookie header. Returns the
   * identity for an active session and `null` for a missing or expired one.
   */
  async whoami(cookieHeader: string): Promise<KratosIdentity | null> {
    const response = await this.#request(`${this.#publicUrl}/sessions/whoami`, {
      method: "GET",
      headers: { cookie: cookieHeader },
    });
    if (response.status === 401 || response.status === 403) {
      return null;
    }
    if (!response.ok) {
      throw this.#failure(response);
    }
    const body = await this.#json(response);
    const identity = isRecord(body) ? body.identity : undefined;
    return mapIdentity(identity);
  }

  /** `POST /admin/identities`; a duplicate e-mail is reported as `conflict`. */
  async createIdentity(input: CreateIdentityInput): Promise<KratosIdentity> {
    const traits: Record<string, unknown> = { email: input.email, display_name: input.displayName };
    if (input.locale !== undefined) {
      traits.locale = input.locale;
    }
    const response = await this.#request(`${this.#adminUrl}/admin/identities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema_id: DEFAULT_SCHEMA_ID, traits }),
    });
    if (response.status === 409) {
      throw new KratosError("conflict", "an identity with this e-mail already exists", 409);
    }
    if (!response.ok) {
      throw this.#failure(response);
    }
    return mapIdentity(await this.#json(response));
  }

  /** `POST /admin/recovery/link`; the invitation link for an identity. */
  async createRecoveryLink(identityId: string): Promise<RecoveryLink> {
    const response = await this.#request(`${this.#adminUrl}/admin/recovery/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity_id: identityId, expires_in: "1h" }),
    });
    if (!response.ok) {
      throw this.#failure(response);
    }
    const body = await this.#json(response);
    if (!isRecord(body) || typeof body.recovery_link !== "string" || typeof body.expires_at !== "string") {
      throw new KratosError("bad_response", "Kratos returned an invalid recovery link");
    }
    return { link: body.recovery_link, expiresAt: body.expires_at };
  }

  /** `GET /admin/identities` (first page); used by tests and admin tooling. */
  async listIdentities(): Promise<readonly KratosIdentity[]> {
    const response = await this.#request(`${this.#adminUrl}/admin/identities`, { method: "GET" });
    if (!response.ok) {
      throw this.#failure(response);
    }
    const body = await this.#json(response);
    if (!Array.isArray(body)) {
      throw new KratosError("bad_response", "Kratos returned an invalid identity list");
    }
    return body.map((entry) => mapIdentity(entry));
  }

  /** `GET /self-service/login/api`: start an API login flow. */
  async loginFlow(): Promise<KratosFlow> {
    return this.#flow(`${this.#publicUrl}/self-service/login/api`);
  }

  /** `GET /self-service/registration/api`: start an API registration flow. */
  async registrationFlow(): Promise<KratosFlow> {
    return this.#flow(`${this.#publicUrl}/self-service/registration/api`);
  }

  /** `GET /self-service/recovery/api`: start an API recovery flow. */
  async recoveryFlow(): Promise<KratosFlow> {
    return this.#flow(`${this.#publicUrl}/self-service/recovery/api`);
  }

  async #flow(url: string): Promise<KratosFlow> {
    const response = await this.#request(url, { method: "GET" });
    if (!response.ok) {
      throw this.#failure(response);
    }
    const body = await this.#json(response);
    const ui = isRecord(body) ? body.ui : undefined;
    const action = isRecord(ui) ? ui.action : undefined;
    if (!isRecord(body) || typeof body.id !== "string" || typeof action !== "string") {
      throw new KratosError("bad_response", "Kratos returned an invalid flow");
    }
    return { id: body.id, action };
  }

  async #request(url: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" };
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers[name] = value;
    }
    const init: RequestInit = {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: options.body }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    };
    try {
      return await this.#fetch(url, init);
    } catch {
      // No URL, cookie or body in the message: it may be logged later.
      throw new KratosError("unavailable", "Kratos is not reachable");
    }
  }

  async #json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new KratosError("bad_response", "Kratos returned invalid JSON", response.status);
    }
  }

  #failure(response: Response): KratosError {
    if (response.status === 401 || response.status === 403) {
      return new KratosError("unauthorized", "Kratos rejected the request", response.status);
    }
    if (response.status === 404) {
      return new KratosError("not_found", "Kratos resource not found", response.status);
    }
    if (response.status === 409) {
      return new KratosError("conflict", "Kratos reported a conflict", response.status);
    }
    if (response.status === 400 || response.status === 422) {
      return new KratosError("bad_response", "Kratos rejected the payload", response.status);
    }
    return new KratosError("error", "Kratos returned an unexpected status", response.status);
  }
}

function mapIdentity(raw: unknown): KratosIdentity {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") {
    throw new KratosError("bad_response", "Kratos returned an identity without an id");
  }
  const traits = isRecord(raw.traits) ? raw.traits : {};
  const mapped: { email?: string; displayName?: string; locale?: string } = {};
  if (typeof traits.email === "string" && traits.email !== "") {
    mapped.email = traits.email;
  }
  if (typeof traits.display_name === "string" && traits.display_name !== "") {
    mapped.displayName = traits.display_name;
  }
  if (typeof traits.locale === "string" && traits.locale !== "") {
    mapped.locale = traits.locale;
  }
  return { id: raw.id, traits: mapped };
}
