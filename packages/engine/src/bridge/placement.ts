// P4-19 (L20): placement of new objects. Pure, deterministic, no clock/random.
//
// A new object starts at the view centre, snapped to the tokens::canvas_grid
// (16 px). While the candidate overlaps a visible object (same board) it
// cascades tokens::space_32 (32 px) right and down, at most ten attempts. The
// result always keeps the full object inside the visible world bounds: the
// candidate is clamped to the bounds first, then snapped inward to the grid.

/** tokens::canvas_grid: 16 world px. */
export const PLACEMENT_GRID_PX = 16;
/** tokens::space_32: 32 world px cascade step. */
export const PLACEMENT_CASCADE_PX = 32;
/** The documented attempt cap of the L20 cascade. */
export const PLACEMENT_MAX_ATTEMPTS = 10;

export interface PlacementBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacementSize {
  readonly width: number;
  readonly height: number;
}

export interface PlacementInput {
  /** The camera's visible world bounds. */
  readonly visible: PlacementBounds;
  /** The visible objects of the same board (only these block the candidate). */
  readonly objects: readonly PlacementBounds[];
  readonly size: PlacementSize;
  readonly gridPx?: number;
  readonly cascadePx?: number;
  readonly maxAttempts?: number;
}

export interface PlacementResult {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Candidate positions evaluated: 1 = the first (centre) candidate was free. */
  readonly attempts: number;
  /** True when the attempt cap was reached (the L20 cascade is documented). */
  readonly capped: boolean;
  /**
   * True when the tenth candidate still overlapped a visible object, so the
   * deterministic visible-grid fallback slot is returned instead (still one
   * create operation at a visible, grid-aligned, non-overlapping position).
   */
  readonly fallback: boolean;
}

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function intersects(left: PlacementBounds, right: PlacementBounds): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

/** Clamps into the visible bounds, then snaps inward to the grid (never outside). */
function clampSnapInward(
  x: number,
  y: number,
  size: PlacementSize,
  visible: PlacementBounds,
  grid: number,
): { x: number; y: number } {
  const maxX = visible.x + visible.width - size.width;
  const maxY = visible.y + visible.height - size.height;
  let nextX = Math.min(Math.max(x, visible.x), Math.max(visible.x, maxX));
  let nextY = Math.min(Math.max(y, visible.y), Math.max(visible.y, maxY));
  // Snap inward: ceil for the minimum edge, floor for the maximum edge, so the
  // result is a grid position inside the visible bounds whenever both exist.
  const minGridX = Math.ceil(visible.x / grid) * grid;
  const maxGridX = Math.floor(maxX / grid) * grid;
  const minGridY = Math.ceil(visible.y / grid) * grid;
  const maxGridY = Math.floor(maxY / grid) * grid;
  nextX = maxGridX >= minGridX ? Math.min(Math.max(nextX, minGridX), maxGridX) : minGridX;
  nextY = maxGridY >= minGridY ? Math.min(Math.max(nextY, minGridY), maxGridY) : minGridY;
  // A grid position must stay on the grid; if the visible bounds are narrower
  // than one grid cell (a zoomed-in view smaller than the object), the inward
  // minimum keeps the object anchored inside as far as the grid allows.
  return { x: nextX, y: nextY };
}

/**
 * Places a new object: centre of the visible area snapped to the grid, then a
 * 32 px right/down cascade while it overlaps a visible object, at most ten
 * attempts. Always inside the visible bounds and on the grid; deterministic.
 */
export function placeNewObject(input: PlacementInput): PlacementResult {
  const grid = Math.max(1, input.gridPx ?? PLACEMENT_GRID_PX);
  const cascade = Math.max(0, input.cascadePx ?? PLACEMENT_CASCADE_PX);
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? PLACEMENT_MAX_ATTEMPTS));
  const visible = input.visible;
  const size = input.size;
  const visibleObjects = input.objects.filter((object) => intersects(object, visible));
  const centreX = snap(visible.x + visible.width / 2 - size.width / 2, grid);
  const centreY = snap(visible.y + visible.height / 2 - size.height / 2, grid);
  let candidate = clampSnapInward(centreX, centreY, size, visible, grid);
  let attempts = 1;
  for (;;) {
    const overlaps = visibleObjects.some((object) =>
      intersects({ x: candidate.x, y: candidate.y, width: size.width, height: size.height }, object),
    );
    if (!overlaps) {
      return {
        x: candidate.x,
        y: candidate.y,
        width: size.width,
        height: size.height,
        attempts,
        capped: false,
        fallback: false,
      };
    }
    if (attempts >= maxAttempts) {
      // L20 returns the tenth candidate after the documented cap. If it still
      // overlaps, return the first free visible grid slot instead so a new
      // object is never stacked invisibly (deterministic, still one create).
      const slot = firstFreeVisibleSlot(visibleObjects, size, visible, grid);
      return {
        x: slot.x,
        y: slot.y,
        width: size.width,
        height: size.height,
        attempts,
        capped: true,
        fallback: true,
      };
    }
    candidate = clampSnapInward(candidate.x + cascade, candidate.y + cascade, size, visible, grid);
    attempts += 1;
  }
}

/** Row-major visible-grid scan in cascade steps; the post-cap fallback slot. */
function firstFreeVisibleSlot(
  objects: readonly PlacementBounds[],
  size: PlacementSize,
  visible: PlacementBounds,
  grid: number,
): { x: number; y: number } {
  const startX = Math.ceil(visible.x / grid) * grid;
  const startY = Math.ceil(visible.y / grid) * grid;
  const maxX = Math.floor((visible.x + visible.width - size.width) / grid) * grid;
  const maxY = Math.floor((visible.y + visible.height - size.height) / grid) * grid;
  // A fine grid scan is needed: the 32 px cascade lattice can be fully covered
  // by 224x128 objects while a neighbouring 16 px slot is still free.
  for (let y = startY; y <= maxY; y += grid) {
    for (let x = startX; x <= maxX; x += grid) {
      const candidate = { x, y, width: size.width, height: size.height };
      if (!objects.some((object) => intersects(candidate, object))) {
        return { x, y };
      }
    }
  }
  // Every visible slot is taken: the clamped centre candidate is still on the grid.
  return clampSnapInward(visible.x, visible.y, size, visible, grid);
}
