# ADR-0008: API and session model of the platform

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** –

## Context

`services/platform` now serves the first durable product data: workspaces, boards, notes and cards
(P3-04). The contract `0.1.0` fixes the JSON shapes but leaves the transport questions open: how
requests are versioned, how a request is correlated with its response, how lists are paginated, how
a session reaches the platform, and how the second line of defence (PostgreSQL row-level security,
AD-5) is wired. `packages/sdk` and the stage acceptance depend on these answers (P3-05), and the
web app will call them next. The product runs in CH/EU with permissive licences only and a
German-first UI; authorization stays in the platform, never in the identity service (ADR-0007).

## Decision

**One versioned REST API under `/v1`, JSON envelopes, cookie-based Kratos sessions validated by
`services/auth`, and every request in an `app_user` transaction with `SET LOCAL app.account_id`.**

- **Versioning:** all routes live under `/v1`; a breaking contract change starts a new major and,
  if needed, `/v2`. The contract SemVer stays the source of truth (ADR-0005); `/v1` never changes
  shape silently.
- **Envelopes:** list `{requestId, items, nextCursor}`, single `{requestId, <resource>}`, delete
  `{requestId, deletedId}`, error `{requestId, code, messageKey, details?}`. The seven error codes
  are `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `RATE_LIMITED`,
  `INTERNAL`; `messageKey` is a translation key (`errors.<camelCase>`), never human prose;
  `details.fields` carries dotted field paths only. Error text and stack traces never leave the
  service.
- **Request ids:** every response carries a UUIDv7 `requestId`; mutations carry it in the JSON body
  and echo it, GETs take it as `?requestId=` (or the `x-request-id` header) and echo the client
  value when it is a valid UUIDv7. This settles the P1-04 open point "GET request transport"
  (queried in P3-04, recorded here).
- **Pagination:** cursor over `(created_at, id)`, encoded as opaque base64url with microsecond
  timestamps; `limit` 1–100, default 50, `nextCursor: null` on the last page. No offsets: rows
  inserted between pages must not shift a page boundary.
- **Permissions:** reads are for every workspace member (`owner`, `editor`, `reader`); writes
  (boards, notes, cards, workspace update) are for owner/editor; only the owner deletes the
  workspace. A non-member always receives `NOT_FOUND`, never `FORBIDDEN` (no existence leak);
  a member with the wrong role receives `FORBIDDEN`. The API checks this explicitly and PostgreSQL
  RLS enforces it again (AD-5).
- **Session flow:** the browser holds a Kratos session cookie; `services/auth` validates it and
  returns the account (`GET /session`). The platform forwards `cookie`/`x-test-session` to
  `services/auth`, trusts no client-sent account id, and opens one transaction per request on the
  `app_user` connection with `SELECT set_config('app.account_id', $1, true)`; the API-level check
  runs first, RLS is the second line. The API starts only when the `APP_DATABASE_URL` role is
  neither superuser nor `BYPASSRLS` (startup guard).
- **Test mode:** `AUTH_TEST_MODE=1` (refused when `NODE_ENV=production`) adds `POST /test/session`
  minting a signed `x-test-session` for a given account id. Only development/test and the
  `api-tests`, `rls-tests` and acceptance scripts use it; production never enables it.
- **Limits of this stage:** no member-management routes yet (memberships are DB fixtures in tests),
  no rate limiting, no `/v1` SDK codegen from OpenAPI (the SDK is hand-written against the generated
  contract types), and the identity-id mapping is deliberately deferred.

## Consequences

- **Positive:** one consistent envelope and error model for the SDK, the web app and the sync
  service; request ids make every client error traceable to one server log line; cookie sessions
  need no token storage in the frontend and rotate with Kratos; the `app_user` transaction plus RLS
  means a forgotten API check cannot leak another workspace; test mode keeps integration tests fast
  and hermetic.
- **Negative:** every request pays one auth call, one transaction and one `SET LOCAL`; cookie
  sessions make CSRF handling mandatory for cross-site deployments; the AD-5 duplication (explicit
  checks plus RLS) must stay in sync as routes are added; `/v1` needs a deprecation process.
- **Binds:** `services/platform` routes and middleware, `packages/sdk`, `apps/web`, the future sync
  service, the gate suite (`api-tests`, `rls-tests`), `docs/contracts.md`.
- **Prevents:** unversioned/path-style APIs, JWT-in-localStorage session handling, offset pagination
  for mutable lists, returning `FORBIDDEN` for foreign resources, trusting `account_id` from a
  client, running the API as a superuser role, and enabling test mode in production.
- **Open:** Kratos identity ids are UUIDv4 while contract entities carry UUIDv7 account ids; P3-06
  adds the account-mapping migration and updates this ADR. New member-management routes will extend
  the permission matrix, not change it.

## Alternatives

- **Session cookies vs JWT:** JWT would make the platform stateless but needs token storage,
  rotation and revocation, and duplicates what Kratos already does (rotating, revocable sessions).
  Cookies keep one source of truth and work with `<img>`/navigation flows; CSRF is handled at the
  web edge.
- **`/v1` vs unversioned API:** unversioned paths would force lockstep deploys of web, SDK and
  server; versioning is cheap now and lets a breaking change ship side by side.
- **RLS vs app-only checks:** app-only checks are easy to forget in new queries (the P3-04 review
  found exactly that for single GETs); RLS alone hides bugs but hides them from the API tests.
  Both, explicitly, are cheaper to keep than a data leak is to explain.
