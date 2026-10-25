# ADR-0001: Monorepo with packages, services, apps, tools and infra

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes:** –

## Context

Project air consists of an engine (C++/WebAssembly), shared TypeScript packages, several backend
services, a web app, build tools and infrastructure. The shared contract changes often in the
early stages, and work is done by several agents in parallel. The options were one repository
per part or one repository with all parts.

## Decision

We keep every part in one private monorepo, one folder per package, service, app, tool and infra
area, integrated through versioned contracts and checked by import boundaries.

## Consequences

- **Positive:** a contract change and all dependants land in one pull request; every commit is
  tested together; one release flow; agents get one place to read.
- **Negative:** CI must build and test only affected packages; access cannot be restricted per
  part; publishing one part as open source needs a mirror workflow.
- **Binds:** repository layout, `packages[]` on the board, `docs/module-map.md`, CI.
- **Prevents:** version drift between parts, multi-repository release ordering, half-integrated
  states.

## Alternatives

- **One repository per part** — rejected: every contract change would need coordinated releases
  across several repositories while the contract is still moving.
- **Monorepo without boundaries** — rejected: parts would import each other's internals; the
  `boundaries` gate and `may_import` prevent that.
