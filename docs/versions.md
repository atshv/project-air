# Versions: Project air

Every dependency in every manifest appears here. `[UNVERIFIED]` and `[VERIFY: …]` never belong in
a release. P0-04 added the workspace rows from the root manifest and lockfile; P0-09 added the
GitHub Actions rows from `.github/workflows/ci.yml`.

| Tool / library | Exact version | Source URL | Date checked | Approved by |
| --- | --- | --- | --- | --- |
| Polier | `1.0.0` | https://github.com/atshv/Polier/releases/tag/v1.0.0 | 2026-10-25 | owner |
| C++ compiler (local/CI) | Apple clang `21.0.0` (also accepts g++) | https://developer.apple.com/xcode/ — Apple clang licence (toolchain) | 2026-10-25 | lead (P1-03) |
| GitHub Action `actions/checkout` | `v7.0.1@3d3c42e5aac5ba805825da76410c181273ba90b1` | https://github.com/actions/checkout/releases/tag/v7.0.1 — MIT | 2026-10-25 | owner (2026-10-25) |
| GitHub Action `actions/setup-node` | `v7.1.0@949feb2413d6458794dcd2491c4babbbce0c15c1` | https://github.com/actions/setup-node/releases/tag/v7.1.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| GitHub Action `pnpm/action-setup` | `v6.1.0@ea17c68df8912ef543352723c149a84f56e3d413` | https://github.com/pnpm/action-setup/releases/tag/v6.1.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| pnpm (package manager) | `12.14.0` | https://www.npmjs.com/package/pnpm/v/12.14.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| Node.js LTS (Krypton) | `24.22.1` | https://nodejs.org/dist/index.json — v24.22.1, 2026-10-20, MIT | 2026-10-25 | owner (2026-10-25) |
| Turborepo (`turbo`) | `2.11.10` | https://www.npmjs.com/package/turbo/v/2.11.10 — MIT | 2026-10-25 | owner (2026-10-25) |
| TypeScript (`typescript`) | `5.9.3` | https://www.npmjs.com/package/typescript/v/5.9.3 — Apache-2.0 | 2026-10-25 | owner (2026-10-25) |
| ESLint (`eslint`) | `10.13.0` | https://www.npmjs.com/package/eslint/v/10.13.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| typescript-eslint | `8.72.0` | https://www.npmjs.com/package/typescript-eslint/v/8.72.0 — MIT | 2026-10-25 | owner (2026-10-25) |
| Docker Desktop (local runtime) | `4.96.3` (Engine `29.9.2`, Compose `5.6.1`) | https://www.docker.com/products/docker-desktop/ — proprietary Docker Desktop licence (local development tool, owner decision) | 2026-10-25 | owner (2026-10-25) |
| PostgreSQL (official image, local compose) | `17.11-alpine3.23@sha256:01ea903aa65deb58eb49d6e09d859ecff63a6bb7d61feca55f2abad71d08f72a` | https://hub.docker.com/_/postgres — PostgreSQL Licence (OSI permissive; blueprint-mandated server) | 2026-10-25 | lead (P0-07) |
| SeaweedFS (S3, local compose) | `4.50@sha256:c2658820e763294a9e9de7b36c81e59b879e3459148351aee4e31a126ca64860` | https://github.com/seaweedfs/seaweedfs — Apache-2.0 | 2026-10-25 | lead (P0-07) |
| Mailpit (mail catcher, local compose) | `v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498` | https://github.com/axllent/mailpit — MIT | 2026-10-25 | lead (P0-07) |

The workspace rows pin pnpm in `packageManager`, Turborepo, TypeScript, ESLint and
typescript-eslint in the root `devDependencies`, and Node in `.nvmrc` (`24.22.1`), which
`engines.node` accepts as `>=24.22.1`. The container images are pinned in
`infra/compose/compose.yaml`. The PostgreSQL server is mandated by the blueprint (section 2); its
PostgreSQL Licence (OSI-approved, permissive) is the only recorded exception to the licence list
below.

All tools in this table are open source without a required paid tier: pnpm, Turborepo, TypeScript,
ESLint, typescript-eslint and Node.js are MIT or Apache-2.0. Turborepo's optional hosted remote
cache (Vercel) is a paid service on larger plans and is not used; the local Turbo cache is enough
for the local phase.

Local gate only, not a workflow dependency: the `rhysd/actionlint` Docker image at tag `latest`
(actionlint `1.7.12`, digest
`sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667`) checks
`.github/workflows/ci.yml` locally (`ci-local` gate); the CI workflow does not pull it.

## Rules

1. Every dependency from `package.json`, lockfiles, `CMakeLists.txt` and CI workflows appears here,
   including dev dependencies, browsers and build tools.
2. Versions are exact and come from the manifest or lockfile, or from upstream release notes with a
   URL. Record the date and who checked it.
3. A version change updates the manifest, the lockfile and this table in the same task. No silent
   upgrades, no `latest`.
4. Licences: MIT, BSD, Apache-2.0, ISC or Zlib only; note the licence in the source URL column if
   it is not obvious.
