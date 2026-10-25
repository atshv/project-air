# Architecture: packages/contracts

**Kind:** `package` · **Created in stage:** `contract`

## Purpose

The common language of the workspace: the board-content model, its operations with exactly one
inverse and the sync protocol, as JSON Schema 2020-12 (contract `0.1.0`) with fixtures, generated
TypeScript/C++ types and a parity harness.

## Inputs

- Schemas under `schemas/` (entities, operation envelope, root document) and the sync protocol in
  `schemas/sync/`; codegen reads only top-level files.
- Fixtures in the `{schema, valid, reason, data}` wrapper: 77 parity fixtures in `fixtures/`, sync
  fixtures in `fixtures-sync/`, gate specimens in `fixtures-gate/`; no runtime dependencies.

## Outputs

- Versioned schemas with `$id` `0.1.0`; deterministic `generated/types.ts` and
  `generated/contract.h`, committed and never hand-edited.
- `index.mjs`: version, operation vocabulary, sync message table, schema and fixture paths.

## Invariants

- `AD-1`: one operation, exactly one inverse; `group` reverses child inverses. `AD-4`: a note exists
  once.
- `AD-2`: durable `serverSeq`, an `ack` covers its batch, no operation data in presence.
- Codegen plus `git diff --exit-code`; the header compiles with
  `-std=c++20 -Wall -Wextra -Wpedantic -Werror`.

## Sync protocol messages

`schemas/sync/sync.schema.json`: one `oneOf` envelope with UUIDv7 `id`, `clientId`, ISO-8601
`sentAt`, `type`, `payload`; client messages carry `seq`, durable server messages `serverSeq`.

| Type | Direction | Payload |
| --- | --- | --- |
| `hello` | → server | `tokenRef`, no board |
| `joinBoard` | → server | none, answered by `welcome` |
| `leaveBoard` | → server | none |
| `operationBatch` | → server | ordered P1-02 operations |
| `resyncRequest` | → server | `fromServerSeq` |
| `presence` | → server | cursor, selection, name/colour refs |
| `welcome` | → client | `serverSeq`, `snapshotRef` |
| `ack` | → client | `batchId`, `opIds` |
| `operationBatch` | → client | acknowledged broadcast |
| `presence` | → client | forwarded, no `serverSeq` |
| `reject` | → client | stable code, no text |
| `snapshot` | → client | root `boardContent` |

Reconnect: `resyncRequest` then `welcome`/`snapshot`. `serverSeq` and client `seq` are monotonic, an
`ack` names every operation id, a batch id is sent once; batches `$ref` the P1-02 schema, snapshots
the root document. Sequence fixtures prove these cross-field rules.

## Allowed imports

None; tests use Node builtins and the local C++ compiler.

## Commands

`pnpm --filter ./packages/contracts run <script>` for `codegen`, `test` (unit with C++ parity),
`typecheck`, `lint`.

## References

[ARCHITECTURE.md](../../ARCHITECTURE.md) · [docs/module-map.md](../../docs/module-map.md) ·
[owner blueprint §5](../../docs/owner/canvas-suite-blueprint.md)
