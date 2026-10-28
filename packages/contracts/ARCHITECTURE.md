# Architecture: packages/contracts

**Kind:** `package` · **Created in stage:** `contract`

## Purpose

The common language of the workspace: the board-content model, its operations with exactly one
inverse, the sync protocol and the REST API resources with their error codes, as JSON Schema
2020-12 (contract `0.3.0`) with fixtures, generated TypeScript/C++ types and a parity harness.

## Inputs

- Schemas under `schemas/` (entities, operation envelope, root document); the sync protocol lives in
  `schemas/sync/` and the API envelopes in `schemas/api/`. Codegen reads only top-level files.
- Fixtures in the `{schema, valid, reason, data}` wrapper: 86 parity fixtures in `fixtures/`
  (eleven schema directories plus the containment corpus), sync fixtures in `fixtures-sync/`, API
  fixtures in `fixtures-api/`, gate specimens in `fixtures-gate/`; no runtime dependencies.

## Outputs

- Versioned schemas with `$id` `0.3.0`; deterministic `generated/types.ts` and
  `generated/contract.h`, committed and never hand-edited.
- `index.mjs`: version, operation vocabulary, sync message table, error-code table, schema and
  fixture paths.

## Invariants

- `AD-1`: one operation, exactly one inverse; `group` reverses child inverses; `reorder` stores the
  new fractional `z` and its inverse the previous one. `AD-4`: a note exists once. Cards and blocks
  may carry a nullable zone parent; zones never do (no nested zones in v1).
- `AD-2`: durable `serverSeq`, an `ack` covers its batch, no operation data in presence.
- `AD-8`: REST errors carry UPPER_SNAKE codes and `messageKey` `errors.<camelCase>`; text lives only
  in `apps/web/messages`, and `language-check` keeps the locales in parity.
- Codegen plus `git diff --exit-code`; the header compiles with
  `-std=c++20 -Wall -Wextra -Wpedantic -Werror`.

## Sync protocol messages

`schemas/sync/sync.schema.json`: one `oneOf` envelope with UUIDv7 `id`, `clientId`, ISO-8601
`sentAt`, `type`, `payload`; client messages carry `seq`, durable server messages `serverSeq`.
Reconnect is `resyncRequest` then `welcome`/`snapshot`; the full message table is in the README.

## REST API resources and errors

`schemas/api/<resource>.schema.json` are closed envelopes for workspace, board, note and card:
`requestId` everywhere, `list` with `items`/`nextCursor`, `create` with client-settable fields,
`update` with a non-empty `changes`, `delete` with `deletedId`; responses `$ref` the P1-01 entity.
`schemas/api/errors.schema.json` has the fixed UPPER_SNAKE code enum, a required `messageKey`
(`errors.<camelCase>`) and `details` with field paths only.

## Allowed imports

None; tests use Node builtins and the local C++ compiler.

## Commands

`pnpm --filter ./packages/contracts run <script>` for `codegen`, `test` (unit with C++ parity),
`typecheck`, `lint`.

## References

[ARCHITECTURE.md](../../ARCHITECTURE.md) · [docs/module-map.md](../../docs/module-map.md) ·
[owner blueprint §5](../../docs/owner/canvas-suite-blueprint.md)
