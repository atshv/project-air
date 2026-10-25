-- P3-02: row-level security for the workspace schema (AD-5, second line).
--
-- Policies bind the restricted `app_user` role only. The application sets
-- `app.account_id` with `SET LOCAL` inside each transaction before it queries;
-- the helper `app.current_account_id()` returns null when the setting is
-- missing, so an unauthenticated query yields zero rows instead of an error.
--
-- The membership helpers are SECURITY DEFINER on purpose: a policy on
-- `workspace_members` cannot query `workspace_members` through that table's own
-- policies without recursing. They are owned by the migration role, which is the
-- Compose superuser locally; a production setup needs a dedicated role with
-- BYPASSRLS for them. They only read membership rows and return booleans, and
-- EXECUTE is revoked from PUBLIC and granted to app_user only (the policies and
-- triggers are the only callers).

CREATE FUNCTION app.current_account_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('app.account_id', true) ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN current_setting('app.account_id', true)::uuid
    ELSE NULL
  END;
$$;

CREATE FUNCTION app.is_workspace_member(target_workspace_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.workspace_members AS member
    WHERE member.workspace_id = target_workspace_id
      AND member.account_id = app.current_account_id()
  );
$$;

CREATE FUNCTION app.can_write_workspace(target_workspace_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.workspace_members AS member
    WHERE member.workspace_id = target_workspace_id
      AND member.account_id = app.current_account_id()
      AND member.role IN ('owner', 'editor')
  );
$$;

CREATE FUNCTION app.is_workspace_owner(target_workspace_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.workspaces AS workspace
    WHERE workspace.id = target_workspace_id
      AND workspace.owner_account_id = app.current_account_id()
  );
$$;

CREATE FUNCTION app.is_board_member(target_board_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.boards AS board
    JOIN app.workspace_members AS member ON member.workspace_id = board.workspace_id
    WHERE board.id = target_board_id
      AND member.account_id = app.current_account_id()
  );
$$;

CREATE FUNCTION app.can_write_board(target_board_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.boards AS board
    JOIN app.workspace_members AS member ON member.workspace_id = board.workspace_id
    WHERE board.id = target_board_id
      AND member.account_id = app.current_account_id()
      AND member.role IN ('owner', 'editor')
  );
$$;

-- True only when the note lives in the board's workspace and the current
-- account may write that board. A foreign or unknown pair returns false, so the
-- helper cannot be used to probe another workspace for existing ids.
CREATE FUNCTION app.note_in_board_workspace(target_note_id uuid, target_board_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.notes AS note
    JOIN app.boards AS board ON board.workspace_id = note.workspace_id
    JOIN app.workspace_members AS member ON member.workspace_id = board.workspace_id
    WHERE note.id = target_note_id
      AND board.id = target_board_id
      AND member.account_id = app.current_account_id()
      AND member.role IN ('owner', 'editor')
  );
$$;

-- profiles: one row per account, visible and writable only by that account.
ALTER TABLE app.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_self ON app.profiles
  FOR SELECT TO app_user
  USING (account_id = app.current_account_id());
CREATE POLICY profiles_insert_self ON app.profiles
  FOR INSERT TO app_user
  WITH CHECK (account_id = app.current_account_id());
CREATE POLICY profiles_update_self ON app.profiles
  FOR UPDATE TO app_user
  USING (account_id = app.current_account_id())
  WITH CHECK (account_id = app.current_account_id());

-- workspaces: read for every member, write for owner/editor, delete only for
-- the owner. An account may only create a workspace it owns.
ALTER TABLE app.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_select_member ON app.workspaces
  FOR SELECT TO app_user
  USING (owner_account_id = app.current_account_id() OR app.is_workspace_member(id));
CREATE POLICY workspaces_insert_owner ON app.workspaces
  FOR INSERT TO app_user
  WITH CHECK (owner_account_id = app.current_account_id());
CREATE POLICY workspaces_update_writer ON app.workspaces
  FOR UPDATE TO app_user
  USING (app.can_write_workspace(id))
  WITH CHECK (app.can_write_workspace(id));
CREATE POLICY workspaces_delete_owner ON app.workspaces
  FOR DELETE TO app_user
  USING (app.is_workspace_owner(id));

-- workspace_members: every member can see the membership list, only the owner
-- can add, change or remove members. The owner row itself is protected by the
-- trigger from 0002.
ALTER TABLE app.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_members FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_members_select_member ON app.workspace_members
  FOR SELECT TO app_user
  USING (account_id = app.current_account_id() OR app.is_workspace_member(workspace_id));
CREATE POLICY workspace_members_insert_owner ON app.workspace_members
  FOR INSERT TO app_user
  WITH CHECK (app.is_workspace_owner(workspace_id));
