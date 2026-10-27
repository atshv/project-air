// Runtime glyph-atlas rasteriser of the bridge (P4-08, ADR-0009).
//
// The browser owns system-font rendering, so the bridge draws the glyph set with
// Canvas2D into one RGBA image and hands pixels plus packed metrics to the C++
// core in a single upload. No font file is bundled: the font string is composed
// from the token typography that the C ABI returns (engine_text_style /
// engine_text_font_family), so the bridge keeps no typography value of its own.
// The atlas size and raster scale come from the core's planner, which applies
// the GPU texture-limit fallback.

/** Text roles; the ordinals match TextRole in packages/engine/include/engine/text.h. */
export type TextRoleName = "title" | "body";

export const TEXT_ROLE_ORDINALS: Readonly<Record<TextRoleName, number>> = {
  title: 0,
  body: 1,
};

const ROLE_NAMES: readonly TextRoleName[] = ["title", "body"];

/** Token typography of one role, as the C ABI reports it. */
export interface TextRoleStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly lineHeight: number;
}

/** Atlas plan from engine_text_plan_atlas (raster px, padding included). */
export interface TextAtlasPlan {
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly rasterScale: number;
}

export interface TextAtlasRequest {
  readonly glyphCount: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly devicePixelRatio: number;
}

/**
 * Zoom buckets of the runtime atlas (L02 sharp zoom, P4-10). The atlas is
 * rasterised at the smallest power-of-two zoom level at or above the camera
 * zoom, so text is sharp at the bucket and up to 2x supersampled between
 * buckets; the camera clamp 0.1 ... 8 is mirrored by the first and last bucket.
 */
export const MIN_ATLAS_ZOOM_BUCKET = 0.25;
export const MAX_ATLAS_ZOOM_BUCKET = 4;
/**
 * Highest raster scale of one atlas (`kMaxDevicePixelRatio` of text.h is 8, but a
 * 4x atlas already covers the 200 % case at DPR 1 and 2 with bounded memory; a
 * larger scale would only grow the texture quadratically).
 */
export const MAX_ATLAS_RASTER_SCALE = 4;

/**
 * Smallest power-of-two zoom bucket at or above `zoom`, clamped to the documented
 * bucket range. The result is one of 0.25, 0.5, 1, 2 or 4, so a session rebuilds
 * the atlas at most five times and never on a plain pan or at an unchanged zoom.
 */
export function atlasZoomBucket(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const clamped = Math.min(
    Math.max(safeZoom, MIN_ATLAS_ZOOM_BUCKET),
    MAX_ATLAS_ZOOM_BUCKET,
  );
  return Math.min(MAX_ATLAS_ZOOM_BUCKET, Math.pow(2, Math.ceil(Math.log2(clamped))));
}

/**
 * Raster scale of the atlas for a device pixel ratio and camera zoom: the bucket
 * times the DPR, capped at {@link MAX_ATLAS_RASTER_SCALE}. Only this scale
 * changes between zoom buckets; the P4-09 layout stays in CSS px and therefore
 * identical, so a line never re-breaks when the atlas is re-rasterised.
 */
export function atlasRasterScale(devicePixelRatio: number, zoom: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(MAX_ATLAS_RASTER_SCALE, atlasZoomBucket(zoom) * ratio);
}

/** The core calls the rasteriser needs; implemented by the WebGL bridge. */
export interface TextAtlasPort {
  style(role: number): TextRoleStyle;
  plan(request: TextAtlasRequest): TextAtlasPlan;
}

export interface RasterizedTextAtlas {
  readonly plan: TextAtlasPlan;
  readonly pixels: Uint8Array;
  /** Packed metrics, METRICS_STRIDE floats per glyph (see text.h). */
  readonly metrics: Float32Array;
  readonly glyphCount: number;
}

/** kGlyphMetricsStride in text.h. */
export const METRICS_STRIDE = 9;
/** kAtlasCellPadding in text.h: transparent raster px on each side of a cell. */
const CELL_PADDING = 1;
/** kPlaceholderCodePoint in text.h. */
const PLACEHOLDER_CODE_POINT = 0;

/** kEllipsisCodePoint in text.h: the single-glyph ellipsis of the layout flows. */
export const ELLIPSIS_CODE_POINT = 0x2026;

/**
 * Typographic punctuation German and English board text uses (P4-09): en and em
 * dash, single and double quotes including the German low-9 quotes, the bullet
 * and the ellipsis.
 */
const TYPOGRAPHIC_CODE_POINTS = [
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2022, ELLIPSIS_CODE_POINT,
];

/**
 * Default glyph set: printable ASCII, the Latin-1 supplement (German umlauts
 * and sharp s) and the typographic punctuation above, including U+2026 for the
 * layout ellipsis (P4-09). Any other code point draws the role's placeholder box.
 */
export function defaultCodePoints(): number[] {
  const codePoints: number[] = [];
  for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) {
    codePoints.push(codePoint);
  }
  for (let codePoint = 0xa0; codePoint <= 0xff; codePoint += 1) {
    codePoints.push(codePoint);
  }
  codePoints.push(...TYPOGRAPHIC_CODE_POINTS);
  return codePoints;
}

/** Unicode code points of a string; a lone surrogate stays its own code unit. */
export function codePointsOf(text: string): number[] {
  const codePoints: number[] = [];
  for (const character of text) {
    codePoints.push(character.codePointAt(0) ?? PLACEHOLDER_CODE_POINT);
  }
  return codePoints;
}

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createContext(width: number, height: number): Context2D {
  if (typeof OffscreenCanvas === "function") {
    const context = new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    });
    if (context !== null) {
      return context;
    }
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context !== null) {
      return context;
    }
  }
  throw new Error("no Canvas2D context is available for the glyph atlas");
}

