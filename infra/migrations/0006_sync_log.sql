-- P5-03: durable per-board update log and snapshots for the realtime sync
-- service. serverSeq is board-wide and strictly increasing; the PK enforces one
-- row per (board, sequence) and the catch-up index serves fromServerSeq scans.

CREATE TABLE sync_updates (
  board_id uuid NOT NULL,
  server_seq bigint NOT NULL CHECK (server_seq >= 1),
  client_id uuid NOT NULL,
  message_id uuid NOT NULL,
  encoded_update bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, server_seq)
);

CREATE INDEX sync_updates_board_seq_idx ON sync_updates (board_id, server_seq);

CREATE TABLE sync_snapshots (
  board_id uuid NOT NULL,
  server_seq bigint NOT NULL CHECK (server_seq >= 1),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, server_seq)
);

CREATE INDEX sync_snapshots_board_seq_idx ON sync_snapshots (board_id, server_seq DESC);
