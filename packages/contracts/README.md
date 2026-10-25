# packages/contracts

The common language of Project air: the board-content data model and its operations as JSON Schema
2020-12, version `0.1.0`, with valid and invalid fixtures for every schema, generated TypeScript and
C++ types, and a fixture parity harness that proves both sides read the same contract.

- **Kind:** `package`
- **Created in stage:** `contract`
- **Root architecture:** [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Package map:** [docs/module-map.md](../../docs/module-map.md)
- **Contract version:** `0.1.0`

Every schema `$id` is `https://project-air.dev/contracts/0.1.0/<entity>.schema.json`. The base URI
is the versioned contract namespace; it is not fetched by any tool.

## Schema map

| File | Entity | Key fields | Rules |
| --- | --- | --- | --- |
| `schemas/account.schema.json` | Account | `id`, `email`, `displayName`, `locale`, timestamps | UUIDv7 ids, `locale` enum `de`/`en` |
| `schemas/workspace.schema.json` | Workspace | `id`, `name`, `ownerId`, timestamps | owned by one account |
| `schemas/board.schema.json` | Board | `id`, `workspaceId`, `ownerId`, `title`, `visibility`, `archived`, timestamps | `visibility` enum |
| `schemas/note.schema.json` | Note | `id`, `workspaceId`, `title`, timestamps | a note exists once (AD-4); the body arrives with the editor stage |
| `schemas/card.schema.json` | Note card (placement) | `id`, `boardId`, `noteId`, `zoneId`, geometry, `z`, timestamps | references the note, never embeds it; minimum 176×80 |
| `schemas/zone.schema.json` | Zone | `id`, `boardId`, `title`, geometry, `z`, timestamps | minimum 256×192; zones are never nested in v1 |
| `schemas/block.schema.json` | Block | `id`, `boardId`, `zoneId`, `type`, geometry, `z`, timestamps | `type` enum; minimum size per type |
| `schemas/edge.schema.json` | Edge | `id`, `boardId`, `from`, `to`, timestamps | endpoints are cards only |
| `schemas/operation.schema.json` | Operation | `id`, `boardId`, `actorId`, `createdAt`, `type`, `payload`, `inverse` | 19 operation types, exactly one inverse, ordered non-nesting `group` |
| `schemas/board-content.schema.json` | Root document | `contractVersion`, `board`, `notes`, `zones`, `cards`, `blocks`, `edges` | `$ref`s to every entity; `contractVersion` const `0.1.0` |

Minimum sizes (width × height): note card 176×80, checklist 224×128, palette 224×128, columns
368×192, timeline 320×160, table 288×160, zone 256×192. `z` is a fractional-index string, `x`/`y`
are world pixels, ids are UUIDv7 and timestamps are ISO-8601 with timezone.

## Generated files (committed, never edit by hand)

`node codegen.mjs` (Node builtins only) reads `schemas/` and writes two committed files. Ordering is
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

The unit suite runs a two-sided harness over **every** fixture (77: 32 valid, 45 invalid):

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

Without an install, `node --test packages/contracts/test/*.test.mjs` runs the same suite. The
package has no dependencies; the tests use Node builtins and the local C++ compiler only.

## Fixtures

`fixtures/<entity>/` holds one file per case in the wrapper
`{ "schema": "schemas/card.schema.json", "valid": true, "reason": "…", "data": { … } }`. Every
schema has at least one valid and one invalid fixture; an invalid fixture names the violated rule.
The operation fixtures cover all 19 operation types plus inverse and group edge cases.

## Not in 0.1.0

The sync protocol (P1-04) and API errors (P1-05); runtime validation and CMake/Emscripten packaging
belong to the engine stage. Block content, images, files, comments, templates and workspace members
are later contract growth.
