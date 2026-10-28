# ADR-0010: Zones as containers

**Date:** 2026-10-27 · **Status:** accepted · **Supersedes:** –

## Context

The canvas catalogue entry L08 ("Zones as containers") asks whether a zone merely draws a frame or
actually owns its content: dropping an object with its centre inside the zone, dragging it out,
moving the zone as one operation, deleting with "keep content" vs "delete content", shrinking never
below content + 16 px, and no nested zones in v1. Board question Q17 was answered in favour of
containers on 2026-10-25. The engine holds a working copy and every board-content change must be one
contract operation with its inverse (AD-1, AD-2), so containment needs a stored, versioned reference
rather than a rendering convention.

## Decision

Zones are containers:

- **Contract (0.2.0):** cards and blocks already carry an optional nullable zone parent
  (`null`/absent = board level) since 0.1.0 (P1-01); 0.2.0 documents the rule, adds the containment
  fixtures and keeps zones free of a parent (nested zones are invalid in v1 and the fixture corpus
  rejects them). The same bump adds the `reorder` operation (fractional `z` + inverse) that L13
  needs.
  Refinement from the implementation: `reorder` carries `{itemId, z}` for one card, block or zone and
  its inverse the previous `z`; the reference is additive, so 0.1.0-valid content stays valid. JSON
  Schema checks the parent's shape only, so the referential rule (the parent names a zone of the same
  board) lives in `fixtures/containment` plus `test/containment.test.mjs` and is enforced at rest by
  the P4-26 foreign key; a reorder inverse never creates an item, so it cannot resurrect a deleted
  one. `moveZone`'s `zoneId` description is corrected to name the moved zone; the wire shape is
  unchanged.
- **Storage (P4-26):** the platform migration adds the nullable parent column with a foreign key to
  the zone, the same row-level security as the board, and the containment constraint; history import
  is unaffected because legacy rows simply have no parent.
- **Behaviour (P4-27):** drop membership by centre inside the zone, a 1 s `--accent-line` highlight,
  drag-out releases, a zone drag moves its content as exactly one group operation, deletion asks
  "keep content" (default) or "delete content", and resizing clamps at content extent + 16 px.

## Amendment 2026-10-28 (P4-29): auto-arranged members

The owner approved parity with the live demo (`apps/web/preview`, read-only reference): members of a
zone are auto-arranged stacked or side by side from their sizes with the 40 px header, 16 px padding
and 12 px gap; orientation follows the size-normalised placement with 1.25 dominance and a half-item
hold, order comes from the centre with a 12 px band, and a release shows a live preview (dashed
landing slot, the other member making room, the frame shrinking on pull-out) before committing. The
release is still exactly one operation with inverse. The arrangement is a presentation-first
behaviour: the stored zone orientation request is never changed by a viewport fallback, and the
engine mirrors the demo's thresholds rather than defining a second interaction model.

## Amendment 2026-10-28 (P4-30): lifecycle and names

The owner approved the live demo's lifecycle: two free objects dropped together create a zone with the
default title as one operation; an emptied zone is removed as one undoable operation; and every zone
shows and renames its contract `title` in the 40 px header. Grouping/removal previews are presentation
state only. Contract 0.2.0 has no updateZone operation, so the seam expresses grouping and rename with
the existing `group` (creation) and `deleteZone` + `createZone` (rename) operations, each with an
inverse; a rename never creates a second title copy and the stored title stays contract state.

## Consequences

- **Positive:** membership survives reloads and sync, matches the visual model, allows "keep content"
  on deletion without data loss, and keeps every change reversible through one operation.
- **Negative:** a schema and migration change (0.2.0), a join/normalisation cost on every container
  move, and a cross-package dependency between contract, platform and engine tasks; engine-only
  visuals cannot express membership.
- **Binds:** `packages/contracts`, `services/platform`/migrations, `packages/engine`,
  `apps/engine-playground`; L08, L13.
- **Prevents:** zone membership as an unsaved visual convention, nested zones in v1, and a second
  containment table or write path.

## Alternatives

- **Zones as visual frames only** — rejected by Q17; deletion and reload semantics would be lossy.
- **Nested zones in v1** — rejected: recursive containment, layout and migration complexity without a
  user need yet.
- **Membership in a separate table instead of a nullable parent** — rejected for v1: one parent per
  item is the requirement, and a nullable column keeps the board-content model flat and cheap.
