# ADR-0007: Self-hosted Ory Kratos for authentication

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** –

## Context

The product needs accounts, e-mail + password login, magic links, password recovery, sessions
(short-lived, rotating), invitations, and later federation (external IdPs, SAML/SCIM). The
architecture requires permissive licences only (MIT, BSD, Apache-2.0, ISC, Zlib), hosting in
CH/EU, PostgreSQL, German-first UI from translation files (AD-8) and a calm custom design.
Authorization (workspaces, roles, row-level security) stays in the platform, checked twice
(API + PostgreSQL RLS, AD-5). The owner decided against paid plans and against a heavyweight
JVM/IdP footprint; the auth choice must stay free to operate and small.

## Decision

**We self-host Ory Kratos (Apache-2.0, Go) as the identity service and build the auth UI
ourselves.** Kratos runs as one container next to the Node services in the local Compose stack
and in production, with its own database/schema in the existing PostgreSQL cluster. It owns
identities, credentials, magic links, verification/recovery, passkeys/MFA and sessions; our
`services/auth` wraps its admin/session APIs and renders the auth screens from our message files
and design system. We use the **community edition only** — no Ory Network, no paid features.
**Ory Hydra (Apache-2.0)** is added later, and only when external clients or the SDK need a real
OIDC/OAuth2 provider; Kratos is not one. Workspace membership and permissions never move into the
identity service; they stay in `services/platform` and PostgreSQL RLS.

## Consequences

- **Positive:** no licence or subscription cost; small Go footprint (~100–300 MB) instead of a
  2 GB JVM (Keycloak) or a Python multi-container stack (authentik); PostgreSQL fits the existing
  stack; the headless model gives us the German-first, design-system auth screens; no vendor
  lock-in and no cloud dependency; permissive licence only.
- **Negative:** we implement and maintain the auth UI and the Kratos integration ourselves; Kratos
  versions, config, courier/SMTP and UI flows need operational discipline; a security review of the
  auth path stays mandatory before v1; short-lived-token/rotation behaviour must be mapped onto
  Kratos sessions (implementation detail of P3 auth task).
- **Binds:** `services/auth`, the Compose stack, the platform session middleware, the web auth
  screens, `docs/versions.md` (pin Kratos), future OIDC clients (Hydra decision).
- **Prevents:** paid auth SaaS, a heavyweight IdP we cannot operate cheaply, private data leaving
  CH/EU, and two competing sources of truth for workspaces/permissions.

## Alternatives

- **Keycloak (Apache-2.0)** — most complete (OIDC/SAML/SCIM, German UI), but a 750 MB–2 GB JVM and
  theme compromises for our design; rejected for cost/footprint at this stage.
- **authentik (MIT core)** — strong admin UI/flows, but Python/Django + worker + Redis and
  enterprise-licensed features; more operational weight than needed for v1.
- **SuperTokens (Apache-2.0 core)** — excellent session flows and a Node SDK, but a Java core and
  no full IdP/OIDC-provider path; would still need an OIDC layer later.
- **GoTrue / Supabase Auth (MIT)** — small and PostgreSQL-friendly, but thin on IdP features
  (SAML/SCIM) and pulls us toward the Supabase model.
- **Build authentication completely ourselves** (the blueprint's original proposal) — fewest
  services, but the largest security surface to own for password, session and recovery flows.
- **Zitadel, Logto, Hanko, Kanidm** — rejected by the licence constraint (AGPL-3.0 / MPL-2.0).
