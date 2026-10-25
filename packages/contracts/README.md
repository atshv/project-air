# packages/contracts

The common language of Project air: the board-content data model and its operations as JSON Schema
2020-12, version `0.1.0`, with valid and invalid fixtures for every schema.

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
| `schemas/operation.schema.json` | Operation | `id`, `boardId`, `actorId`, `createdAt`, `type`, `payload`, `inverse` | one change with exactly one inverse (below); `group` bundles ordered children |
| `schemas/board-content.schema.json` | Root document | `contractVersion`, `board`, `notes`, `zones`, `cards`, `blocks`, `edges` | `$ref`s to every entity; `contractVersion` const `0.1.0` |

Minimum sizes (width × height): note card 176×80, checklist 224×128, palette 224×128, columns
368×192, timeline 320×160, table 288×160, zone 256×192. They are numeric JSON Schema `minimum`
values (the block schema uses `if`/`then` per type), so a validator enforces them, including in the
`resizeCard`/`resizeZone`/`resizeBlock` operation payloads.

Geometry: `x`/`y` are world pixels (float), `z` is a fractional index **string** so inserting never
renumbers. Ids are UUIDv7 strings. `createdAt`/`updatedAt` are ISO-8601 strings with timezone.

## Operations

Every operation is one gesture (AD-1): `{id, boardId, actorId, createdAt, type, payload, inverse}`.
The envelope is `schemas/operation.schema.json`; the `type` enum and `OPERATION_TYPES` in `index.mjs`
list the vocabulary.

| Operation | Payload | Inverse |
| --- | --- | --- |
| `createNote` | `note` | `deleteNote` (same note, empty `cards`) |
| `updateNote` | `noteId`, `changes` (title) | `updateNote` with the previous values |
| `deleteNote` | `note`, `cards` (its placements) | `group` recreating the note and its cards (AD-4) |
| `createCard` | `card` | `deleteCard` |
| `moveCard` | `cardId`, `x`, `y`, `zoneId?` | `moveCard` with the previous position and parent |
| `resizeCard` | `cardId`, `width` ≥ 176, `height` ≥ 80 | `resizeCard` with the previous size |
| `deleteCard` | `card` | `createCard` |
| `createZone` | `zone` | `deleteZone` (empty zone) |
| `moveZone` | `zoneId`, `x`, `y` | `moveZone` with the previous position |
| `resizeZone` | `zoneId`, `width` ≥ 256, `height` ≥ 192 | `resizeZone` with the previous size |
| `deleteZone` | `zone`, `policy` (`keep`/`delete`), `cards`, `blocks` | `group` restoring the zone and its members (reparented for `keep`, recreated for `delete`) |
| `createBlock` | `block` | `deleteBlock` |
| `moveBlock` | `blockId`, `x`, `y`, `zoneId?` | `moveBlock` with the previous position and parent |
| `resizeBlock` | `blockId`, `type`, `width`, `height` | `resizeBlock` with the previous size |
| `updateBlock` | `blockId`, `changes` (`zoneId`) | `updateBlock` with the previous values |
| `deleteBlock` | `block` | `createBlock` |
| `createEdge` | `edge` | `deleteEdge` |
| `deleteEdge` | `edge` | `createEdge` |
| `group` | ordered `children` (at least one, no nested groups) | `group` whose children are the reversed child inverses |

Inverse rule: **exactly one** `inverse` per operation. A create's inverse is the matching delete; an
update stores the previous values of the fields it changes; a move/resize stores the previous
geometry; a delete stores the whole object. A delete that removes several objects (a note with its
cards, a zone with its members) has a `group` inverse, because JSON Schema must keep one inverse per
operation. The inverse carries the operation `boardId` and the same target id.

`group` children are full operations in order. The inverse is the reversed list of the child
inverses (`inverse.payload.children = [...children.map(c => c.inverse)].reverse()`). Groups do not
nest: `child-operation` rejects `type: "group"`, and the inverse of a group contains inverse pairs,
not further group operations. JSON Schema cannot compare values across fields, so the inverse
board/target equality, the group reversal, the no-nesting rule and the exact-one-inverse rule are
checked by the unit suite in addition to the schema.

## Fixtures

`fixtures/<entity>/` holds one file per case in the wrapper

```json
{ "schema": "schemas/card.schema.json", "valid": true, "reason": "…", "data": { … } }
```

Every schema has at least one `valid-*.json` and one `invalid-*.json`; an invalid fixture names the
violated rule in `reason` (minimum size, required field, enum, nesting, edge endpoint, version, …).
The block schema has a valid fixture per block type and an invalid one below each type minimum.

`fixtures/operation/` has a valid and an invalid fixture for every operation type (19 valid, 23
invalid) and extra invalid cases for an empty group, a nested group, a group inverse in the wrong
order, and an inverse with a mismatching board or target. `fixtures/board-content/valid.json` is a
complete board document whose references all resolve.

## Index and commands

`index.mjs` exports `CONTRACT_VERSION`, `CONTRACT_BASE_URI`, `OPERATION_TYPES`, `SCHEMA_FILES`,
`FIXTURE_DIRS` and the `schemaPath`/`schemaId`/`fixturePath` helpers; it has no dependencies.

```sh
pnpm --filter ./packages/contracts test   # node --test test/*.test.mjs
pnpm --filter ./packages/contracts lint
```

The unit suite (Node builtins only) parses every schema and fixture, validates fixtures against the
schemas with a small structural validator, and checks the fixture mapping, required fields, UUIDv7
ids, ISO-8601 timestamps, minimum sizes, enums, the fractional index, AD-4, the parent relation, the
no-nested-zones rule, the card-only edge endpoints, the operation vocabulary, exactly one inverse per
type, the inverse board/target equality, updates storing previous values, deletes storing objects,
group reversal and no group nesting.

## Not in 0.1.0

Codegen to TypeScript/C++ (P1-03), the sync protocol (P1-04) and API errors (P1-05). The note body
shape arrives with the editor stage; block content, images, files, comments, templates and workspace
members are later contract growth.
