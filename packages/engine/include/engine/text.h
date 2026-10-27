#pragma once

// Runtime glyph atlas and glyph-quad command buffer (P4-08, L02, ADR-0009).
//
// The TypeScript bridge rasterises glyphs of the token font stack with Canvas2D
// into one RGBA atlas; this module plans that atlas against the GPU texture
// limit, validates and keeps the uploaded pixels and glyph metrics, and turns
// world-anchored glyph runs into screen-space textured quads. No font file is
// bundled and no glyph is rasterised in C++.
//
// Units: atlas pixels and packed metrics are raster pixels (CSS px times the
// atlas raster scale); every metric the module reports is CSS pixels, so layout
// is independent of the device pixel ratio.

#include <cstddef>
#include <cstdint>
#include <vector>

#include "engine/camera.h"
#include "engine/status.h"

namespace air::engine {

// Text roles with their token typography (design rule §13, canvas catalogue L02:
// card title 15 px / 600). Ordinals cross the C ABI.
enum class TextRole : std::uint32_t {
  title = 0,
  body = 1,
};
inline constexpr std::uint32_t kTextRoleCount = 2;

struct TextStyle {
  const char* fontFamily{nullptr};  // CSS font-family stack from tokens.h
  double fontSize{0.0};             // CSS px
  int fontWeight{0};
  double lineHeight{0.0};  // multiple of fontSize
};

// Typography of a role, only from tokens.h; fails for an unknown ordinal.
Status textStyle(std::uint32_t role, TextStyle& out);

// Atlas planning ------------------------------------------------------------

// Highest device pixel ratio the atlas accepts; above it a raster scale would
// only waste texture space.
inline constexpr double kMaxDevicePixelRatio = 8.0;
// Upper bounds that keep the plan arithmetic and the table small.
inline constexpr std::uint32_t kMaxAtlasGlyphs = 4096;
inline constexpr double kMaxCellSize = 512.0;
// Transparent raster pixels around every cell so linear sampling never bleeds
// into the neighbouring glyph.
inline constexpr std::uint32_t kAtlasCellPadding = 1;

struct AtlasRequest {
  std::uint32_t glyphCount{0};  // including one placeholder per role
  double cellWidth{0.0};        // CSS px, without padding
  double cellHeight{0.0};       // CSS px, without padding
  double devicePixelRatio{1.0};
  std::uint32_t maxTextureSize{0};  // GL MAX_TEXTURE_SIZE
};

struct AtlasPlan {
  std::uint32_t width{0};   // power of two, <= maxTextureSize
  std::uint32_t height{0};  // power of two, <= maxTextureSize
  std::uint32_t columns{0};
  std::uint32_t rows{0};
  std::uint32_t cellWidth{0};   // raster px including padding on both sides
  std::uint32_t cellHeight{0};  // raster px including padding on both sides
  double rasterScale{1.0};      // raster px per CSS px
};

// Plans a uniform-cell atlas: the raster scale starts at the device pixel ratio
// and is halved (never below 1) until the smallest power-of-two atlas that holds
// every cell fits into maxTextureSize. Fails, leaving `plan` untouched, for
// invalid input or when the glyphs do not fit even at the last tried scale.
Status planAtlas(const AtlasRequest& request, AtlasPlan& plan);

// Glyph table ---------------------------------------------------------------

// Packed metrics stride per glyph, all raster px except role and code point:
//   role, codePoint, atlasX, atlasY, width, height, bearingX, bearingY, advance
// bearingX/bearingY place the bitmap's top-left relative to the pen position on
// the top edge of the line box (y down).
inline constexpr std::size_t kGlyphMetricsStride = 9;
// Code point 0 is the placeholder of a role; every role must provide one.
inline constexpr std::uint32_t kPlaceholderCodePoint = 0;
inline constexpr std::uint32_t kMaxCodePoint = 0x10FFFF;

struct Glyph {
  std::uint32_t role{0};
  std::uint32_t codePoint{0};
  // Atlas rectangle in raster px.
  float atlasX{0.0F};
  float atlasY{0.0F};
  float width{0.0F};
  float height{0.0F};
  // CSS px.
  float bearingX{0.0F};
  float bearingY{0.0F};
  float cssWidth{0.0F};
  float cssHeight{0.0F};
  float advance{0.0F};
};

class GlyphAtlas {
 public:
  // Validates the whole upload before replacing the atlas: dimensions (power of
  // two, <= maxTextureSize), the raster scale, the RGBA byte length, every
  // metric (finite, inside the atlas, no duplicate role/code point, valid role
  // and code point) and one placeholder per role. A rejected upload leaves the
  // previous atlas, its glyphs and its generation unchanged.
  Status load(std::uint32_t width, std::uint32_t height, double rasterScale,
              std::uint32_t maxTextureSize, const std::uint8_t* rgba, std::size_t byteLength,
              const float* metrics, std::uint32_t glyphCount);

