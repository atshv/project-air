// P5-03: PostgreSQL update log. appendUpdate allocates the next per-board
// serverSeq and inserts the encoded update in ONE transaction that commits
// before the caller acks (AD-2). serverSeq is always read from the DB.

import pg from "pg";
import type { BoardContent } from "./types.ts";
import type { BoardState, StoredUpdate, SyncStore } from "./protocol.ts";

const { Pool } = pg;

export interface PgSyncStoreOptions {
  readonly connectionString: string;
  readonly max?: number;
}

export class PgSyncStore implements SyncStore {
  readonly #pool: pg.Pool;

  constructor(options: PgSyncStoreOptions) {
    this.#pool = new Pool({ connectionString: options.connectionString, max: options.max ?? 5 });
  }

  async close(): Promise<void> { await this.#pool.end(); }

  async serverSeq(boardId: string): Promise<number> {
    const result = await this.#pool.query<{ server_seq: string }>(
      "SELECT COALESCE(MAX(server_seq), 0)::text AS server_seq FROM sync_updates WHERE board_id = $1",
      [boardId],
    );
    return Number(result.rows[0]?.server_seq ?? "0");
  }

  async loadBoard(boardId: string): Promise<BoardState | null> {
    const snapshot = await this.#ensureBaseline(boardId);
    const seq = await this.#currentSeq(boardId);
    return { serverSeq: seq, snapshotSeq: snapshot.serverSeq, boardContent: snapshot.boardContent };
  }

  /** Current max across the durable update log and snapshots (baseline is 1). */
  async #currentSeq(boardId: string): Promise<number> {
    const result = await this.#pool.query<{ seq: string }>(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(server_seq) FROM sync_updates WHERE board_id = $1), 0),
         COALESCE((SELECT MAX(server_seq) FROM sync_snapshots WHERE board_id = $1), 0)
       )::text AS seq`,
      [boardId],
    );
    return Number(result.rows[0]?.seq ?? "1");
  }

  /** Fresh boards get one baseline snapshot at serverSeq 1 inside a transaction. */
  async #ensureBaseline(boardId: string): Promise<{ serverSeq: number; boardContent: BoardContent }> {
    const latest = await this.#pool.query<{ snapshot: BoardContent; server_seq: string }>(
      "SELECT snapshot, server_seq::text AS server_seq FROM sync_snapshots WHERE board_id = $1 ORDER BY server_seq DESC LIMIT 1",
      [boardId],
    );
    if (latest.rows[0] !== undefined) {
      return { serverSeq: Number(latest.rows[0].server_seq), boardContent: latest.rows[0].snapshot };
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [boardId]);
      const existing = await client.query<{ server_seq: string; snapshot: BoardContent }>(
        "SELECT server_seq::text AS server_seq, snapshot FROM sync_snapshots WHERE board_id = $1 ORDER BY server_seq DESC LIMIT 1",
        [boardId],
      );
      if (existing.rows[0] !== undefined) {
        await client.query("COMMIT");
        return { serverSeq: Number(existing.rows[0].server_seq), boardContent: existing.rows[0].snapshot };
      }
      const content = emptyBoardContent(boardId);
      await client.query("INSERT INTO sync_snapshots (board_id, server_seq, snapshot) VALUES ($1, 1, $2)", [boardId, content]);
      await client.query("COMMIT");
      return { serverSeq: 1, boardContent: content };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async appendUpdate(input: { boardId: string; clientId: string; messageId: string; update: string }): Promise<number> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      // One advisory transaction lock per board serialises the next-sequence
      // allocation; FOR UPDATE cannot be combined with the MAX aggregate.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.boardId]);
      const next = await client.query<{ server_seq: string }>(
        `SELECT GREATEST(
           COALESCE((SELECT MAX(server_seq) FROM sync_updates WHERE board_id = $1), 0),
           COALESCE((SELECT MAX(server_seq) FROM sync_snapshots WHERE board_id = $1), 0)
         ) + 1 AS server_seq`,
        [input.boardId],
      );
      const serverSeq = Number(next.rows[0]!.server_seq);
      await client.query(
        "INSERT INTO sync_updates (board_id, server_seq, client_id, message_id, encoded_update) VALUES ($1, $2, $3, $4, $5)",
        [input.boardId, serverSeq, input.clientId, input.messageId, Buffer.from(input.update, "base64")],
      );
      await client.query("COMMIT");
      return serverSeq;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async updatesAfter(boardId: string, fromServerSeq: number, limit = 500): Promise<StoredUpdate[]> {
    const result = await this.#pool.query<{ server_seq: string; encoded_update: Buffer }>(
      "SELECT server_seq::text AS server_seq, encoded_update FROM sync_updates WHERE board_id = $1 AND server_seq > $2 ORDER BY server_seq ASC LIMIT $3",
      [boardId, fromServerSeq, limit],
    );
    return result.rows.map((row) => ({ serverSeq: Number(row.server_seq), update: row.encoded_update.toString("base64") }));
  }
}

/** Placeholder root document until the first operation/snapshot arrives (P5-06). */
function emptyBoardContent(boardId: string): BoardContent {
  return {
    contractVersion: "0.3.0",
    board: {
      id: boardId, workspaceId: "", ownerId: "", title: "", visibility: "private", archived: false,
      createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
    },
    zones: [], blocks: [], cards: [], notes: [], edges: [],
  };
}
