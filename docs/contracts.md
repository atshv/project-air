# Contract 0.3.0

The contract is the common language: everything two parts exchange is in
[`packages/contracts`](../packages/contracts/README.md), the JSON Schema source of truth for board
content, operations, sync protocol and API resources/errors. Version **0.3.0**; base URI
`https://project-air.dev/contracts/0.3.0/`, a placeholder until the domain is decided (Q1), changed
only with a version bump (ADR-0004). It binds `AD-1`
(operation inverses), `AD-2` (durable acks), `AD-3` (versioned schemas with fixtures), `AD-4` (one
note, many placements) and `AD-8` (translated `messageKey`). The engine includes
`generated/contract.h`; TypeScript uses `generated/types.ts` and `index.mjs`.

## Schema families and files

All 17 are JSON Schema 2020-12, closed, UUIDv7/ISO-8601, versioned `$id`.

- **Board content** (codegen input): `schemas/account.schema.json`, `schemas/workspace.schema.json`,
  `schemas/board.schema.json`, `schemas/note.schema.json`, `schemas/card.schema.json`,
  `schemas/zone.schema.json`, `schemas/block.schema.json`, `schemas/edge.schema.json`,
  `schemas/operation.schema.json` (20 types, one inverse each; ordered non-nesting `group`),
  `schemas/reorder-payload.schema.json` (the payload shared by `reorder` and its inverse) and the
  root `schemas/board-content.schema.json` (`contractVersion` const `0.3.0`).
- **Sync**: `schemas/sync/sync.schema.json` — one `oneOf` envelope, 12 message types (6
  client→server, 6 server→client) plus reconnect and session sequences.
- **REST API**: `schemas/api/workspace.schema.json`, `schemas/api/board.schema.json`,
  `schemas/api/note.schema.json`, `schemas/api/card.schema.json` — seven closed envelopes each (list,
  get, create, update, delete; `requestId`, `items`/`nextCursor`) — and
  `schemas/api/errors.schema.json` (7 UPPER_SNAKE codes, required `messageKey`
  `errors.<camelCase>`).

## Zone parent reference

Cards and blocks live in at most one zone. Both have carried an optional nullable `zoneId` since
0.1.0 (P1-01): a UUIDv7 reference to a zone of the same board, where `null` or an absent field means
board level. Zones carry no parent field at all, so **nested zones are invalid in v1**; the zone
schema rejects a `zoneId`, and the fixture corpus keeps a nested-zone specimen
(`fixtures/zone/invalid-nested.json`). The reference is additive: every 0.1.0-valid card or block
stays valid, with or without the field. 0.2.0 documents the rule and adds the containment fixtures
below.

JSON Schema validates the shape of the reference but cannot compare it with the `zones` array, so the
referential part is an executable rule next to the schemas: `fixtures/containment/` holds one valid
document (zoned and board-level cards/blocks) and one invalid document (a dangling parent), both in
the TS/C++ parity corpus, and `test/containment.test.mjs` rejects a parent that does not name a zone
of the same board. At rest the platform migration enforces the same rule with a nullable foreign key
and the board's row-level security (P4-26); the engine and UI use the field in P4-27.

## Operations (20 types, AD-1)

Every board-content change is one operation with exactly one inverse. The 19 types of 0.1.0 remain
unchanged; 0.2.0 adds `reorder`.

- **Content:** `createNote`, `updateNote`, `deleteNote`, `createCard`, `moveCard`, `resizeCard`,
  `deleteCard`, `createZone`, `moveZone`, `resizeZone`, `deleteZone`, `createBlock`, `moveBlock`,
  `resizeBlock`, `updateBlock`, `deleteBlock`, `createEdge`, `deleteEdge`.
- **`reorder` (L13, new in 0.2.0):** payload `{itemId, z}` sets the fractional-index `z` of one card,
  block or zone; the inverse `reorder` carries the same `itemId` and the previous `z`. The operation
  and its inverse share `schemas/reorder-payload.schema.json`, and both use the contract's
  fractional-index string (1–64 characters `[0-9A-Za-z]`), never a numeric z. A
  reorder only changes the order: it never creates or restores an item, so the inverse of a reorder
  whose item was deleted is rejected by the server (`NOT_FOUND`) instead of resurrecting it. `moveCard`
  and `resizeCard` stay unchanged, so no operation is duplicated.
- **`moveZone`:** payload `zoneId` names the moved zone itself (the same id in the operation and its
  inverse). 0.2.0 corrects the description that called it a parent zone; the wire shape and the
  payload required fields are unchanged because a zone is never reparented in v1.
- **`group`:** bundles ordered child operations, does not nest, and its inverse is the reversed child
  inverses.

## Fixtures

