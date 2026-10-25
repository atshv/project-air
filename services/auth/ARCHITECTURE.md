# Architecture: services/auth

**Kind:** `service` · **Created in stage:** `backend-core` (P3-01)

## Purpose

Answers who this person is. It provides registration, login (email plus password and magic link), password reset, sessions with short-lived tokens and refresh, and invitations; external identity providers, SAML and SCIM come later.

## Inputs

- Registration, login, password-reset and invitation requests typed by `packages/contracts`.
- Secrets and configuration from server-side environment only.
- Session and identity data from the self-hosted Ory Kratos instance (ADR-0007).

## Outputs

- Accounts, sessions and signed short-lived tokens with refresh.
- Invitation state and the identity evidence other services check.

## Invariants

- `AD-3` — Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task.
- `AD-5` — Authorisation is checked twice: in the API and by PostgreSQL row-level security.
- `AD-8` — User-visible text comes only from translation files with English keys.
- `AD-9` — Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates.

## Allowed imports

Exactly these workspace packages, copied from `board.json` -> `packages[]` -> `may_import`: `packages/contracts`.

## Commands

Node comes from `.nvmrc`; ESM only, strict TypeScript, tests with `node:test`. Run from the
repository root with `pnpm --filter ./services/auth <script>`.

| Script | What it runs |
| --- | --- |
| `build` | `tsc --project tsconfig.json` into `dist/` |
| `typecheck` | `tsc --noEmit --project tsconfig.json` |
| `lint` | `eslint --max-warnings=0 .` |
| `test` | `node --test test/*.test.mjs`, importing `src/*.ts` through Node type stripping |
| `start` | `node dist/index.js` |

P3-01 added the typed configuration (fail fast, no secrets in logs), the `node:http` router with
JSON envelopes and request ids, `GET /health` and `GET /health/ready`, and the `pg` pool. The Kratos
integration and the auth routes arrive in P3-03.

## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
- Identity decision: [ADR-0007](../../docs/adr/ADR-0007-auth.md)
