/**
 * Card resource of the platform API (a card is a note placement on a board).
 */

import { parseDeleted, parseList, parseResource } from "./envelopes.ts";
import { Transport, withQuery } from "./transport.ts";
import type { Card, CardChanges, CardInput, DeleteResult, ListQuery, ListResult } from "./types.ts";

export class CardsResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  async list(boardId: string, query: ListQuery = {}): Promise<ListResult<Card>> {
    const requestId = this.#transport.newRequestId();
    const path = withQuery(`/v1/boards/${encodeURIComponent(boardId)}/cards`, {
      requestId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return parseList<Card>(await this.#transport.send("GET", path, requestId), requestId);
  }

  async create(boardId: string, input: CardInput): Promise<Card> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send(
      "POST",
      `/v1/boards/${encodeURIComponent(boardId)}/cards`,
      requestId,
      { requestId, card: { boardId, ...input } },
    );
    return parseResource<Card>(body, "card", requestId);
  }

  async get(cardId: string, options: { readonly requestId?: string | undefined } = {}): Promise<Card> {
    const requestId = options.requestId ?? this.#transport.newRequestId();
    const path = withQuery(`/v1/cards/${encodeURIComponent(cardId)}`, { requestId });
    return parseResource<Card>(await this.#transport.send("GET", path, requestId), "card", requestId);
  }

  async update(cardId: string, changes: CardChanges): Promise<Card> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send("PATCH", `/v1/cards/${encodeURIComponent(cardId)}`, requestId, {
      requestId,
      cardId,
      changes,
    });
    return parseResource<Card>(body, "card", requestId);
  }

  async delete(cardId: string): Promise<DeleteResult> {
    const requestId = this.#transport.newRequestId();
    const body = await this.#transport.send("DELETE", `/v1/cards/${encodeURIComponent(cardId)}`, requestId, {
      requestId,
      cardId,
    });
    return parseDeleted(body, requestId);
  }
}