Fixture wrapper: `{ "schema", "valid", "reason", "data" }`; invalid ones name the rule; the sync,
API and gate corpora stay outside the parity count.

- `fixtures/` — 86 parity fixtures (37 valid, 49 invalid) over the ten board-content entity schemas,
  the reorder payload and the containment corpus; the operation fixtures cover all 20 types, the
  inverse pair, `group` and `reorder`, and `fixtures/reorder-payload/` covers the shared payload.
- `fixtures-sync/` — 14 valid (one per message type and the two sequence logs), 20 invalid.
- `fixtures-api/` — 35 valid (envelopes per resource plus one per error code), 20 invalid.
- `fixtures-gate/` — 2 direct Polier specimens (canonical board-content copies); the gate needs
  direct `valid/*.json` and `invalid/*.json`, enforced by a unit test.

## Codegen and parity

`packages/contracts/codegen.mjs` (Node builtins only) reads top-level `schemas/*.schema.json` and
writes `generated/types.ts` (types, enums, operation union) and `generated/contract.h` (C++
structs, enums, unions, `kContractVersion`). Output is deterministic (sorted, LF, banner, no
timestamps or paths); generated files are never hand-edited and the `codegen` gate fails on a diff.
Sync/API schemas live in subdirectories and do not change the model.

`test/parity/canonical.ts` reduces all 86 fixtures to canonical lines; `test/cpp/parity.cpp` reads
the same wrappers and includes the header; `test/parity.test.mjs` compiles it with
`-std=c++20 -Wall -Wextra -Wpedantic -Werror` and asserts equal line sets. Without a local C++
compiler it fails loudly; it never skips. The 0.2.0 model adds `ReorderPayload` to the TypeScript
interface set and the C++ operation variants.

## Versions and change procedure

SemVer; the machine-readable version lives in `board.contracts[]`.

| Change | Minimum bump |
| --- | --- |
| Documentation or fixtures only | patch |
| New optional field, operation/message type or schema file | minor |
| Removed or renamed field, new required field, changed meaning | major |

The server understands current/previous major; never rename: add, deprecate, remove after a major.

### Version history

| Version | Change |
| --- | --- |
| 0.1.0 | Initial contract: board-content model, 19 operations with inverses, sync protocol and REST API envelopes. |
| 0.2.0 | Zone parent reference documented and fixtures added (cards and blocks nullable `zoneId`, no nested zones), `reorder` operation with inverse, `moveZone` `zoneId` description corrected. Limits, visibility and error codes unchanged (ADR-0004); additive fields only. |
| 0.3.0 | Pre-realtime sync: once-per-connection version negotiation (`hello`/`welcome`), fresh-board `serverSeq` 1 / `fromServerSeq` 0 empty catch-up, `snapshotRef = <boardId>:<serverSeq>`, hello-first and reconnect ordering enforced by fixtures; 0.2.0 content/operation semantics unchanged. |

Per task: edit schemas; add valid and invalid fixtures; run codegen and commit generated files;
update every dependant in the same task (AD-3), or list a deferred one in `contract_followups` for
lead approval; bump every schema `$id`, root `contractVersion` and `board.contracts[]`; update this
document; run `board-check`, `contracts`, `codegen`, `unit` and commit evidence.

The table is the intent; the `contracts` gate is a property-level aid: it compares property names
and required paths with the base branch (added required/removed/renamed → major, added optional or
new schema file → minor, else patch), so it can under-classify (e.g. an enum-only new operation
type) or over-classify (a new definition with required fields); follow the table. A new payload with
required fields therefore lives in its own schema file (`reorder-payload.schema.json`), which the
gate classifies as a new schema file (minor). A change under `packages/contracts/` without a bump
still fails.

## board.contracts[] metadata

`board.json` → `contracts[]` has one entry for the contract: `name`
`project-air-contract`, `path` `packages/contracts`, `version` `0.2.0`, the 17 `schema_files` named
above, `fixtures_dir` `packages/contracts/fixtures-gate`, and the four `dependants`
(`packages/engine`, `packages/sdk`, `services/platform`, `services/auth`).
`python3 $POLIER/tools/contracts.py check` validates the entry, schema files, fixtures, base-branch
bump and dependant coverage. The lead owns `board.json`; a contract change bumps its
version in the same task.

## The 0.2.0 tag

The version is recorded in `board.contracts[].version`, every schema `$id` and the root
`contractVersion`. The logical contract tag is `contracts@0.2.0`, created by the owner/CI in the
remote phase (ADR-0003); git release tags stay `v<semver>` per
[docs/releasing.md](releasing.md). No tag in this stage; agents never tag or publish
(AD-10). Decision: [ADR-0005](adr/ADR-0005-contract.md).

