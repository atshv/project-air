# Contract 0.1.0

The contract is the common language: everything two parts exchange is in
[`packages/contracts`](../packages/contracts/README.md), the JSON Schema source of truth for board
content, operations, sync protocol and API resources/errors. Version **0.1.0**; base URI
`https://project-air.dev/contracts/0.1.0/`, a placeholder until the domain is decided (Q1), changed
only with a version bump (ADR-0004). It binds `AD-1`
(operation inverses), `AD-2` (durable acks), `AD-3` (versioned schemas with fixtures), `AD-4` (one
note, many placements) and `AD-8` (translated `messageKey`). The engine includes
`generated/contract.h`; TypeScript uses `generated/types.ts` and `index.mjs`.

## Schema families and files

All 16 are JSON Schema 2020-12, closed, UUIDv7/ISO-8601, versioned `$id`.

- **Board content** (codegen input): `schemas/account.schema.json`, `schemas/workspace.schema.json`,
  `schemas/board.schema.json`, `schemas/note.schema.json`, `schemas/card.schema.json`,
  `schemas/zone.schema.json`, `schemas/block.schema.json`, `schemas/edge.schema.json`,
  `schemas/operation.schema.json` (19 types, one inverse each; ordered non-nesting `group`) and the root `schemas/board-content.schema.json` (`contractVersion` const `0.1.0`).
- **Sync**: `schemas/sync/sync.schema.json` — one `oneOf` envelope, 12 message types (6
  client→server, 6 server→client) plus reconnect and session sequences.
- **REST API**: `schemas/api/workspace.schema.json`, `schemas/api/board.schema.json`,
  `schemas/api/note.schema.json`, `schemas/api/card.schema.json` — seven closed envelopes each (list,
  get, create, update, delete; `requestId`, `items`/`nextCursor`) — and
  `schemas/api/errors.schema.json` (7 UPPER_SNAKE codes, required `messageKey`
  `errors.<camelCase>`).

## Fixtures

Fixture wrapper: `{ "schema", "valid", "reason", "data" }`; invalid ones name the rule; other
corpora keep parity at 77.

- `fixtures/` — 77 parity fixtures (32 valid, 45 invalid) over the ten board-content schemas; the
  operation fixtures cover all 19 types, the inverse pair and `group`.
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

`test/parity/canonical.ts` reduces all 77 fixtures to canonical lines; `test/cpp/parity.cpp` reads
the same wrappers and includes the header; `test/parity.test.mjs` compiles it with
`-std=c++20 -Wall -Wextra -Wpedantic -Werror` and asserts equal line sets. Without a local C++
compiler it fails loudly; it never skips.

## Versions and change procedure

SemVer; the machine-readable version lives in `board.contracts[]`.

| Change | Minimum bump |
| --- | --- |
| Documentation or fixtures only | patch |
| New optional field, operation/message type or schema file | minor |
| Removed or renamed field, new required field, changed meaning | major |

The server understands current/previous major; never rename: add, deprecate, remove after a major.

Per task: edit schemas; add valid and invalid fixtures; run codegen and commit generated files;
update every dependant in the same task (AD-3), or list a deferred one in `contract_followups` for
lead approval; bump every schema `$id`, root `contractVersion` and `board.contracts[]`; update this
document; run `board-check`, `contracts`, `codegen`, `unit` and commit evidence.

The table is the intent; the `contracts` gate is a property-level aid: it compares property names
and required paths with the base branch (added required/removed/renamed → major, added optional or
new schema file → minor, else patch), so it can under-classify (e.g. an enum-only new operation
type) or over-classify (a new definition with required fields); follow the table. A change under
`packages/contracts/` without a bump still fails.

## board.contracts[] metadata

`board.json` → `contracts[]` has one entry for the contract: `name`
`project-air-contract`, `path` `packages/contracts`, `version` `0.1.0`, the 16 `schema_files` named
above, `fixtures_dir` `packages/contracts/fixtures-gate`, empty `dependants`.
`python3 $POLIER/tools/contracts.py check` validates the entry, schema files, fixtures, base-branch
bump and dependant coverage. The lead owns `board.json`; a contract change bumps its
version in the same task.

## The 0.1.0 tag

The version is recorded in `board.contracts[].version`, every schema `$id` and the root
`contractVersion`. The logical contract tag is `contracts@0.1.0`, created by the owner/CI in the
remote phase (ADR-0003); git release tags stay `v<semver>` per
[docs/releasing.md](releasing.md). No tag in this stage; agents never tag or publish
(AD-10). Decision: [ADR-0005](adr/ADR-0005-contract.md).

## Open points before realtime/SDK

P1-04/P1-05 review points, settle before realtime/SDK:

1. ~~**GET request transport**~~ — resolved in P3-04/P3-05: a GET takes `?requestId=` (or the
   `x-request-id` header) and echoes a valid UUIDv7 client value; mutations carry `requestId` in the
   JSON body and echo it. Recorded in [ADR-0008](adr/ADR-0008-api-session-model.md).
2. **Version negotiation** — `contractVersion` is set once per connection (`hello`/`welcome`);
   blueprint §5.1 wants one on every message; confirm before SDK.
3. **`serverSeq` bootstrap** — `welcome` requires ≥1 and `snapshotRef` a positive sequence while
   `fromServerSeq` allows 0; start a fresh board at 1 and add a from-0 fixture.
4. **`hello`-first rule** — docs say first, the session test does not enforce it; add the rule and a
   fixture.
5. **Reconnect order and `snapshotRef`** — wrong-order is only checked for a problem, and
   `<boardId>:<serverSeq>` is not verified; tighten both.

Notes only; schema changes need the procedure above.
