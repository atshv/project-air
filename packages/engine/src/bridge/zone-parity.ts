// L08 (P4-29) zone parity with the live demo: pure arrangement and release
// preview rules. Presentation and layout only; the committed outcome is built as
// one contract operation by the seam (AD-1). The same rules and thresholds are
// mirrored natively in include/engine/zone_layout.h for the native unit suite.

/** Design-rule values (tokens: header-height 40, space-16, space-12). */
export const ZONE_HEADER_HEIGHT = 40;
export const ZONE_PADDING = 16;
export const ZONE_GAP = 12;
/** Live-demo thresholds: size-normalised dominance, half-item hold, order band. */
export const ZONE_DOMINANCE = 1.25;
export const ZONE_HOLD = 0.5;
export const ZONE_ORDER_BAND = 12;
/** Release preview: 25 % enter coverage and a 24 px catch margin (screen px). */
export const ZONE_ENTER_COVERAGE = 0.25;
export const ZONE_CATCH_MARGIN = 24;
/** One calm settle: 300 ms cubic-bezier(0.2, 0, 0, 1), no overshoot. */
export const ZONE_SETTLE_MS = 300;
export const ZONE_SETTLE_CURVE = "cubic-bezier(0.2, 0, 0, 1)";
export const ZONE_LIFT_SCALE = 1.02;

export type ZoneOrientation = "vertical" | "horizontal";

/** World rectangle. */
export interface ZoneParityRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One member candidate: size, world offset from the zone centre and identity. */
export interface ZoneParityMember {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Offset of the member centre from the zone-centre in world px. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Current order index (stable tie-breaker of the order band). */
  readonly order: number;
}

export interface ZoneArrangement {
  readonly orientation: ZoneOrientation;
  /** The requested orientation fell back to the other one for the given bounds. */
  readonly fallback: boolean;
  /** Frame size around the arranged members (header + padding + content). */
  readonly frame: { readonly width: number; readonly height: number };
  /** Member positions relative to the frame origin, in arrangement order. */
  readonly placements: readonly { readonly id: string; readonly x: number; readonly y: number }[];
}

/**
 * Orientation from the size-normalised centre offsets: an offset must dominate
 * the other axis by 1.25 and clear half an item before it switches; otherwise the
 * current orientation is kept (near-diagonal and held-on-top drags never flip).
 */
export function zoneOrientation(
  members: readonly ZoneParityMember[],
  current: ZoneOrientation,
): ZoneOrientation {
  if (members.length < 2) {
    return current;
  }
  // The spread of the member centres, normalised by the average item size, so a
  // tall photo beside a short note still reads as side by side.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let widthSum = 0;
  let heightSum = 0;
  for (const member of members) {
    minX = Math.min(minX, member.offsetX);
    maxX = Math.max(maxX, member.offsetX);
    minY = Math.min(minY, member.offsetY);
    maxY = Math.max(maxY, member.offsetY);
    widthSum += member.width;
    heightSum += member.height;
  }
  const count = members.length;
  const nx = (maxX - minX) / Math.max(1, widthSum / count);
  const ny = (maxY - minY) / Math.max(1, heightSum / count);
  if (Math.max(nx, ny) < ZONE_HOLD) {
    return current;
  }
  if (nx >= ZONE_DOMINANCE * ny) {
    return "horizontal";
  }
  if (ny >= ZONE_DOMINANCE * nx) {
    return "vertical";
  }
  return current;
}

/**
 * Member order along the layout axis from the centre: members are ordered by
 * their centre coordinate and a pair swaps only when the coordinates differ by
 * more than the 12 px band (stable for near-equal centres).
 */
export function zoneOrder(
  members: readonly ZoneParityMember[],
  orientation: ZoneOrientation,
  band = ZONE_ORDER_BAND,
): readonly ZoneParityMember[] {
  const axis = (member: ZoneParityMember): number =>
    orientation === "horizontal" ? member.offsetX : member.offsetY;
  const sorted = [...members].sort((left, right) => {
    const difference = axis(left) - axis(right);
    if (Math.abs(difference) <= band) {
      return left.order - right.order;
    }
    return difference;
  });
  return sorted;
}

/**
 * Arranges the ordered members inside a frame: sizes + 16 px padding + 12 px gap
 * below the 40 px header. When the requested orientation does not fit the given
 * bounds the other orientation is used and reported as `fallback`; the caller's
 * stored request is never changed by this function.
 */
