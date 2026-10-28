# packages/contracts

The common language of Project air: the board-content data model, its operations, the WebSocket
sync protocol and the REST API resources with their error codes as JSON Schema 2020-12, version
`0.3.0`, with valid and invalid fixtures for every schema, generated TypeScript and C++ types, and a
fixture parity harness that proves both sides read the same contract.

- **Kind:** `package`
- **Created in stage:** `contract`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)
- **Contract version:** `0.3.0`

Every schema `$id` is `https://project-air.dev/contracts/0.3.0/<entity>.schema.json`; the sync
protocol is `.../0.3.0/sync.schema.json` and the REST API schemas are `.../0.3.0/api/<name>.schema.json`.
The base URI is the versioned contract namespace; it is not fetched by any tool.

## Schema map

| File | Entity | Key fields | Rules |
| --- | --- | --- | --- |
| `schemas/account.schema.json` | Account | `id`, `email`, `displayName`, `locale`, timestamps | UUIDv7 ids, `locale` enum `de`/`en` |
| `schemas/workspace.schema.json` | Workspace | `id`, `name`, `ownerId`, timestamps | owned by one account |
| `schemas/board.schema.json` | Board | `id`, `workspaceId`, `ownerId`, `title`, `visibility`, `archived`, timestamps | `visibility` enum |
| `schemas/note.schema.json` | Note | `id`, `workspaceId`, `title`, timestamps | a note exists once (AD-4); the body arrives with the editor stage |
| `schemas/card.schema.json` | Note card (placement) | `id`, `boardId`, `noteId`, `zoneId`, geometry, `z`, timestamps | references the note, never embeds it; optional nullable `zoneId` parent; minimum 176×80 |
| `schemas/zone.schema.json` | Zone | `id`, `boardId`, `title`, geometry, `z`, timestamps | minimum 256×192; zones are never nested in v1 |
| `schemas/block.schema.json` | Block | `id`, `boardId`, `zoneId`, `type`, geometry, `z`, timestamps | `type` enum; optional nullable `zoneId` parent; minimum size per type |
| `schemas/edge.schema.json` | Edge | `id`, `boardId`, `from`, `to`, timestamps | endpoints are cards only |
| `schemas/operation.schema.json` | Operation | `id`, `boardId`, `actorId`, `createdAt`, `type`, `payload`, `inverse` | 20 operation types (incl. `reorder`), exactly one inverse, ordered non-nesting `group` |
| `schemas/reorder-payload.schema.json` | Reorder payload | `itemId`, `z` | one card, block or zone and its new fractional index; shared by `reorder` and its inverse |
| `schemas/sync/sync.schema.json` | Sync protocol message | `id`, `clientId`, `boardId`, `seq`/`serverSeq`, `type`, `sentAt`, `payload` | 12 message types in one `oneOf` envelope; `$ref`s to the operations and the root document |
| `schemas/board-content.schema.json` | Root document | `contractVersion`, `board`, `notes`, `zones`, `cards`, `blocks`, `edges` | `$ref`s to every entity; `contractVersion` const `0.3.0` |

Minimum sizes (width × height): note card 176×80, checklist 224×128, palette 224×128, columns
368×192, timeline 320×160, table 288×160, zone 256×192. `z` is a fractional-index string, `x`/`y`
are world pixels, ids are UUIDv7 and timestamps are ISO-8601 with timezone.

## Operations and zone parents (0.3.0)

Every board-content change is one operation with exactly one inverse. 0.1.0 defines 19 types; 0.3.0
adds `reorder`, whose payload `{itemId, z}` stores the new fractional-index `z` of one card, block or
zone and whose inverse carries the previous `z` for the same item. Cards and blocks already carry an
optional nullable `zoneId` (0.1.0, P1-01) that names a zone of the same board; `null` or an absent
field means board level; 0.3.0 documents the rule and adds the containment fixtures.
Zones never carry a parent, so nested zones are invalid in v1, and a dangling parent is rejected by
the containment rule (`fixtures/containment/`, `test/containment.test.mjs`) and, at rest, by the
platform foreign key (P4-26).

## Sync protocol (WebSocket)

The protocol is one versioned JSON Schema document, `schemas/sync/sync.schema.json`, with `$id`
`https://project-air.dev/contracts/0.3.0/sync.schema.json`. Every message carries a UUIDv7 `id`,
the `clientId` of the connection, an ISO-8601 `sentAt` and a typed `payload`; client messages carry
a per-connection `seq`, durable server messages a board-wide `serverSeq`. The `oneOf` envelope
rejects unknown message types and unknown fields (`additionalProperties: false`). Operation
payloads `$ref` the P1-02 `schemas/operation.schema.json`; snapshots `$ref` the root
`schemas/board-content.schema.json`.

