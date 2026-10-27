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

/**
 * Default glyph set: printable ASCII and the Latin-1 supplement (German umlauts
 * and sharp s). Any other code point draws the role's placeholder box.
 */
export function defaultCodePoints(): number[] {
  const codePoints: number[] = [];
  for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) {
    codePoints.push(codePoint);
  }
  for (let codePoint = 0xa0; codePoint <= 0xff; codePoint += 1) {
    codePoints.push(codePoint);
  }
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
