/**
 * Note resource of the platform API (notes live in a workspace; a note exists
 * once and is only referenced by cards).
 */

import { parseDeleted, parseList, parseResource } from "./envelopes.ts";
import { Transport, withQuery } from "./transport.ts";
import type { DeleteResult, ListQuery, ListResult, Note, NoteChanges, NoteInput } from "./types.ts";

export class NotesResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async list(workspaceId: string, query: ListQuery = {}): Promise<ListResult<Note>> {
    const requestId = this.#transport.newRequestId();
    const path = withQuery(`/v1/workspaces/${encodeURIComponent(workspaceId)}/notes`, {
      requestId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return parseList<Note>(await this.#transport.send("GET", path, requestId), requestId);
  }

  async create(workspaceId: string, input: NoteInput): Promise<Note> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send(
      "POST",
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/notes`,
      requestId,
      { requestId, note: { workspaceId, ...input } },
    );
    return parseResource<Note>(body, "note", requestId);
  }

  async get(noteId: string, options: { readonly requestId?: string | undefined } = {}): Promise<Note> {
    const requestId = options.requestId ?? this.#transport.newRequestId();
    const path = withQuery(`/v1/notes/${encodeURIComponent(noteId)}`, { requestId });
    return parseResource<Note>(await this.#transport.send("GET", path, requestId), "note", requestId);
  }

  async update(noteId: string, changes: NoteChanges): Promise<Note> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send("PATCH", `/v1/notes/${encodeURIComponent(noteId)}`, requestId, {
      requestId,
      noteId,
      changes,
    });
    return parseResource<Note>(body, "note", requestId);
  }

  async delete(noteId: string): Promise<DeleteResult> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send("DELETE", `/v1/notes/${encodeURIComponent(noteId)}`, requestId, {
      requestId,
      noteId,
    });
    return parseDeleted(body, requestId);
  }
}