function cssFont(style: TextRoleStyle): string {
  return `${String(style.fontWeight)} ${String(style.fontSize)}px ${style.fontFamily}`;
}

interface RoleMeasure {
  readonly role: number;
  readonly style: TextRoleStyle;
  readonly font: string;
  readonly lineBox: number;
  readonly advances: readonly number[];
  /** Placeholder box width in CSS px (0.6 em, an outline, never a character). */
  readonly placeholderAdvance: number;
}

/**
 * Rasterises every role's placeholder plus `codePoints` at the planned raster
 * scale: white coverage on transparent pixels (the shader tints the alpha with
 * tokens::fg). Every glyph occupies one uniform cell whose pen origin sits
 * `left` CSS px inside the padded cell, on the top edge of the line box.
 */
export function rasterizeTextAtlas(
  port: TextAtlasPort,
  codePoints: readonly number[],
  devicePixelRatio: number,
): RasterizedTextAtlas {
  const measureContext = createContext(1, 1);
  const roles: RoleMeasure[] = [];
  let left = 0;
  let right = 0;
  let lineBox = 0;
  for (const name of ROLE_NAMES) {
    const role = TEXT_ROLE_ORDINALS[name];
    const style = port.style(role);
    const font = cssFont(style);
    measureContext.font = font;
    const advances: number[] = [];
    for (const codePoint of codePoints) {
      const metrics = measureContext.measureText(String.fromCodePoint(codePoint));
      advances.push(Math.max(0, metrics.width));
      left = Math.max(left, metrics.actualBoundingBoxLeft);
      right = Math.max(right, metrics.actualBoundingBoxRight, metrics.width);
    }
    const placeholderAdvance = style.fontSize * 0.6;
    right = Math.max(right, placeholderAdvance);
    const roleLineBox = style.fontSize * style.lineHeight;
    lineBox = Math.max(lineBox, roleLineBox);
    roles.push({ role, style, font, lineBox: roleLineBox, advances, placeholderAdvance });
  }
  // measureText boxes can be fractional or negative: round the cell outward.
  const leftExtent = Math.ceil(Math.max(0, left));
  const cellWidth = leftExtent + Math.ceil(right);
  const cellHeight = Math.ceil(lineBox);
  const glyphCount = roles.length * (codePoints.length + 1);
  const plan = port.plan({ glyphCount, cellWidth, cellHeight, devicePixelRatio });

  const context = createContext(plan.width, plan.height);
  context.clearRect(0, 0, plan.width, plan.height);
  // The atlas is a coverage mask: only alpha is sampled, so the fill is a fixed
  // mask colour, not a design value.
  context.fillStyle = "white";
  context.strokeStyle = "white";
  context.textAlign = "left";
  context.textBaseline = "middle";
  const scale = plan.rasterScale;
  const metrics = new Float32Array(glyphCount * METRICS_STRIDE);
  let cell = 0;
  const bearingX = -(CELL_PADDING + leftExtent * scale);
  const bearingY = -CELL_PADDING;
  const writeMetrics = (role: number, codePoint: number, advance: number): [number, number] => {
    const atlasX = (cell % plan.columns) * plan.cellWidth;
    const atlasY = Math.floor(cell / plan.columns) * plan.cellHeight;
    metrics.set(
      [
        role,
        codePoint,
        atlasX,
        atlasY,
        plan.cellWidth,
        plan.cellHeight,
        bearingX,
        bearingY,
        advance * scale,
      ],
      cell * METRICS_STRIDE,
    );
    cell += 1;
    return [atlasX, atlasY];
  };

  for (const measure of roles) {
    context.font = measure.font;
    // Placeholder: an outlined box on the text body, so a missing glyph is
    // visible instead of a silent gap (ADR-0009, design rule §5).
    const [boxX, boxY] = writeMetrics(measure.role, PLACEHOLDER_CODE_POINT, measure.placeholderAdvance);
    const lineWidth = Math.max(1, Math.round(scale));
    context.lineWidth = lineWidth;
    const originX = boxX + CELL_PADDING + leftExtent * scale;
    const originY = boxY + CELL_PADDING;
    const boxHeight = measure.style.fontSize * 0.7 * scale;
    context.strokeRect(
      originX + lineWidth,
      originY + (measure.lineBox * scale - boxHeight) / 2 + lineWidth / 2,
      measure.placeholderAdvance * scale - 2 * lineWidth,
      boxHeight - lineWidth,
    );

    for (let index = 0; index < codePoints.length; index += 1) {
      const codePoint = codePoints[index] ?? PLACEHOLDER_CODE_POINT;
      const [atlasX, atlasY] = writeMetrics(measure.role, codePoint, measure.advances[index] ?? 0);
      const penX = atlasX + CELL_PADDING + leftExtent * scale;
      const penY = atlasY + CELL_PADDING;
      context.save();
      context.beginPath();
      context.rect(
        atlasX + CELL_PADDING,
        atlasY + CELL_PADDING,
        plan.cellWidth - 2 * CELL_PADDING,
        plan.cellHeight - 2 * CELL_PADDING,
      );
      context.clip();
      context.setTransform(scale, 0, 0, scale, penX, penY);
      context.fillText(String.fromCodePoint(codePoint), 0, measure.lineBox / 2);
      context.restore();
    }
  }
  const image = context.getImageData(0, 0, plan.width, plan.height);
  return {
    plan,
    pixels: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    metrics,
    glyphCount,
  };
}
