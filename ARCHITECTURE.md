# Architecture: Project air

**As of:** 2026-10-25 · **Status:** draft for owner approval · **Owner:** lead

## 1. Purpose and non-goals

A web whiteboard: people arrange and link notes, zones, blocks, images and files on a canvas,
alone or together in real time, smooth on very large boards. Value: calm design, notes as
reusable knowledge with backlinks, data in CH/EU, an AI coach that never rewrites user text.

**Non-goals (v1):** drawing tool, presentation tool, video calls, project-management suite,
native apps.

## 2. Hard constraints

- **Platform:** desktop browsers; private monorepo; TypeScript/Node.js LTS, C++20 → WebAssembly
  (engine), PostgreSQL; versions only from `docs/versions.md`.
- **Data and network:** online; realtime over WebSocket; CRDT documents for boards.
- **Legal:** GDPR and nDSG; hosting in CH/EU; licences MIT, BSD, Apache-2.0, ISC, Zlib only.
- **Secrets:** server-side environment only; never in the repo, client bundle or logs.
- **Language:** code and agent files English; UI text from translation files, German first.
- **Planning tool:** Polier `v1.3.0`, outside the repo, version pinned on the board; rules in `policy.json`, loop in `docs/orchestration.md`.

## 3. System shape and module structure

Profile L: packages, services, apps, tools and infra, integrated through versioned contracts.
Package map, kinds and allowed imports: `docs/module-map.md`; layout rules:
`docs/monorepo-layout.md`.

| Kind | Role | May import |
| --- | --- | --- |
| `package` | shared library (contracts, engine, crdt, ui-kit, editor, sdk, test-kit) | contracts, generated tokens |
| `service` | deployable backend (platform, auth, sync, media, ai, worker) | contracts (+ crdt for sync) |
| `app` | deployable UI (web, engine playground) | packages only, never services |
| `tool` | build and check helpers | contracts |
| `infra` | containers, migrations, environments | – |

**Rule:** apps import packages, services import contracts; services talk only over HTTP or
messages; no cycles. Inside a TypeScript package: UI → logic → data.

## 4. Invariants (AD-1 … AD-10)

| ID | Rule | Binds | Prevents |
| --- | --- | --- | --- |
| AD-1 | Every change to board content is one operation from `packages/contracts` with its inverse; one gesture = one operation. | engine, crdt, sync, web | lost undo, double writes |
| AD-2 | The server is the source of truth; the engine holds a working copy and never talks to the network. | engine, sdk, sync | hidden state, unsynced edits |
| AD-3 | Cross-package interfaces are JSON Schema contracts with fixtures and SemVer; a change updates every dependant in the same task. | all packages | silent breakage |
| AD-4 | A note exists once; a card is only its placement on a board. | contracts, platform, web | diverging copies |
| AD-5 | Authorisation is checked twice: in the API and by PostgreSQL row-level security. | platform, auth, migrations | cross-tenant reads |
| AD-6 | AI runs server-side only; every answer is schema-validated; budget is reserved before each call; the coach never writes user text. | ai, web | ghostwriting, cost overrun |
| AD-7 | Visual values come only from `packages/ui-kit/tokens.json` (CSS and C++ generated). | ui-kit, engine, web | inconsistent design |
| AD-8 | User-visible text comes only from translation files with English keys. | web, auth, ai | untranslatable code |
| AD-9 | Ports, databases and buckets come only from `.polier-slot`; shared resources run through exclusive gates. | tools, tests, services | colliding test runs |
| AD-10 | Releases are built by CI from tags of a clean `main`; agents never publish. | CI, release tools | unreviewed work going live |

## 5. Boundaries and ownership

| Area | Belongs to | Write | Read |
| --- | --- | --- | --- |
| root files, `board.json`, `tasks/` | lead | lead | all |
| packages, services, apps, tools | one worker per task | task scope | all |
| `reviews/` | reviewer | reviewer; evidence by tasks | all |
| `docs/owner/` | owner | owner | lead |

## 6. Quality gates

- **Board and docs:** `python3 $POLIER/tools/check.py .` → exit 0.
- **Boundaries:** `python3 $POLIER/tools/boundaries.py .` → exit 0.
- **Contracts:** `python3 $POLIER/tools/contracts.py check` → exit 0.
- **Per package:** lint, typecheck, unit (commands in `docs/module-map.md`).
- **Design, language, e2e, perf, visual:** see `docs/quality.md`; shared resources exclusive.
- **Release:** `python3 $POLIER/tools/release_check.py .` on a tag of `main`.
- **Review:** independent; diff, acceptance and gate records only.

## 7. Open / deliberately undecided

- Name, hosting, CRDT, auth, reference hardware, i18n library, import formats, pricing:
  `open_questions` on the board, decided before the stage that needs them.

## 8. References

- Package map: `docs/module-map.md` · layout: `docs/monorepo-layout.md`
- Quality, definition of done: `docs/quality.md`
- Design: `docs/design-rules.md` · owner blueprint (German): `docs/owner/`
- Decisions: `docs/adr/`