## Open points before realtime/SDK

P1-04/P1-05 review points, settle before realtime/SDK:

1. ~~**GET request transport**~~ — resolved in P3-04/P3-05: a GET takes `?requestId=` (or the
   `x-request-id` header) and echoes a valid UUIDv7 client value; mutations carry `requestId` in the
   JSON body and echo it. Recorded in [ADR-0008](adr/ADR-0008-api-session-model.md).
2. ~~**Version negotiation**~~ — resolved in P5-01: `contractVersion` is sent once per connection in
   the `hello` payload and echoed in `welcome`; the blueprint §5.1 per-message version is replaced by
   this documented, fixture-tested alternative. The sync schema carries `contractVersion` in the `hello` payload (an optional field so 0.3.0 is a
   minor addition) and requires it on `welcome`; the session rule rejects a missing/mismatched version, and
   `client-hello-missing-contract-version.json` / `client-hello-wrong-contract-version.json` are the
   invalid fixtures (the valid `client-hello.json` and the gate specimen pin the rule).
3. ~~**`serverSeq` bootstrap**~~ — resolved in P5-01: a fresh board starts at **1**, `fromServerSeq: 0`
   names the empty catch-up (`reconnect-empty-catchup-sequence.json`), and `snapshotRef` is exactly
   `<boardId>:<serverSeq>` (schema pattern plus the reconnect cross-field rule; the mismatched
   `reconnect-mismatched-snapshot-ref.json` is invalid, `welcome.serverSeq >= 1` stays required).
4. ~~**`hello`-first rule**~~ — resolved in P5-01: the session rule requires the first client message
   to be `hello`; a fixture sequence with a client message before hello is rejected.
5. ~~**Reconnect order and `snapshotRef`**~~ — resolved in P5-01: the session rule rejects
   `resyncRequest` before `joinBoard` (`session-resync-before-join.json`), and the reconnect rule
   verifies the exact `<boardId>:<serverSeq>` snapshot reference. The 0.3.0 fixtures above are the
   enforcement; `docs/quality.md` records the gates.

## The 0.3.0 tag

0.3.0 is the pre-realtime sync contract: version negotiation once per connection (`hello`/`welcome`),
the fresh-board `serverSeq`/`fromServerSeq` rules, `snapshotRef = <boardId>:<serverSeq>`, the
`hello`-first session rule and the reconnect ordering. Contents and operation semantics of 0.2.0 are
unchanged; the version bump covers the schema `$id`s, the root `contractVersion`, `board.contracts[]`,
the fixtures and the regenerated TS/C++ codegen. The fixtures-gate corpus carries the valid
`client-hello` and the invalid missing-version specimen next to the board-content specimens.

Notes only; schema changes need the procedure above.

## 0.4.0 — note body document and content operations

The note body is a versioned, structured JSON editor document (no HTML strings):
`{ version: "1", blocks: [{ type: "paragraph" | "heading" | "list", text, marks?:
["bold" | "italic" | "code" | "link"], level?(1..6), ordered?, href? }] }`.
Links use an explicit scheme allow-list (`https:`, `http:`, `mailto:`); unknown
block types, unknown fields, a missing document version and `javascript:`/other
href schemes are rejected. Documented limits: at most 1,000 blocks, at most
10,000 characters per block text, at most 50,000 characters of derived
`plainText`. Notes gain optional `body` and `plainText` (absent = empty body);
`plainText` is the deterministic derivation used by search and must agree with
the body when present (validated by the contracts unit tests). Older 0.3.0
content without a body remains valid.

`updateNoteBody` is one operation with its inverse carrying the **previous
body**: payload `{ noteId, body }`, inverse type `updateNoteBody` with the
previous body. Fixtures cover a valid body payload (paragraph/list/heading with
marks and an https link), bad href scheme, unknown block, missing version and
oversized content, plus a valid operation with inverse and an invalid operation
with a disallowed href. The bump is 0.4.0: every schema `$id`, the root
`contractVersion`, `board.contracts[].version` and its `schema_files` list, the
new `note-body-payload.schema.json`, regenerated TypeScript and C++ codegen, and
the dependants listed in `contract_followups` (engine, sdk, services/platform,
services/auth).

**plainText derivation (semantic rule).** JSON Schema validates the body shape
only; the derived search text is defined by
`packages/contracts/plaintext.mjs#derivePlainText`: block texts are whitespace-
normalised (inner runs collapse to one space, trimmed), non-empty blocks are
joined with a newline, and list blocks are prefixed `- ` (unordered) or `1. `
(ordered). `plainTextMatches(body, plainText)` is the consistency check used by
the contracts unit test; the app derives it on save and search consumes it.
