# Monorepo Layout: Project air

> Detail document for `ARCHITECTURE.md` (profile L).

**Profile L:** several deployable parts or packages with their own builds, integrated through contracts. The board lists them in `packages[]` (`path`, `kind`, `may_import`); `docs/module-map.md` is the package map.

## Root files

- `ARCHITECTURE.md` (≤ 800 words): system shape, package kinds, dependency direction, invariants. No folder tree, no per-package detail.
- `AGENTS.md`: root commands and rules only.
- `docs/module-map.md`: package map — path, kind, owner, may_import, build/test commands.
- Briefs: context pack lists root files plus the package's own files only.

## Package files

Each package gets:

- `<package>/ARCHITECTURE.md` (≤ 400 words): purpose, inputs, outputs, invariants, allowed imports, build/test commands.
- `<package>/AGENTS.md` (optional, ≤ 200 words): commands, deviations from the root file, pitfalls.

DSH loads a nested `AGENTS.md` automatically; Claude Code reads it through the brief's context pack.

**Stage 1:** the scaffold task creates every `packages[]` folder from the board with a `README.md` and an `ARCHITECTURE.md` (≤ 400 words). `check.py` rejects an existing package folder without an `ARCHITECTURE.md`, so both files are written together; the stage that adds the package's code expands its architecture text and commands. No empty folders.

## Dependency direction

- Packages import only what `packages[].may_import` allows. The `boundaries` gate (`python3 <package>/tools/boundaries.py .`) enforces it and names file, line and package on a violation.
- Dependencies point one way and never form a cycle. A cycle means merge the packages or move the shared part into a contract.
- Cross-package interfaces live in `packages/contracts` as versioned JSON Schema; `docs/contracts.md` explains them in prose (stage contract). A contract change updates every dependant in the same task or lists a lead-approved follow-up.

## Ownership and writes

- One writer per package per stage. A task with `package` writes inside that package; contract paths from `board.json` are the only exception.
- Two packages may be built in parallel only with disjoint `scope_write` and no shared decision.

## Example tree

```text
├── ARCHITECTURE.md            # system shape, kinds, direction, invariants (≤ 800 words)
├── AGENTS.md
├── docs/
│   ├── module-map.md          # package map
│   ├── monorepo-layout.md     # this file
│   └── contracts/
├── packages/
│   ├── engine/                # kind: package
│   │   ├── ARCHITECTURE.md    # purpose, inputs, outputs, invariants (≤ 400 words)
│   │   └── AGENTS.md          # optional (≤ 200 words)
│   └── ui/
├── services/
│   └── sync/                  # kind: service
├── apps/
│   └── web/                   # kind: app
└── tools/                     # kind: tool
```
