/**
 * Board resource of the platform API (boards live in a workspace).
 */

import { parseDeleted, parseList, parseResource } from "./envelopes.ts";
import { Transport, withQuery } from "./transport.ts";
import type { Board, BoardChanges, BoardInput, DeleteResult, ListQuery, ListResult } from "./types.ts";

export class BoardsResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async list(workspaceId: string, query: ListQuery = {}): Promise<ListResult<Board>> {
    const requestId = this.#transport.newRequestId();
    const path = withQuery(`/v1/workspaces/${encodeURIComponent(workspaceId)}/boards`, {
      requestId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return parseList<Board>(await this.#transport.send("GET", path, requestId), requestId);
  }

  async create(workspaceId: string, input: BoardInput): Promise<Board> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send(
      "POST",
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/boards`,
      requestId,
      { requestId, board: { workspaceId, ...input } },
    );
    return parseResource<Board>(body, "board", requestId);
  }

  async get(boardId: string, options: { readonly requestId?: string | undefined } = {}): Promise<Board> {
    const requestId = options.requestId ?? this.#transport.newRequestId();
    const path = withQuery(`/v1/boards/${encodeURIComponent(boardId)}`, { requestId });
    return parseResource<Board>(await this.#transport.send("GET", path, requestId), "board", requestId);
  }

  async update(boardId: string, changes: BoardChanges): Promise<Board> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send("PATCH", `/v1/boards/${encodeURIComponent(boardId)}`, requestId, {
      requestId,
      boardId,
      changes,
    });
    return parseResource<Board>(body, "board", requestId);
  }

  async delete(boardId: string): Promise<DeleteResult> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send("DELETE", `/v1/boards/${encodeURIComponent(boardId)}`, requestId, {
      requestId,
      boardId,
    });
    return parseDeleted(body, requestId);
  }
}
