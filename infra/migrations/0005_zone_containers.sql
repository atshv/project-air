-- P4-26: zones as containers, storage half (ADR-0010, AD-4, AD-5).
--
-- Adds `app.zones` with the contract 0.2.0 zone fields and turns the nullable
-- `cards.zone_id` (a plain uuid since 0002) into a reference to a zone of the
-- card's own board. `null` keeps meaning "directly on the board".
--
-- Invariants enforced here for every role, including the migration owner:
-- * a card's parent is a zone of the same board: the composite foreign key
--   `(board_id, zone_id) -> zones (board_id, id)` rejects a cross-board, a
--   dangling or a non-zone parent (SQLSTATE 23503);
-- * zones are not nested in v1: a zone has no parent column at all;
-- * deleting a zone keeps its cards on the board (`ON DELETE SET NULL
--   (zone_id)`, ADR-0010 "keep content"); "delete content" is an explicit
--   operation of the engine/API layer, not a database cascade;
-- * `zones.board_id` is immutable, like `boards.workspace_id`.
--
-- Like 0004's backfill, the UPDATE below needs a migration owner that bypasses
-- row-level security (SUPERUSER or BYPASSRLS; the local Compose role is
-- superuser). Row-level security for zones mirrors the card matrix of 0003.

CREATE TABLE app.zones (
  id uuid PRIMARY KEY,
  board_id uuid NOT NULL REFERENCES app.boards (id) ON DELETE CASCADE,
  title text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  width double precision NOT NULL,
  height double precision NOT NULL,
  z text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zones_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT zones_minimum_size CHECK (width >= 256 AND height >= 192),
  CONSTRAINT zones_z_format CHECK (z ~ '^[A-Za-z0-9]{1,64}$'),
  -- The target of the card parent key: a parent must be a zone of the board.
  CONSTRAINT zones_board_id_id_key UNIQUE (board_id, id)
);

CREATE INDEX zones_board_id_z_idx ON app.zones (board_id, z);

-- No zone table existed before this migration, so a non-null zone_id cannot
-- name a zone: such a legacy row has no parent (ADR-0010). Nothing is lost
-- that could ever have resolved.
UPDATE app.cards
SET zone_id = NULL
WHERE zone_id IS NOT NULL;

ALTER TABLE app.cards
  ADD CONSTRAINT cards_zone_fkey
  FOREIGN KEY (board_id, zone_id) REFERENCES app.zones (board_id, id)
  ON DELETE SET NULL (zone_id);

COMMENT ON COLUMN app.cards.zone_id IS
  'Parent zone of the same board (ADR-0010); null means the card sits directly on the board.';

CREATE FUNCTION app.protect_zone_board() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.board_id <> OLD.board_id THEN
    RAISE EXCEPTION 'moving a zone to another board is not supported';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER zones_protect_board
BEFORE UPDATE OF board_id ON app.zones
FOR EACH ROW EXECUTE FUNCTION app.protect_zone_board();

-- zones: read for every member of the board's workspace, write for
-- owner/editor of that workspace (the card matrix).
ALTER TABLE app.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.zones FORCE ROW LEVEL SECURITY;
CREATE POLICY zones_select_member ON app.zones
  FOR SELECT TO app_user
  USING (app.is_board_member(board_id));
CREATE POLICY zones_insert_writer ON app.zones
  FOR INSERT TO app_user
  WITH CHECK (app.can_write_board(board_id));
CREATE POLICY zones_update_writer ON app.zones
  FOR UPDATE TO app_user
  USING (app.can_write_board(board_id))
  WITH CHECK (app.can_write_board(board_id));
CREATE POLICY zones_delete_writer ON app.zones
  FOR DELETE TO app_user
  USING (app.can_write_board(board_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON app.zones TO app_user;
REVOKE ALL ON FUNCTION app.protect_zone_board() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.protect_zone_board() TO app_user;
