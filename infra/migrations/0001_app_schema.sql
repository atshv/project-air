-- P3-01: the application schema namespace.
--
-- P3-02 adds the workspace, board, note and card tables plus their row-level
-- security policies inside this schema. The migration runner records every file
-- in `schema_migrations` together with its SHA-256 checksum, so an applied file
-- is never edited: later changes arrive as new numbered migrations.

CREATE SCHEMA IF NOT EXISTS app;
