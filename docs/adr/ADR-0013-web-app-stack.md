# ADR-0013: Web app stack — React + Vite SPA with an own editor

**Date:** 2026-10-29 · **Status:** accepted · **Supersedes:** –

## Context

Stage 7 builds the product UI in `apps/web` on top of the SDK, engine and sync service. The owner
blueprint proposes "React with a server-rendering framework" and leaves the concrete libraries to
the stage, subject to owner approval and the licence rule (MIT/BSD/Apache-2.0/ISC/Zlib only). The
owner rejected the rich-text editor proposal (TipTap and similar) because those libraries carry paid
tiers and would make the product depend on a vendor's commercial offering. The editor needs are
modest at this stage: a note panel with focus/placeholder (L06), a title field (L09) and structured
content that is one contract operation per change (AD-1); richer text features can grow later.

## Decision

- **React 19 + Vite + TypeScript SPA** in `apps/web`, with React Router for navigation. The app is
  client-rendered; the blueprint's SSR proposal is deferred (no server-rendering framework, no
  Node SSR runtime) until a marketing/SEO need justifies it.
- **Own editor** in `packages/editor`: contenteditable + Selection/Range APIs, structured content
  stored as contract-shaped JSON and plain text derived for search; no rich-text library, no paid
  tier, no vendor account.
- **Playwright (Apache-2.0)** for the `e2e` gate (free, no paid tier) or, if the stage decides
  otherwise, an own CDP harness under the same gate contract.
- Every dependency is pinned exactly with licence, source and date in `docs/versions.md`; no
  dependency with a paid tier, cloud lock-in or copyleft licence enters the product.

## Consequences

- Fewer moving parts and no vendor dependency: React/Vite are MIT, Playwright Apache-2.0, the editor
  is ours.
- All rendering is client-side; auth cookies are handled through the `services/auth` proxy so the
  SPA never stores tokens; SSR can be revisited in v1 without changing the API surface.
- The editor starts deliberately small (text, links, structured JSON) and its feature growth is a
  later task; the note/card model stays contract-first (AD-1, AD-4).
- Bundle size is budgeted in the web-app stage; the engine WASM and Yjs are the heavy parts, not the
  framework.

## Alternatives

- **Next.js/SSR per blueprint** — a second server runtime, cookie/streaming complexity and slower
  agent iteration for a canvas product whose pages are authenticated app views.
- **TipTap/ProseMirror-style editor with paid tiers** — rejected by the owner; the editor stays our
  own code.
- **Vanilla TS without a framework** — viable, but the board/panel/state surface is large enough
  that React's component model reduces coordination cost for agents and reviewers.

## References

- Blueprint section 2 (stack table) and 21 (canvas work orders) · board Q4/ADR-0011 (Yjs),
  ADR-0012 (SDK client document) · `docs/design-rules.md`.
