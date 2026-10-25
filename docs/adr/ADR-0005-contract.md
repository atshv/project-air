# ADR-0005: Contract and versions

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** –

## Context

Project air is split into an engine (C++20 → WebAssembly), TypeScript backend services, a web app,
shared packages and tools. All of them exchange the same board content, operations, sync messages and
REST resources/errors, so two independent type systems and a C++ header must agree on every field.
The contract changes often in these early stages, while the engine, backend and web are built next;
hand-written types per side would drift silently until a runtime failure. The contract therefore
needs one source of truth, a mechanical proof that both languages read it identically, and rules
that keep every change compatible and versioned.

## Decision

We make JSON Schema 2020-12 under `packages/contracts` the single source of truth for contract
`0.1.0`: the board-content model, its operations with exactly one inverse, the WebSocket sync
protocol and the REST API resource/error envelopes. Every schema carries valid and invalid fixtures;
`codegen.mjs` deterministically generates `generated/types.ts` and `generated/contract.h`, and a
two-sided parity harness proves TypeScript and C++ read all 77 parity fixtures identically. Changes
follow SemVer rules — patch for documentation or fixtures only, minor for a new optional field,
operation, message type or schema file, major for a removed or renamed field, a new required field
or changed meaning — and are recorded in the machine-readable `board.contracts[]` entry checked by
the `contracts` gate. The logical contract tag is `contracts@0.1.0`, created by the owner/CI in the
remote phase (ADR-0003); git release tags on `main` stay `v<semver>` per
[docs/releasing.md](../releasing.md), and no tag is created in this stage (ADR-0002).

## Consequences

- **Positive:** one reviewable source for engine, backend, web and SDK; the parity harness catches
  TypeScript/C++ drift mechanically; fixtures make the interface executable before any service
  exists; the version rules and the gate stop unversioned contract changes; dependants are
  machine-readable.
- **Negative:** a schema change needs codegen and regenerated files in the diff, fixture work on both
  sides and a local C++ compiler for the parity harness; even a convenient client-side change must
  pass the SemVer gate; the full bump rules already apply before 1.0.
- **Binds:** `packages/contracts/` (schemas, fixtures, codegen, generated files, `index.mjs`),
  `board.contracts[]`, `docs/contracts.md`, and every consumer — engine, platform, sync, web, SDK —
  with their tests.
- **Prevents:** divergent hand-written types, silent TS/C++ drift, unversioned or undocumented
  contract changes, and agents tagging a release locally.

## Alternatives

- **Hand-written types per side** — rejected: drift would surface only at runtime or in review, at
  the most expensive boundary between engine and backend.
- **Protobuf or OpenAPI as the source** — rejected: Protobuf adds a compiler and binary schemas that
  do not describe the JSON fixtures and board-content shape; OpenAPI targets HTTP resources, not the
  C++ data model or the WebSocket messages; both introduce a second schema language and dependency.
- **JSON Schema without fixtures** — rejected: nothing would prove that both readers agree; the
  valid and invalid fixtures are the executable specification.
- **Annotated git tag `v0.1.0` now** — deferred, not rejected: the remote phase and the owner's
  release flow do not exist yet (ADR-0002, ADR-0003), and agents never tag or publish (AD-10).
