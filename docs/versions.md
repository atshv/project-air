# Versions: Project air

Every dependency in every manifest appears here. `[UNVERIFIED]` and `[VERIFY: …]` never belong in
a release. P0-04 added the workspace rows from the root manifest and lockfile; P0-09 added the
GitHub Actions rows from `.github/workflows/ci.yml`; P2-01 added the C++ engine toolchain rows from
the Homebrew formulae; P2-04 added the Chrome for Testing row used by the local performance
baseline; P3-01 added the backend rows (`pg`, `@types/pg`, `@types/node`) and the Ory Kratos image; P6-01 added the ADR-0013 web-app rows (React 19, React Router, Vite and their types); P6-10 added the Playwright runner and its Chromium browser build.

| Tool / library | Exact version | Source URL | Date checked | Approved by |
| --- | --- | --- | --- | --- |
| Polier | `2.6.0` | https://github.com/atshv/Polier/releases/tag/v2.6.0 (tag on `bbde7d4`) | 2026-10-30 | owner (2026-10-30, update request) |
| C++ compiler (local/CI) | Apple clang `21.0.0` (also accepts g++) | https://developer.apple.com/xcode/ — Apple clang licence (toolchain) | 2026-10-25 | lead (P1-03) |
| GitHub Action `actions/checkout` | `v7.0.1@3d3c42e5aac5ba805825da76410c181273ba90b1` | https://github.com/actions/checkout/releases/tag/v7.0.1 — MIT | 2026-10-25 | owner (2026-10-25) |
| GitHub Action `actions/setup-node` | `v7.1.0@949feb2413d6458794dcd2491c4babbbce0c15c1` | https://github.com/actions/setup-node/releases/tag/v7.1.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| GitHub Action `pnpm/action-setup` | `v6.1.0@ea17c68df8912ef543352723c149a84f56e3d413` | https://github.com/pnpm/action-setup/releases/tag/v6.1.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| pnpm (package manager) | `12.14.0` | https://www.npmjs.com/package/pnpm/v/12.14.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| Node.js LTS (Krypton) | `24.22.1` | https://nodejs.org/dist/index.json — v24.22.1, 2026-10-20, MIT | 2026-10-25 | owner (2026-10-25) |
| Turborepo (`turbo`) | `2.11.10` | https://www.npmjs.com/package/turbo/v/2.11.10 — MIT | 2026-10-25 | owner (2026-10-25) |
| Yjs (`yjs`, CRDT for `packages/crdt`) | `13.6.27` | https://www.npmjs.com/package/yjs/v/13.6.27 — MIT, https://github.com/yjs/yjs (tag 13.6.27); Q4-approved dependency | 2026-10-28 | owner (Q4, 2026-10-28) |
| TypeScript (`typescript`) | `5.9.3` | https://www.npmjs.com/package/typescript/v/5.9.3 — Apache-2.0 | 2026-10-25 | owner (2026-10-25) |
| `react` (web app runtime, ADR-0013) | `19.3.1` | https://www.npmjs.com/package/react/v/19.3.1 — MIT | 2026-10-29 | owner (ADR-0013, 2026-10-29) |
| `react-dom` (web app runtime, ADR-0013) | `19.3.1` | https://www.npmjs.com/package/react-dom/v/19.3.1 — MIT | 2026-10-29 | owner (ADR-0013, 2026-10-29) |
| `react-router` (web app router, ADR-0013) | `8.5.1` | https://www.npmjs.com/package/react-router/v/8.5.1 — MIT | 2026-10-29 | owner (ADR-0013, 2026-10-29) |
| `vite` (web app build/dev server, ADR-0013) | `8.3.5` | https://www.npmjs.com/package/vite/v/8.3.5 — MIT | 2026-10-29 | owner (ADR-0013, 2026-10-29) |
| `@vitejs/plugin-react` (web app Vite plugin, ADR-0013) | `6.1.2` | https://www.npmjs.com/package/@vitejs/plugin-react/v/6.1.2 — MIT | 2026-10-29 | owner (ADR-0013, 2026-10-29) |
| `@types/react` (dev, web app, ADR-0013) | `19.3.0` | https://www.npmjs.com/package/@types/react/v/19.3.0 — MIT | 2026-10-29 | owner (ADR-0013, 2026-10-29) |
| `@types/react-dom` (dev, web app, ADR-0013) | `19.3.0` | https://www.npmjs.com/package/@types/react-dom/v/19.3.0 — MIT | 2026-10-29 | owner (ADR-0013, 2026-10-29) |
| ESLint (`eslint`) | `10.13.0` | https://www.npmjs.com/package/eslint/v/10.13.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| typescript-eslint | `8.72.0` | https://www.npmjs.com/package/typescript-eslint/v/8.72.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| Docker Desktop (local runtime) | `4.96.3` (Engine `29.9.2`, Compose `5.6.1`) | https://www.docker.com/products/docker-desktop/ — proprietary Docker Desktop licence (local development tool, owner decision) | 2026-10-25 | owner (2026-10-25) |
| PostgreSQL (official image, local compose) | `17.11-alpine3.23@sha256:01ea903aa65deb58eb49d6e09d859ecff63a6bb7d61feca55f2abad71d08f72a` | https://hub.docker.com/_/postgres — PostgreSQL Licence (OSI permissive; blueprint-mandated server) | 2026-10-25 | lead (P0-07) |
| PostgreSQL client (`pg`, backend runtime) | `8.23.1` | https://www.npmjs.com/package/pg/v/8.23.1 — MIT | 2026-10-25 | owner (2026-10-25) |
| `@types/pg` (dev, backend) | `8.23.1` | https://www.npmjs.com/package/@types/pg/v/8.23.1 — MIT | 2026-10-25 | owner (2026-10-25) |
| `@types/node` (dev, backend and web e2e) | `24.19.2` | https://www.npmjs.com/package/@types/node/v/24.19.2 — MIT | 2026-10-25 | lead (P3-01, type declarations for the Node builtins; P6-10 uses it for the e2e config/state helpers) |
| `@playwright/test` (web app e2e runner, dev) | `1.64.1` | https://www.npmjs.com/package/@playwright/test/v/1.64.1 — Apache-2.0 | 2026-10-29 | owner (P6-10) |
| Chromium (Playwright e2e browser) | Playwright build `1248` (Chrome `156.0.8078.4`) | https://github.com/microsoft/playwright/releases/tag/v1.64.1 (browsers.json) — Chromium, BSD-3-Clause; local cache only, not in the repository, never shipped | 2026-10-29 | owner (P6-10) |
| Ory Kratos (identity service, local compose) | `v26.2.0@sha256:2a13bb8d362c7a7ae33bd7c0f5168aee46921f15c916a06346db91c06dc76643` | https://github.com/ory/kratos/releases/tag/v26.2.0 — Apache-2.0 | 2026-10-25 | owner (2026-10-25) |
| SeaweedFS (S3, local compose) | `4.50@sha256:c2658820e763294a9e9de7b36c81e59b879e3459148351aee4e31a126ca64860` | https://github.com/seaweedfs/seaweedfs — Apache-2.0 | 2026-10-25 | lead (P0-07) |
| Mailpit (mail catcher, local compose) | `v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498` | https://github.com/axllent/mailpit — MIT | 2026-10-25 | lead (P0-07) |
| CMake (C++ engine build) | `4.4.4` | https://formulae.brew.sh/formula/cmake — BSD-3-Clause | 2026-10-25 | owner (2026-10-25) |
| Emscripten (C++ → WebAssembly) | `6.0.13` | https://formulae.brew.sh/formula/emscripten — Apache-2.0, Apache-2.0 with LLVM exception, MIT or NCSA | 2026-10-25 | owner (2026-10-25) |
| Chrome for Testing (local perf baseline) | `156.0.8078.4` | https://googlechromelabs.github.io/chrome-for-testing/ — proprietary Chrome for Testing licence (local measurement tool, owner decision; not bundled, not a shipped dependency) | 2026-10-25 | owner (2026-10-25) |