export function arrangeZone(
  members: readonly { readonly id: string; readonly width: number; readonly height: number }[],
  orientation: ZoneOrientation,
  bounds: { readonly width: number; readonly height: number },
): ZoneArrangement {
  const ordered = [...members];
  const layout = (candidate: ZoneOrientation): ZoneArrangement => {
    const placements: { id: string; x: number; y: number }[] = [];
    let contentWidth = 0;
    let contentHeight = 0;
    let cursor = 0;
    for (const member of ordered) {
      if (candidate === "vertical") {
        placements.push({ id: member.id, x: 0, y: cursor });
        cursor += member.height + ZONE_GAP;
        contentWidth = Math.max(contentWidth, member.width);
        contentHeight += member.height + ZONE_GAP;
      } else {
        placements.push({ id: member.id, x: cursor, y: 0 });
        cursor += member.width + ZONE_GAP;
        contentHeight = Math.max(contentHeight, member.height);
        contentWidth += member.width + ZONE_GAP;
      }
    }
    if (ordered.length > 0) {
      if (candidate === "vertical") {
        contentHeight -= ZONE_GAP;
      } else {
        contentWidth -= ZONE_GAP;
      }
    }
    return {
      orientation: candidate,
      fallback: false,
      frame: {
        width: contentWidth + 2 * ZONE_PADDING,
        height: ZONE_HEADER_HEIGHT + contentHeight + 2 * ZONE_PADDING,
      },
      placements,
    };
  };
  const preferred = layout(orientation);
  if (
    (bounds.width > 0 && preferred.frame.width > bounds.width + 0.5) ||
    (bounds.height > 0 && preferred.frame.height > bounds.height + 0.5)
  ) {
    const other = layout(orientation === "vertical" ? "horizontal" : "vertical");
    const fallback = { ...other, fallback: true };
    return fallback;
  }
  return preferred;
}

/** One release-preview decision (presentation only; nothing is committed yet). */
export type ZonePreviewKind = "dock" | "reorder" | "orientation" | "detach" | "free";

export interface ZonePreviewInput {
  /** Committed zone frame in world px. */
  readonly zoneFrame: ZoneParityRect;
  /** Pointer position in world px. */
  readonly pointer: ZoneParityRect & { readonly x: number; readonly y: number };
  /** Dragged member size in world px. */
  readonly dragged: { readonly width: number; readonly height: number };
  /** World position at drag start (against which placement is decided). */
  readonly dragStart: { readonly x: number; readonly y: number };
  /** Whether the current state already previews docking (hysteresis). */
  readonly previewing: boolean;
  /** Coverage the dragged member currently has over the frame (0 … 1). */
  readonly coverage: number;
  /** Current orientation and the one the placement implies. */
  readonly currentOrientation: ZoneOrientation;
  readonly desiredOrientation: ZoneOrientation;
  /** Screen pixels per world px (screen thresholds convert with it). */
  readonly zoom: number;
}

export interface ZonePreviewState {
  readonly kind: ZonePreviewKind;
  readonly inside: boolean;
  /** Landing slot for the dragged member (world px), if any. */
  readonly landing: ZoneParityRect | null;
  /** The frame the release would produce (world px). */
  readonly frame: ZoneParityRect;
  /** True while the frame shrinks around the member that stays (pull-out). */
  readonly shrinking: boolean;
  /** True while the other member makes room for the landing slot. */
  readonly makeRoom: boolean;
}

const insideWithCatch = (point: { x: number; y: number }, frame: ZoneParityRect, margin: number): boolean =>
  point.x >= frame.x - margin &&
  point.x <= frame.x + frame.width + margin &&
  point.y >= frame.y - margin &&
  point.y <= frame.y + frame.height + margin;

/**
 * The release preview from the drag-start positions. Entering needs the pointer
 * over the shown frame or 25 % coverage; staying keeps a 24 px catch margin
 * around the previewed frame (screen px converted by the zoom). A dock that
 * changes the flow position is a reorder, a dock that implies the other
 * orientation previews that orientation, and leaving shrinks the frame around the
 * member that stays. Returns `free`/`detach` otherwise. Nothing writes here.
 */
export function previewZoneRelease(input: ZonePreviewInput): ZonePreviewState {
  const margin = ZONE_CATCH_MARGIN / Math.max(0.0001, input.zoom);
  const insideFrame = insideWithCatch(input.pointer, input.zoneFrame, 0);
  const catchInside = input.previewing && insideWithCatch(input.pointer, input.zoneFrame, margin);
  const inside = insideFrame || input.coverage >= ZONE_ENTER_COVERAGE || catchInside;
  const frame = input.zoneFrame;
  if (!inside) {
    return {
      kind: input.previewing ? "detach" : "free",
      inside: false,
      landing: null,
      frame,
      shrinking: true,
      makeRoom: false,
    };
  }
  const landing: ZoneParityRect = {
    x: input.pointer.x - input.dragged.width / 2,
    y: input.pointer.y - input.dragged.height / 2,
    width: input.dragged.width,
    height: input.dragged.height,
  };
  if (input.desiredOrientation !== input.currentOrientation) {
    return { kind: "orientation", inside: true, landing, frame, shrinking: false, makeRoom: true };
  }
  const moved = Math.abs(input.pointer.x - input.dragStart.x) > ZONE_ORDER_BAND ||
    Math.abs(input.pointer.y - input.dragStart.y) > ZONE_ORDER_BAND;
  return {
    kind: moved ? "reorder" : "dock",
    inside: true,
    landing,
    frame,
    shrinking: false,
    makeRoom: moved,
  };
}

/** Motion policy: instant end states under reduced motion, no overshoot. */
export function zoneSettlePolicy(reducedMotion: boolean): {
  readonly durationMs: number;
  readonly easing: string;
  readonly liftScale: number;
} {
  return {
    durationMs: reducedMotion ? 0 : ZONE_SETTLE_MS,
    easing: ZONE_SETTLE_CURVE,
    liftScale: reducedMotion ? 1 : ZONE_LIFT_SCALE,
  };
}

/** Converts a screen-px threshold to world px for the given camera zoom. */
export function screenToWorldThreshold(pixels: number, zoom: number): number {
  return pixels / Math.max(0.0001, zoom);
}
