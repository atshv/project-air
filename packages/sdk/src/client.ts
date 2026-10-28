/**
 * `@project-air/sdk` — the typed client of the platform HTTP API.
 *
 * ```ts
 * const api = createClient({ baseUrl: "http://127.0.0.1:4110", session: { testSession } });
 * const workspace = await api.workspaces.create({ name: "Lab", ownerId: accountId });
 * const boards = await api.boards.list(workspace.id, { limit: 20 });
 * ```
 *
 * The client has no runtime dependency, sends a UUIDv7 `requestId` with every
 * call, uses the contract envelopes and throws a typed `ApiError` carrying the
 * contract `code`, `messageKey` and `requestId`.
 */

import { AuthResource } from "./auth.ts";
import { BoardsResource } from "./boards.ts";
import { CardsResource } from "./cards.ts";
import { NotesResource } from "./notes.ts";
import { Transport, type SessionCredentials } from "./transport.ts";
import type { FetchLike } from "./fetch.ts";
import type { WorkspacesResource } from "./workspaces.ts";
import { WorkspacesResource as Workspaces } from "./workspaces.ts";

export interface ClientOptions {
  /** Platform base URL, e.g. `http://127.0.0.1:4110` (no trailing slash needed). */
  readonly baseUrl: string;
  /** A Kratos cookie session or a non-production test session. */
  readonly session?: SessionCredentials | string | undefined;
  readonly fetch?: FetchLike | undefined;
  /** Overrides the UUIDv7 request-id factory (tests). */
  readonly requestId?: (() => string) | undefined;
  /** Auth service base URL for `/v1/auth/*` (defaults to baseUrl). */
  readonly authBaseUrl?: string | undefined;
  /** Session probe base URL (defaults to baseUrl; the auth service also serves it). */
  readonly sessionBaseUrl?: string | undefined;
}

export interface ContractClient {
  readonly workspaces: WorkspacesResource;
  readonly boards: BoardsResource;
  readonly notes: NotesResource;
  readonly cards: CardsResource;
  readonly auth: AuthResource;
}

export function createClient(options: ClientOptions): ContractClient {
  const transport = new Transport(options);
  return {
    workspaces: new Workspaces(transport),
    boards: new BoardsResource(transport),
    notes: new NotesResource(transport),
    cards: new CardsResource(transport),
    auth: new AuthResource({ baseUrl: options.baseUrl, authBaseUrl: options.authBaseUrl, sessionBaseUrl: options.sessionBaseUrl, fetch: options.fetch, requestId: options.requestId }),
  };
}