The workspace rows pin pnpm in `packageManager`, Turborepo, TypeScript, ESLint and
typescript-eslint in the root `devDependencies`, and Node in `.nvmrc` (`24.22.1`), which
`engines.node` accepts as `>=24.22.1`. The container images are pinned in
`infra/compose/compose.yaml`. The PostgreSQL server is mandated by the blueprint (section 2); its
PostgreSQL Licence (OSI-approved, permissive) is a recorded exception to the licence list below,
alongside the two local-tool exceptions: Docker Desktop and the Chrome for Testing binary used by
the local performance baseline (owner-approved, local only, never shipped).

The web-app e2e runner (P6-10) is `@playwright/test` `1.64.1` (Apache-2.0, pinned in
`apps/web/package.json` and the lockfile, dev-only, never shipped). Its Chromium build `1248`
(Chrome `156.0.8078.4`) is installed by `pnpm --filter ./apps/web exec playwright install chromium`
into the user-level Playwright cache and is not part of the repository, the bundle or CI artifacts.

Backend rows (P3-01): `pg` is the only runtime dependency of `services/platform` and
`services/auth`, pinned in their manifests and the lockfile; `@types/pg` is its type declaration
package and `@types/node` supplies the Node built-in declarations that TypeScript needs to type
`node:http`, `node:crypto`, `node:fs` and `process` (`@types/pg` also declares `@types/node`). Both
type packages are development-only and never reach a bundle. The Ory Kratos image is pinned by tag
and digest, like the other local service images; it sits behind the `identity` Compose profile until
P3-03 configures it, and its local database `projectair_kratos` is shared by every slot (a
local-development limitation, tests never depend on it).

