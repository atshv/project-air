# Versions: Project air

Every dependency in every manifest appears here. `[UNVERIFIED]` and `[VERIFY: …]` never belong in
a release. P0-04 fills the first rows from the workspace manifest and lockfile.

| Tool / library | Exact version | Source URL | Date checked | Approved by |
| --- | --- | --- | --- | --- |
| Polier | `1.0.0` | https://github.com/atshv/Polier/releases/tag/v1.0.0 | 2026-10-25 | owner |
| PostgreSQL (official image, local compose) | `17.11-alpine3.23@sha256:01ea903aa65deb58eb49d6e09d859ecff63a6bb7d61feca55f2abad71d08f72a` | https://hub.docker.com/_/postgres — PostgreSQL Licence (OSI permissive; blueprint-mandated server) | 2026-10-25 | lead (P0-07) |
| SeaweedFS (S3, local compose) | `4.50@sha256:c2658820e763294a9e9de7b36c81e59b879e3459148351aee4e31a126ca64860` | https://github.com/seaweedfs/seaweedfs — Apache-2.0 | 2026-10-25 | lead (P0-07) |
| Mailpit (mail catcher, local compose) | `v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498` | https://github.com/axllent/mailpit — MIT | 2026-10-25 | lead (P0-07) |

The container images are pinned in `infra/compose/compose.yaml`. The PostgreSQL server is mandated
by the blueprint (section 2); its PostgreSQL Licence (OSI-approved, permissive) is the only recorded
exception to the licence list below.

## Rules

1. Every dependency from `package.json`, lockfiles, `CMakeLists.txt` and CI workflows appears here,
   including dev dependencies, browsers and build tools.
2. Versions are exact and come from the manifest or lockfile, or from upstream release notes with a
   URL. Record the date and who checked it.
3. A version change updates the manifest, the lockfile and this table in the same task. No silent
   upgrades, no `latest`.
4. Licences: MIT, BSD, Apache-2.0, ISC or Zlib only; note the licence in the source URL column if
   it is not obvious.