| Type | Direction | Payload | Rules |
| --- | --- | --- | --- |
| `hello` | client → server | `tokenRef` (access-token reference) | names no board; first message of a connection |
| `joinBoard` | client → server | none | subscribes to one board; answered by `welcome` (+ `snapshot`) |
| `leaveBoard` | client → server | none | no presence for that board afterwards |
| `operationBatch` | client → server | `batchId`, ordered `operations` | at least one P1-02 operation with its inverse; empty or unknown batch invalid |
| `resyncRequest` | client → server | `fromServerSeq` | catch-up after reconnect from a known seq; a future seq is invalid |
| `presence` | client → server | `cursor`, `selection`, `nameRef`, `colorRef` | ephemeral, no operation data, only for a joined board |
| `welcome` | server → client | `contractVersion`, `snapshotRef` | durable; carries the current `serverSeq`; answers join/resync |
| `ack` | server → client | `batchId`, `opIds` | confirms durability and names every operation of the batch (AD-2) |
| `operationBatch` | server → client | `batchId`, ordered `operations` | broadcast of an acknowledged batch with its `serverSeq` |
| `presence` | server → client | `cursor`, `selection`, `nameRef`, `colorRef` | forwarded ephemeral presence; no `serverSeq`, no operations |
| `reject` | server → client | `code`, optional `detail` | stable language-neutral code (`AUTH_REQUIRED` … `INTERNAL`); user text comes from message keys (P1-05) |
| `snapshot` | server → client | `snapshotRef`, root `boardContent` | catch-up payload after `welcome` |

Sequence rules: `serverSeq` is monotonic per board and an acknowledged batch advances it; client
`seq` is strictly increasing per connection; `ack` covers every operation id of its batch; a batch
id is sent once; `resyncRequest` and `welcome`/`snapshot` form the reconnect catch-up; every
acknowledged batch is durable (AD-2).

Two sequence fixtures cover the cross-field rules that JSON Schema cannot express alone:
`fixtures-sync/valid/reconnect-sequence.json` and `fixtures-sync/valid/session-sequence.json` are
checked by the unit suite, including a future `resyncRequest`, a duplicate batch and an uncovered
`ack`.

## REST API (resources and errors)

The REST contract is a set of closed envelopes for the four resources. Schema files live under
`schemas/api/` (outside the codegen input) and fixtures under `fixtures-api/{valid,invalid}/`.

| Resource | Entity | Envelopes | Create fields | Update fields |
| --- | --- | --- | --- | --- |
| workspace | `schemas/workspace.schema.json` | `list-request`, `list-response`, `response`, `create-request`, `update-request`, `delete-request`, `delete-response` | `name`, `ownerId` | `name` |
| board | `schemas/board.schema.json` | same seven | `workspaceId`, `ownerId`, `title`, `visibility` | `title`, `visibility`, `archived` |
| note | `schemas/note.schema.json` | same seven | `workspaceId`, `title` | `title` |
| card | `schemas/card.schema.json` | same seven | `boardId`, `noteId`, optional `zoneId`, `x`, `y`, `width`, `height`, `z` | `zoneId`, `x`, `y`, `width`, `height`, `z` |

Every envelope carries a UUIDv7 `requestId`, echoed in the response. `list-request` has optional
`cursor` and `limit` (1–100); `list-response` has `items` and `nextCursor` (null at the end, so an
empty list is `items: []` and `nextCursor: null`). A `create-request` carries only client-settable
fields; the server assigns `id`, `createdAt` and `updatedAt`. An `update-request` needs a non-empty
`changes` object; a `delete-response` names the `deletedId`. Resource responses `$ref` the P1-01
entity schema instead of restating it.

The error envelope is `schemas/api/errors.schema.json`. The wire code stays a stable,
language-neutral UPPER_SNAKE code; `messageKey` is required and must be exactly
`errors.<camelCase(code)>`, which keeps the key an English lowerCamelCase segment for
`language-check` (AD-8). A `oneOf` in the schema ties every code to exactly one key.

| Code | Message key |
| --- | --- |
| `AUTH_REQUIRED` | `errors.authRequired` |
| `FORBIDDEN` | `errors.forbidden` |
| `NOT_FOUND` | `errors.notFound` |
| `VALIDATION` | `errors.validation` |
| `CONFLICT` | `errors.conflict` |
| `RATE_LIMITED` | `errors.rateLimited` |
| `INTERNAL` | `errors.internal` |

The seven messages live under `errors` in `apps/web/messages/de.json`, `en.json` and `en-XA.json`
(the pseudo locale is regenerated with `--write-pseudo`); `language-check` requires the same keys in
every locale. `details` carries dotted field paths for validation errors, never user text.
`index.mjs` exports `ERROR_CODES` and `ERROR_MESSAGE_KEYS` as the single source for code and key.
Adding a code means updating the schema, the fixtures and all three locales in one change.

## Generated files (committed, never edit by hand)

