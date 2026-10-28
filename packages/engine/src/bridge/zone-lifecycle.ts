// L08 (P4-30) zone lifecycle and names: pure rules shared by the playground and
// the tests. Presentation state (ghost/emptying frames) and contract state
// (zone title) are strictly separated; the committed outcomes are built as one
// operation with inverse by the logic seam.

import { arrangeZone, zoneOrientation, ZONE_HEADER_HEIGHT, ZONE_PADDING, type ZoneOrientation } from "./zone-parity.js";

/** Grouping thresholds from the live demo (screen px, zoom-independent). */
export const GROUP_OVERLAP = 0.2;
export const GROUP_POINTER_PX = 16;
export const GROUP_CONTACT_PX = 32;
/** Zone title limit of the live demo and the 0.2.0 header band. */
export const ZONE_TITLE_MAX = 40;
export const ZONE_HEADER = ZONE_HEADER_HEIGHT;

/** Default zone titles per playground language (product translations are web-app work). */
export const DEFAULT_ZONE_TITLES = { en: "New zone", de: "Neue Zone" } as const;
export type ZoneLanguage = keyof typeof DEFAULT_ZONE_TITLES;

export function defaultZoneTitle(language: ZoneLanguage = "en"): string {
  return DEFAULT_ZONE_TITLES[language] ?? DEFAULT_ZONE_TITLES.en;
}

/**
 * The live-demo rename rules: whitespace collapsed, trimmed; an empty title
 * falls back to the language default; at most 40 characters (code points).
 */
export function normalizeZoneTitle(
  raw: string,
  language: ZoneLanguage = "en",
): { readonly title: string; readonly changed: boolean } {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const limited = Array.from(collapsed).slice(0, ZONE_TITLE_MAX).join("");
  const title = limited.length === 0 ? defaultZoneTitle(language) : limited;
  return { title, changed: title !== raw };
}

/** Presentation look of a zone frame: dashed while grouping or emptied. */
export function zoneFrameLook(input: {
  readonly grouping: boolean;
  readonly memberCount: number;
  readonly lastMemberLeaving: boolean;
}): { readonly dashed: boolean; readonly dimmed: boolean } {
  const emptying = input.memberCount === 0 || input.lastMemberLeaving;
  return { dashed: input.grouping || emptying, dimmed: emptying };
}

export interface GroupingContact {
  /** Overlap ratio of the smaller dragged rect over the other one (0…1). */
  readonly overlap: number;
  /** Pointer distance to the other rect in screen px. */
  readonly pointerDistance: number;
  /** Contact distance in screen px (edge gap, negative when overlapping). */
  readonly contact: number;
}
export interface GroupingDecision {
  readonly start: boolean;
  readonly keep: boolean;
  /** Thresholds already scaled into screen px by the caller. */
}

/**
 * Grouping hysteresis: 20 % overlap of the smaller item or a 16 px pointer
 * distance starts the ghost; once shown, any contact within 32 px keeps it.
 */
export function groupingDecision(contact: GroupingContact, active: boolean): GroupingDecision {
  const start = contact.overlap >= GROUP_OVERLAP || contact.pointerDistance <= GROUP_POINTER_PX;
  const keep = active && contact.contact <= GROUP_CONTACT_PX;
  return { start: start || keep, keep };
}

/** Frame resize/scale must never scale the 40 px header (FLIP keeps it fixed). */
export function headerGeometry(scale: number): { readonly height: number; readonly scale: number } {
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { height: ZONE_HEADER, scale: 1 / safe };
}

export interface SizedRect {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface ZoneGroupLayout {
  readonly orientation: ZoneOrientation;
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly members: readonly { readonly id: string; readonly x: number; readonly y: number }[];
}

/**
 * Layout of a new (or wrapping) zone around objects: sizes + padding + gap below
 * the header, origin at the union of the objects (an existing frame keeps its
 * origin). A one-item existing zone wraps the pair and keeps its title; the
 * caller keeps the stored orientation request separate from the applied one.
 */
export function planZoneGroup(
  members: readonly SizedRect[],
  existingFrame: { readonly x: number; readonly y: number } | null,
  requested: ZoneOrientation,
  bounds: { readonly width: number; readonly height: number },
): ZoneGroupLayout {
  const centreX = members.reduce((sum, member) => sum + member.x + member.width / 2, 0) / Math.max(1, members.length);
  const centreY = members.reduce((sum, member) => sum + member.y + member.height / 2, 0) / Math.max(1, members.length);
  const offsets = members.map((member, index) => ({
    id: member.id,
    width: member.width,
    height: member.height,
    offsetX: member.x + member.width / 2 - centreX,
    offsetY: member.y + member.height / 2 - centreY,
    order: index,
  }));
  const orientation = zoneOrientation(offsets, requested);
  const arrangement = arrangeZone(
    members.map((member) => ({ id: member.id, width: member.width, height: member.height })),
    orientation,
    bounds,
  );
  const left = Math.min(...members.map((member) => member.x));
  const top = Math.min(...members.map((member) => member.y)) - ZONE_HEADER - ZONE_PADDING;
  const frame = {
    x: existingFrame === null ? left - ZONE_PADDING : existingFrame.x,
    y: existingFrame === null ? top : existingFrame.y,
    width: arrangement.frame.width,
    height: arrangement.frame.height,
  };
  return {
    orientation: arrangement.orientation,
    frame,
    members: arrangement.placements.map((placement) => ({
      id: placement.id,
      x: frame.x + ZONE_PADDING + placement.x,
      y: frame.y + ZONE_HEADER + ZONE_PADDING + placement.y,
    })),
  };
}
