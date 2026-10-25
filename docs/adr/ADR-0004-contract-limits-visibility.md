# ADR-0004: Contract v1 text limits and board visibility

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** –

## Context

P1-01 introduced provisional text-length bounds and a board visibility enum in contract `0.1.0`.
The owner confirmed the values and the sharing rule on 2026-10-25, before codegen and the server
build on them.

## Decision

**Text limits** (Unicode code points, enforced by schema, server and UI):

| Field | Maximum |
| --- | --- |
| E-mail | 320 |
| Display name | 80 |
| Workspace name | 120 |
| Board title, zone title | 200 |
| Note title | 300 |

**Board visibility:** `private` (owner and explicitly invited people only), `workspace` (all
members of the workspace), `link` (read-only access through a revocable token; never public edit
access, no search-engine indexing). Additional share/edit token kinds belong to a later sharing
stage.

**Contract base URI:** `https://project-air.dev/contracts/0.1.0/` stays a placeholder until the
project domain is decided (Q1); the `$id` namespace changes only with a contract version bump.

## Consequences

- **Positive:** one enforceable set of bounds; sharing is safe by default (link = read-only,
  revocable); no public-write surface in v1.
- **Negative:** texts longer than the limits are rejected rather than truncated; the link token
  needs a revocation story in the backend stage.
- **Binds:** contract schemas and fixtures, the platform API validation, the editor/web forms, the
  sharing UI (web-app stage), P1-06 documentation and `board.contracts[]`.
- **Prevents:** silently diverging limits between client and server, and public writable links.

## Alternatives

- **No length limits** — rejected: layout, storage and abuse risks.
- **Only `private`/`workspace`** — deferred at the owner's request; remaining in the enum with the
  read-only token rule is cheaper than a schema change later.
- **Public editable links** — rejected: privacy and authorisation risk (AD-5).