`node codegen.mjs` (Node builtins only) reads the top-level `schemas/*.schema.json` and writes two
committed files. The sync protocol schema in `schemas/sync/` and the REST API schemas in
`schemas/api/` are not part of the generated model, so the generated files stay unchanged. Ordering is
stable (schemas, properties, enum values, union members sorted), the output uses LF, a generated-file
banner and the contract version, and it carries no timestamps or absolute paths — two runs produce
identical bytes.

| File | Content |
| --- | --- |
| `generated/types.ts` | `Account`, `Workspace`, `Board`, `Note`, `Card`, `Zone`, `Block`, `Edge`, `BoardContent`, `CardEndpoint`; the `AccountLocale`, `BlockType`, `BoardVisibility`, `DeleteZonePolicy` and `OperationType` enums; one payload interface per operation; the discriminated `Operation` union and the `OperationInverse` pair (with `GroupPayload`/`GroupInversePayload`) |
| `generated/contract.h` | `#pragma once`, C++20 header in `namespace project_air::contracts`: matching structs (`std::string`/`double`/`bool`, `std::optional`, `std::vector`), `enum class` enums, the payload structs, `std::variant` unions, `OperationInverse`/`Operation` and `kContractVersion` |

The generated header compiles with `-std=c++20 -Wall -Wextra -Wpedantic -Werror`. The `codegen`
gate runs `codegen` and `git diff --exit-code -- packages/contracts`, so a hand edit or a stale file
fails.

## Fixture parity (AD-3)

The unit suite runs a two-sided harness over **every** fixture (86: 37 valid, 49 invalid). The
corpus lives in `fixtures/`; the sync protocol fixtures in `fixtures-sync/`, the REST API fixtures
in `fixtures-api/` and the gate specimens in `fixtures-gate/` are deliberately outside it, so the
counts stay stable:

- TypeScript: `test/parity/canonical.ts` reduces each fixture wrapper to one canonical line
  `fixture|schema|valid|type|inverse|ids|fields|reason` (normalized reason, sorted UUID ids and
  sorted top-level fields). It is type-checked against `generated/types.ts`.
- C++: `test/cpp/parity.cpp` reads the same fixtures with a small self-written JSON reader (no
  third-party library), includes `generated/contract.h`, instantiates the generated operation model
  and prints the same canonical lines.
- `test/parity.test.mjs` compiles the C++ program with the local compiler and asserts the two line
  sets are identical; a tampered line is detected. Without a C++ compiler the test fails with a
  clear message — it never silently skips.

The C++ compiler is the locally installed `clang++` (preferred) or `g++`; no CMake and no
Emscripten are needed for this package. The test builds with
`-std=c++20 -Wall -Wextra -Wpedantic -Werror`.

## Commands

```sh
pnpm --filter ./packages/contracts run codegen    # regenerate generated/types.ts and generated/contract.h
pnpm --filter ./packages/contracts test           # node --test test/*.test.mjs (incl. C++ parity)
pnpm --filter ./packages/contracts typecheck      # tsc --noEmit over the generated TS types and parity harness
pnpm --filter ./packages/contracts lint
```

From the repository root, `node tools/language-check/index.mjs .` runs the translation gate that
keeps the error message keys in parity across the locales. Without an install,
`node --test packages/contracts/test/*.test.mjs` runs the same suite. The package has no
dependencies; the tests use Node builtins and the local C++ compiler only.

## Fixtures

`fixtures/<entity>/` holds one file per case in the wrapper
`{ "schema": "schemas/card.schema.json", "valid": true, "reason": "…", "data": { … } }`. Every
schema has at least one valid and one invalid fixture; an invalid fixture names the violated rule.
The operation fixtures cover all 20 operation types plus inverse, `group` and `reorder` edge cases.
This tree is the 86-fixture parity corpus (37 valid, 49 invalid) and grows only additively. The
reorder payload has its own folder because it is its own schema file shared by the operation and its
inverse.

`fixtures/containment/` holds the two board-content specimens for the parent rule JSON Schema cannot
compare across the document: one valid document with zoned and board-level cards/blocks and one
invalid document with a dangling parent. They are part of the parity corpus and are checked by
`test/containment.test.mjs`.

`fixtures-sync/{valid,invalid}/` holds the sync protocol fixtures: one valid and one invalid example
per message type plus the reconnect and session sequence logs, all in the same wrapper.

`fixtures-api/{valid,invalid}/` holds the REST API fixtures: one valid example per resource
envelope, one error example per error code, and invalid examples for closed bodies, pagination and
the code/messageKey mapping.

`fixtures-gate/{valid,invalid}/` holds the direct `board-content.json` specimens for the Polier
`contracts` gate (P1-06), because Polier 1.0 requires `fixtures_dir/valid/*.json` and
`fixtures_dir/invalid/*.json` as direct files. The specimens are byte-identical copies of
`fixtures/board-content/valid.json` and `fixtures/board-content/invalid-missing-board.json`; a unit
test enforces the copies.

## Not in 0.3.0

Runtime validation and CMake/Emscripten packaging belong to the engine stage. Block content,
images, files, comments, templates and workspace members are later contract growth.