CREATE POLICY workspace_members_update_owner ON app.workspace_members
  FOR UPDATE TO app_user
  USING (app.is_workspace_owner(workspace_id))
  WITH CHECK (app.is_workspace_owner(workspace_id));
CREATE POLICY workspace_members_delete_owner ON app.workspace_members
  FOR DELETE TO app_user
  USING (app.is_workspace_owner(workspace_id));

-- boards: read for every member, write for owner/editor. The write check on the
-- workspace blocks inserts into a foreign workspace, and an inserted board must
-- be owned by the creating account.
ALTER TABLE app.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.boards FORCE ROW LEVEL SECURITY;
CREATE POLICY boards_select_member ON app.boards
  FOR SELECT TO app_user
  USING (app.is_workspace_member(workspace_id));
CREATE POLICY boards_insert_writer ON app.boards
  FOR INSERT TO app_user
  WITH CHECK (app.can_write_workspace(workspace_id) AND owner_account_id = app.current_account_id());
CREATE POLICY boards_update_writer ON app.boards
  FOR UPDATE TO app_user
  USING (app.can_write_workspace(workspace_id))
  WITH CHECK (app.can_write_workspace(workspace_id));
CREATE POLICY boards_delete_writer ON app.boards
  FOR DELETE TO app_user
  USING (app.can_write_workspace(workspace_id));

-- notes: same matrix as boards (workspace-scoped, no per-note owner).
ALTER TABLE app.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notes FORCE ROW LEVEL SECURITY;
CREATE POLICY notes_select_member ON app.notes
  FOR SELECT TO app_user
  USING (app.is_workspace_member(workspace_id));
CREATE POLICY notes_insert_writer ON app.notes
  FOR INSERT TO app_user
  WITH CHECK (app.can_write_workspace(workspace_id));
CREATE POLICY notes_update_writer ON app.notes
  FOR UPDATE TO app_user
  USING (app.can_write_workspace(workspace_id))
  WITH CHECK (app.can_write_workspace(workspace_id));
CREATE POLICY notes_delete_writer ON app.notes
  FOR DELETE TO app_user
  USING (app.can_write_workspace(workspace_id));

-- cards: read for every member of the board's workspace, write for owner/editor
-- of that workspace. A card may only place a note that lives in the board's own
-- workspace, so a foreign note cannot be attached by guessing its id.
ALTER TABLE app.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cards FORCE ROW LEVEL SECURITY;
CREATE POLICY cards_select_member ON app.cards
  FOR SELECT TO app_user
  USING (app.is_board_member(board_id));
CREATE POLICY cards_insert_writer ON app.cards
  FOR INSERT TO app_user
  WITH CHECK (app.can_write_board(board_id) AND app.note_in_board_workspace(note_id, board_id));
CREATE POLICY cards_update_writer ON app.cards
  FOR UPDATE TO app_user
  USING (app.can_write_board(board_id))
  WITH CHECK (app.can_write_board(board_id) AND app.note_in_board_workspace(note_id, board_id));
CREATE POLICY cards_delete_writer ON app.cards
  FOR DELETE TO app_user
  USING (app.can_write_board(board_id));

-- Grants for the restricted application role. The tables stay owned by the
-- migration role, so app_user can never own or bypass them (AD-5). Functions are
-- executable by app_user only: the default PUBLIC EXECUTE is revoked first.
GRANT USAGE ON SCHEMA app TO app_user;
GRANT USAGE ON TYPE app.workspace_role, app.board_visibility TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_user;
REVOKE ALL ON FUNCTION
  app.current_account_id(),
  app.is_workspace_member(uuid),
  app.can_write_workspace(uuid),
  app.is_workspace_owner(uuid),
  app.is_board_member(uuid),
  app.can_write_board(uuid),
  app.note_in_board_workspace(uuid, uuid),
  app.workspace_add_owner_membership(),
  app.protect_owner_membership(),
  app.protect_workspace_owner(),
  app.protect_card_note_workspace(),
  app.validate_workspace_owner_role(),
  app.protect_note_workspace(),
  app.protect_board_workspace(),
  app.protect_profile_owner_delete()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.current_account_id(),
  app.is_workspace_member(uuid),
  app.can_write_workspace(uuid),
  app.is_workspace_owner(uuid),
  app.is_board_member(uuid),
  app.can_write_board(uuid),
  app.note_in_board_workspace(uuid, uuid),
  app.workspace_add_owner_membership(),
  app.protect_owner_membership(),
  app.protect_workspace_owner(),
  app.protect_card_note_workspace(),
  app.validate_workspace_owner_role(),
  app.protect_note_workspace(),
  app.protect_board_workspace(),
  app.protect_profile_owner_delete()
TO app_user;