The engine toolchain is installed with `brew install cmake emscripten` (owner-approved 2026-10-25,
no paid tier) and verified with `cmake --version` (`4.4.4`) and `emcc --version` (`6.0.13-git`). The
Emscripten wrappers `emcc`, `em++` and `emcmake` are Homebrew binaries in `/opt/homebrew/bin`. The
`wasm-build` gate runs `packages/engine/tools/build-wasm.sh`, which prepends Homebrew's Emscripten
and brew bin to `PATH` (the launchers must find Python 3.15, not the macOS system Python 3.9) and
trusts `emcc`/`emcmake` on `PATH` when no Homebrew is present
([docs/gates/wasm-emscripten.md](gates/wasm-emscripten.md)); `packages/engine/CMakeLists.txt`
requires CMake 4.4 and C++20. CI pins its own Emscripten install in the remote stage; the local
phase uses the Homebrew formulae above.

All tools in this table are open source without a required paid tier: pnpm, Turborepo, TypeScript,
ESLint, typescript-eslint and Node.js are MIT or Apache-2.0. Turborepo's optional hosted remote
cache (Vercel) is a paid service on larger plans and is not used; the local Turbo cache is enough
for the local phase.

Local gate only, not a workflow dependency: the `rhysd/actionlint` Docker image at tag `latest`
(actionlint `1.7.12`, digest
`sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667`) checks
`.github/workflows/ci.yml` locally (`ci-local` gate); the CI workflow does not pull it.

Chrome for Testing is a **local measurement tool only**: the `perf-baseline` gate launches it with
a real GPU (ANGLE/Metal) to measure the engine; the browser is not added to any manifest or
lockfile, is not bundled with the product and is not part of the CI workflow. The baseline was run
with the measurement machine's Node `v26.12.1` while the repository pins Node `24.22.1`; the
deviation is recorded in [docs/engine/perf-baseline.md](engine/perf-baseline.md) and re-running the
harness under the pinned Node is part of the reference-hardware measurement. The binary used on the
measurement machine lives outside the repository at
`~/Library/Caches/ms-playwright/chromium-1248/...`; re-install it from the Chrome for Testing
releases and record the exact version again when it changes. The owner chose Chrome as the
reference browser (2026-10-25); its proprietary licence is a second recorded local-tool exception,
like Docker Desktop, and never applies to code shipped from this repository.

## Rules

1. Every dependency from `package.json`, lockfiles, `CMakeLists.txt` and CI workflows appears here,
   including dev dependencies, browsers and build tools.
2. Versions are exact and come from the manifest or lockfile, or from upstream release notes with a
   URL. Record the date and who checked it.
3. A version change updates the manifest, the lockfile and this table in the same task. No silent
   upgrades, no `latest`.
4. Licences: MIT, BSD, Apache-2.0, ISC or Zlib only; note the licence in the source URL column if
   it is not obvious. Owner-approved local-tool exceptions are listed in the licence note above
   (blueprint-mandated PostgreSQL, Docker Desktop, Chrome for Testing); they are never shipped and
   never appear in the product bundle.