  bool ready() const { return !glyphs_.empty(); }
  std::uint32_t width() const { return width_; }
  std::uint32_t height() const { return height_; }
  double rasterScale() const { return rasterScale_; }
  // Increments on every accepted load; the renderer re-uploads on a change.
  std::uint64_t generation() const { return generation_; }
  const std::vector<std::uint8_t>& pixels() const { return pixels_; }
  std::size_t glyphCount() const { return glyphs_.size(); }

  // True when the atlas has a glyph for this role and code point.
  bool contains(std::uint32_t role, std::uint32_t codePoint) const;
  // Glyph for the code point, or the role's placeholder when it is missing (a
  // visible box, never a silent gap); nullptr only when the atlas is not ready
  // or the role is unknown.
  const Glyph* resolve(std::uint32_t role, std::uint32_t codePoint) const;

 private:
  std::vector<Glyph> glyphs_;  // sorted by (role, codePoint)
  std::vector<std::uint8_t> pixels_;
  std::uint32_t width_{0};
  std::uint32_t height_{0};
  double rasterScale_{1.0};
  std::uint64_t generation_{0};
};

// Glyph runs and the glyph command buffer ------------------------------------

// One textured glyph quad: screen-space rectangle (CSS px, top-left origin) and
// normalised atlas UVs. Reused unchanged by the WebGL2 glyph pass.
struct GlyphInstance {
  float x{0.0F};
  float y{0.0F};
  float width{0.0F};
  float height{0.0F};
  float u0{0.0F};
  float v0{0.0F};
  float u1{0.0F};
  float v1{0.0F};
};
static_assert(sizeof(GlyphInstance) == 32, "glyph instance layout is the WebGL2 seam");

inline constexpr std::uint32_t kMaxTextRuns = 4096;
inline constexpr std::uint32_t kMaxGlyphInstances = 65536;

// Layout (P4-09, L02) ---------------------------------------------------------

// How a run is laid out inside its box. Ordinals cross the C ABI.
//   line     — one line placed by advance only, no box (the P4-08 behaviour).
//   ellipsis — one line cut to the box width and ended with U+2026 (titles).
//   wrap     — greedy word wrap inside the box width, lines beyond the box
//              height clipped, the last visible line ended with U+2026.
enum class TextFlow : std::uint32_t {
  line = 0,
  ellipsis = 1,
  wrap = 2,
};
inline constexpr std::uint32_t kTextFlowCount = 3;

inline constexpr std::uint32_t kEllipsisCodePoint = 0x2026;
inline constexpr std::uint32_t kFullStopCodePoint = 0x2E;
inline constexpr std::uint32_t kSpaceCodePoint = 0x20;
inline constexpr std::uint32_t kLineFeedCodePoint = 0x0A;
// Glyphs an ellipsis may add beyond a run's code points: three full stops when
// the atlas has no U+2026.
inline constexpr std::uint32_t kEllipsisGlyphReserve = 3;

// One laid-out glyph: offsets in CSS px from the run anchor; `x` is the pen
// position on its line and `y` the top of its line box.
struct GlyphPlacement {
  std::uint32_t codePoint{0};
  double x{0.0};
  double y{0.0};
};

struct TextLayout {
  std::vector<GlyphPlacement> glyphs;
  std::uint32_t lines{0};   // lines that draw at least one glyph slot
  bool truncated{false};    // content was cut (ellipsis or clipped lines)
  double width{0.0};        // widest laid-out line, CSS px
  double height{0.0};       // lines times the role's line height, CSS px
};

// Lays out code points of one role inside a box (CSS px) from the atlas
// metrics, so the result is independent of the device pixel ratio and of the
// zoom. Line height is the token font size times the token line height. A box
// width of 0 draws nothing; trailing spaces of a wrapped line are not placed.
// Without a ready atlas the layout is empty and the call succeeds. Fails for an
// unknown role or flow, a non-finite or negative box, or null code points.
Status layoutText(const GlyphAtlas& atlas, std::uint32_t role, TextFlow flow, double boxWidth,
                  double boxHeight, const std::uint32_t* codePoints, std::uint32_t count,
                  TextLayout& out);

// A world-anchored run of code points: (x, y) is the top-left of the first line
// box. `line` runs are placed by advance only; `ellipsis`/`wrap` runs keep a
// layout that is recomputed only when the atlas generation changes (the cache
// is mutable because the glyph buffer reads runs as const).
struct TextRun {
  double x{0.0};
  double y{0.0};
  std::uint32_t role{0};
  std::vector<std::uint32_t> codePoints;
  TextFlow flow{TextFlow::line};
  double boxWidth{0.0};
  double boxHeight{0.0};
  mutable TextLayout layout;
  mutable std::uint64_t layoutGeneration{0};
};

class TextRuns {
 public:
  TextRuns();
  // Rejects non-finite anchors, unknown roles, code points above U+10FFFF, more
  // than kMaxTextRuns runs or more than kMaxGlyphInstances glyphs in total; a
  // rejected run leaves the store untouched. An empty run is accepted and draws
  // nothing.
  Status add(double x, double y, std::uint32_t role, const std::uint32_t* codePoints,
             std::uint32_t count);
  // A run with a layout flow and a box (CSS px). Validates the flow and a
  // finite, non-negative box on top of the checks above; an `ellipsis`/`wrap`
  // run reserves kEllipsisGlyphReserve extra glyphs against the glyph limit.
  Status add(double x, double y, std::uint32_t role, TextFlow flow, double boxWidth,
             double boxHeight, const std::uint32_t* codePoints, std::uint32_t count);
  void clear();
  const std::vector<TextRun>& runs() const { return runs_; }
  std::size_t glyphTotal() const { return glyphTotal_; }

 private:
  std::vector<TextRun> runs_;
  std::size_t glyphTotal_{0};
};

class GlyphBuffer {
 public:
  GlyphBuffer();

  void clear() { instances_.clear(); }
  std::size_t size() const { return instances_.size(); }
  bool empty() const { return instances_.empty(); }
  const std::vector<GlyphInstance>& instances() const { return instances_; }
  const std::uint8_t* bytes() const;
  std::size_t byteSize() const;

  // Builds the visible glyph quads of every run in run order through the camera.
  // Missing code points draw their role's placeholder; quads fully outside the
  // viewport are culled. Without a ready atlas the buffer stays empty and the
  // build succeeds. Fails (buffer empty) for a viewport that is not positive and
  // finite. Identical input gives byte-identical records.
  Status build(const TextRuns& runs, const GlyphAtlas& atlas, const Camera& camera,
               double viewportWidth, double viewportHeight);

 private:
  std::vector<GlyphInstance> instances_;
};

}  // namespace air::engine
