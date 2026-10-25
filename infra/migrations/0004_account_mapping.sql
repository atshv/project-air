-- P3-06: external Kratos identity id -> contract-valid UUIDv7 account id.
--
-- `app.profiles.account_id` stays the platform account id and the row-level
-- security key; contract entities (workspaces.owner_account_id, member ids,
-- board owners) keep referring to UUIDv7 account ids only. Ory Kratos identity
-- ids are UUIDv4 today, so they are stored as an external key in
-- `kratos_identity_id` and never become a contract id or an API value.
--
-- Additive only: no column is dropped and no existing value changes.
--
-- Like 0003's membership helpers, the backfill UPDATE and the SECURITY DEFINER
-- helper below need a migration owner that bypasses row-level security
-- (SUPERUSER or BYPASSRLS; the local Compose `projectair` role is superuser).
-- With a non-bypassing owner the backfill silently updates 0 rows and the helper
-- returns null, so a production migration role must be provisioned accordingly.

ALTER TABLE app.profiles
  ADD COLUMN kratos_identity_id uuid;

COMMENT ON COLUMN app.profiles.account_id IS
  'Platform account id (UUIDv7, contract-valid). The row-level-security key and the id used in API responses.';
COMMENT ON COLUMN app.profiles.kratos_identity_id IS
  'External Ory Kratos identity id (UUIDv4 in the current Kratos). Unique when set; never a contract id and never exposed by the API.';

-- One profile per external identity; partial so v7 ids (identity == account id)
-- and pre-mapping rows without an identity stay valid.
CREATE UNIQUE INDEX profiles_kratos_identity_id_key
  ON app.profiles (kratos_identity_id)
  WHERE kratos_identity_id IS NOT NULL;

-- Be safe about rows written before this migration: nothing exists in the stage
-- database, but if an account id is not a UUIDv7 it can only be an external
-- identity id, so record the mapping and keep the row readable. No data loss.
-- Residual (documented in ADR-0008): such a row keeps its non-v7 account_id; a
-- later remap must update workspaces.owner_account_id,
-- workspace_members.account_id and boards.owner_account_id in one transaction
-- before historical rows are imported.
UPDATE app.profiles
SET kratos_identity_id = account_id
WHERE kratos_identity_id IS NULL
  AND account_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- The platform resolves a session identity before it knows the account id, so
-- profiles_select_self cannot answer (app.account_id is not set yet). This
-- SECURITY DEFINER helper returns exactly one mapped account id for an identity
-- id, never any other profile column. It runs as the migration owner, so it
-- must not be callable by PUBLIC.
CREATE FUNCTION app.account_for_kratos_identity(identity_id uuid) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT profile.account_id
  FROM app.profiles AS profile
  WHERE profile.kratos_identity_id = identity_id;
$$;

REVOKE ALL ON FUNCTION app.account_for_kratos_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.account_for_kratos_identity(uuid) TO app_user;
