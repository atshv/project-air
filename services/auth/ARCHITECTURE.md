# Architecture: services/auth

**Kind:** `service` · **Created in stage:** `later`

## Purpose

Answers who this person is. It provides registration, login (email plus password and magic link), password reset, sessions with short-lived tokens and refresh, and invitations; external identity providers, SAML and SCIM come later.

## Inputs

- Registration, login, password-reset and invitation requests typed by `packages/contracts`.
- Secrets and configuration from server-side environment only.

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

Install, build, lint, typecheck and test: **set by P0-04**, the workspace task. This package defines no command before the workspace exists; the task that adds code expands this section.


## References

- Root architecture and the `AD-1` … `AD-10` table: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Package map: [docs/module-map.md](../../docs/module-map.md)
