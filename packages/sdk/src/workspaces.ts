/**
 * Workspace resource of the platform API.
 */

import { parseDeleted, parseList, parseResource } from "./envelopes.ts";
import { Transport, withQuery } from "./transport.ts";
import type { DeleteResult, ListQuery, ListResult, Workspace, WorkspaceChanges } from "./types.ts";

export interface WorkspaceCreateInput {
  readonly name: string;
  readonly ownerId: string;
}

export class WorkspacesResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async list(query: ListQuery = {}): Promise<ListResult<Workspace>> {
    const requestId = this.#transport.newRequestId();
    const path = withQuery("/v1/workspaces", { requestId, limit: query.limit, cursor: query.cursor });
    return parseList<Workspace>(await this.#transport.send("GET", path, requestId), requestId);
  }

  async get(workspaceId: string, options: { readonly requestId?: string | undefined } = {}): Promise<Workspace> {
    const requestId = options.requestId ?? this.#transport.newRequestId();
    const path = withQuery(`/v1/workspaces/${encodeURIComponent(workspaceId)}`, { requestId });
    return parseResource<Workspace>(await this.#transport.send("GET", path, requestId), "workspace", requestId);
  }

  async create(input: WorkspaceCreateInput): Promise<Workspace> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send("POST", "/v1/workspaces", requestId, { requestId, workspace: input });
    return parseResource<Workspace>(body, "workspace", requestId);
  }

  async update(workspaceId: string, changes: WorkspaceChanges): Promise<Workspace> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send(
      "PATCH",
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
      requestId,
      { requestId, workspaceId, changes },
    );
    return parseResource<Workspace>(body, "workspace", requestId);
  }

  async delete(workspaceId: string): Promise<DeleteResult> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send(
      "DELETE",
      `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
      requestId,
      { requestId, workspaceId },
    );
    return parseDeleted(body, requestId);
  }
}
