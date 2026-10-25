# packages/contracts

The common language of Project air: the board-content data model as JSON Schema 2020-12, version
`0.1.0`, with valid and invalid fixtures for every schema.

- **Kind:** `package`
- **Created in stage:** `contract`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)
- **Contract version:** `0.1.0`

Every schema `$id` is `https://project-air.dev/contracts/0.1.0/<entity>.schema.json`. The base URI
is the versioned contract namespace; it is not fetched by any tool in this task.

## Schema map

| File | Entity | Key fields | Rules |
| --- | --- | --- | --- |
| `schemas/account.schema.json` | Account | `id`, `email`, `displayName`, `locale`, timestamps | UUIDv7 ids, `locale` enum `de`/`en` |
| `schemas/workspace.schema.json` | Workspace | `id`, `name`, `ownerId`, timestamps | owned by one account |
| `schemas/board.schema.json` | Board | `id`, `workspaceId`, `ownerId`, `title`, `visibility`, `archived`, timestamps | `visibility` enum `private`/`workspace`/`link` |
| `schemas/note.schema.json` | Note | `id`, `workspaceId`, `title`, timestamps | a note exists once (AD-4); the body is the editor document, added in the editor stage |
| `schemas/card.schema.json` | Note card (placement) | `id`, `boardId`, `noteId`, `zoneId`, `x`, `y`, `width`, `height`, `z`, timestamps | references the note, never embeds it; minimum 176×80; `zoneId` optional parent |
| `schemas/zone.schema.json` | Zone | `id`, `boardId`, `title`, `x`, `y`, `width`, `height`, `z`, timestamps | minimum 256×192; zones are never nested in v1 |
| `schemas/block.schema.json` | Block | `id`, `boardId`, `zoneId`, `type`, `x`, `y`, `width`, `height`, `z`, timestamps | `type` enum; minimum size per type (below) |
| `schemas/edge.schema.json` | Edge | `id`, `boardId`, `from`, `to`, timestamps | endpoints are `{ "kind": "card", "id": … }` only; no card-to-zone edge |
| `schemas/board-content.schema.json` | Root document | `contractVersion`, `board`, `notes`, `zones`, `cards`, `blocks`, `edges` | `$ref`s to every entity; `contractVersion` const `0.1.0` |

Minimum sizes (width × height): note card 176×80, checklist 224×128, palette 224×128, columns
368×192, timeline 320×160, table 288×160, zone 256×192. They are numeric JSON Schema `minimum`
values (the block schema uses `if`/`then` per type), so a validator enforces them.

Geometry: `x`/`y` are world pixels (float), `z` is a fractional index **string** so inserting never
renumbers. Ids are UUIDv7 strings. `createdAt`/`updatedAt` are ISO-8601 strings with timezone.

## Fixtures

`fixtures/<entity>/` holds one file per case in the wrapper

```json
{ "schema": "schemas/card.schema.json", "valid": true, "reason": "…", "data": { … } }
```

Every schema has at least one `valid-*.json` and one `invalid-*.json`; an invalid fixture names the
violated rule in `reason` (minimum size, required field, enum, nesting, edge endpoint, version, …).
The block schema has a valid fixture per block type and an invalid one below each type minimum.
`fixtures/board-content/valid.json` is a complete board document whose references all resolve: two
unique notes, two cards pointing at them, one zone, one checklist block and one card-to-card edge.

## Index and commands

`index.mjs` exports `CONTRACT_VERSION`, `CONTRACT_BASE_URI`, `SCHEMA_FILES`, `FIXTURE_DIRS` and the
`schemaPath`/`schemaId`/`fixturePath` helpers; it has no dependencies.

```sh
pnpm --filter ./packages/contracts test   # node --test test/*.test.mjs
pnpm --filter ./packages/contracts lint
```

The unit suite (Node builtins only) parses every schema and fixture, validates fixtures against the
schemas with a small structural validator, and checks the fixture mapping, required fields, UUIDv7
ids, ISO-8601 timestamps, minimum sizes, enums, the fractional index, AD-4, the parent relation, the
no-nested-zones rule and the card-only edge endpoints.

## Not in 0.1.0

Operations and undo pairs (P1-02), codegen to TypeScript/C++ (P1-03), the sync protocol (P1-04) and
API errors (P1-05). The note body shape arrives with the editor stage; images, files, comments,
templates and workspace members are later contract growth.
