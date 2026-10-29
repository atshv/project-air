#include "engine/text.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

#include "tokens.h"

namespace air::engine {
namespace {

bool isPowerOfTwo(std::uint32_t value) { return value != 0 && (value & (value - 1U)) == 0; }

std::uint64_t nextPowerOfTwo(std::uint64_t value) {
  std::uint64_t result = 1;
  while (result < value) {
    result <<= 1U;
  }
  return result;
}

bool finite(float value) { return std::isfinite(value); }

bool glyphLess(const Glyph& left, const Glyph& right) {
  return left.role != right.role ? left.role < right.role : left.codePoint < right.codePoint;
}

// Smallest power-of-two atlas for `glyphCount` cells at the given raster cell
// size; false when no layout fits into maxTextureSize.
bool layoutAtlas(std::uint32_t glyphCount, std::uint32_t cellWidth, std::uint32_t cellHeight,
                 std::uint32_t maxTextureSize, AtlasPlan& out) {
  bool found = false;
  std::uint64_t bestArea = 0;
  std::uint64_t bestSide = 0;
  for (std::uint64_t width = 1; width <= maxTextureSize; width <<= 1U) {
    const std::uint64_t columns = width / cellWidth;
    if (columns == 0) {
      continue;
    }
    const std::uint64_t rows = (glyphCount + columns - 1) / columns;
    const std::uint64_t height = nextPowerOfTwo(rows * cellHeight);
    if (height > maxTextureSize) {
      continue;
    }
    const std::uint64_t area = width * height;
    const std::uint64_t side = std::max(width, height);
    // Smallest area first, then the squarer atlas; width grows, so the first of
    // equal candidates wins and the plan is deterministic.
    if (!found || area < bestArea || (area == bestArea && side < bestSide)) {
      found = true;
      bestArea = area;
      bestSide = side;
      out.width = static_cast<std::uint32_t>(width);
      out.height = static_cast<std::uint32_t>(height);
      out.columns = static_cast<std::uint32_t>(columns);
      out.rows = static_cast<std::uint32_t>(rows);
      out.cellWidth = cellWidth;
      out.cellHeight = cellHeight;
    }
  }
  return found;
}

}  // namespace

Status textStyle(std::uint32_t role, TextStyle& out) {
  switch (role) {
    case static_cast<std::uint32_t>(TextRole::title):
      out = TextStyle{tokens::font_sans, tokens::text_15, tokens::weight_semibold,
                      tokens::line_height};
      return Status::success();
    case static_cast<std::uint32_t>(TextRole::body):
      out = TextStyle{tokens::font_sans, tokens::text_13, tokens::weight_regular,
                      tokens::line_height};
      return Status::success();
    default:
      return Status::failure("text role is unknown");
  }
}

Status planAtlas(const AtlasRequest& request, AtlasPlan& plan) {
  if (request.glyphCount == 0 || request.glyphCount > kMaxAtlasGlyphs) {
    return Status::failure("atlas glyph count is outside 1 ... 4096");
  }
  if (!std::isfinite(request.cellWidth) || !std::isfinite(request.cellHeight) ||
      request.cellWidth <= 0.0 || request.cellHeight <= 0.0 ||
      request.cellWidth > kMaxCellSize || request.cellHeight > kMaxCellSize) {
    return Status::failure("atlas cell size must be positive, finite and at most 512 px");
  }
  if (!std::isfinite(request.devicePixelRatio) || request.devicePixelRatio <= 0.0 ||
      request.devicePixelRatio > kMaxDevicePixelRatio) {
    return Status::failure("device pixel ratio must be finite and in (0, 8]");
  }
  if (request.maxTextureSize == 0) {
    return Status::failure("maximum texture size must be positive");
  }

  double scale = request.devicePixelRatio;
  while (true) {
    const auto cellWidth = static_cast<std::uint32_t>(std::ceil(request.cellWidth * scale)) +
                           2U * kAtlasCellPadding;
    const auto cellHeight = static_cast<std::uint32_t>(std::ceil(request.cellHeight * scale)) +
                            2U * kAtlasCellPadding;
    AtlasPlan candidate;
    if (layoutAtlas(request.glyphCount, cellWidth, cellHeight, request.maxTextureSize,
                    candidate)) {
      candidate.rasterScale = scale;
      plan = candidate;
      return Status::success();
    }
    // Texture-limit fallback: a coarser raster keeps text visible instead of
    // failing on a small GPU; scale 1 (or a ratio below 1) is the last attempt.
    if (scale <= 1.0) {
      return Status::failure("glyph atlas exceeds the maximum texture size");
    }
    scale = std::max(1.0, scale / 2.0);
  }
}

Status GlyphAtlas::load(std::uint32_t width, std::uint32_t height, double rasterScale,
                        std::uint32_t maxTextureSize, const std::uint8_t* rgba,
                        std::size_t byteLength, const float* metrics, std::uint32_t glyphCount) {
  if (!isPowerOfTwo(width) || !isPowerOfTwo(height)) {
    return Status::failure("atlas size must be a power of two");
  }
  if (maxTextureSize == 0 || width > maxTextureSize || height > maxTextureSize) {
    return Status::failure("atlas size exceeds the maximum texture size");
  }
  if (!std::isfinite(rasterScale) || rasterScale <= 0.0 || rasterScale > kMaxDevicePixelRatio) {
    return Status::failure("atlas raster scale must be finite and in (0, 8]");
  }
  if (rgba == nullptr ||
      byteLength != static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4U) {
    return Status::failure("atlas pixels must be width * height * 4 RGBA bytes");
  }
  if (metrics == nullptr || glyphCount == 0 || glyphCount > kMaxAtlasGlyphs) {
    return Status::failure("atlas glyph count is outside 1 ... 4096");
  }

  std::vector<Glyph> glyphs;
  glyphs.reserve(glyphCount);
  const auto scale = static_cast<float>(rasterScale);
  for (std::uint32_t index = 0; index < glyphCount; ++index) {
    const float* entry = metrics + static_cast<std::size_t>(index) * kGlyphMetricsStride;
    for (std::size_t field = 0; field < kGlyphMetricsStride; ++field) {
      if (!finite(entry[field])) {
        return Status::failure("glyph metrics must be finite");
      }
    }
    const float role = entry[0];
    const float codePoint = entry[1];
    if (role < 0.0F || role >= static_cast<float>(kTextRoleCount) || std::floor(role) != role) {
      return Status::failure("glyph role is unknown");
    }
    if (codePoint < 0.0F || codePoint > static_cast<float>(kMaxCodePoint) ||
        std::floor(codePoint) != codePoint) {
      return Status::failure("glyph code point is outside U+0000 ... U+10FFFF");
    }
    Glyph glyph;
    glyph.role = static_cast<std::uint32_t>(role);
    glyph.codePoint = static_cast<std::uint32_t>(codePoint);
    glyph.atlasX = entry[2];
    glyph.atlasY = entry[3];
    glyph.width = entry[4];
    glyph.height = entry[5];
    if (glyph.atlasX < 0.0F || glyph.atlasY < 0.0F || glyph.width < 0.0F ||
        glyph.height < 0.0F || glyph.atlasX + glyph.width > static_cast<float>(width) ||
        glyph.atlasY + glyph.height > static_cast<float>(height)) {
      return Status::failure("glyph rectangle lies outside the atlas");
    }
    if (entry[8] < 0.0F) {
      return Status::failure("glyph advance must not be negative");
    }
    glyph.bearingX = entry[6] / scale;
    glyph.bearingY = entry[7] / scale;
    glyph.cssWidth = glyph.width / scale;
    glyph.cssHeight = glyph.height / scale;
    glyph.advance = entry[8] / scale;
    glyphs.push_back(glyph);
  }
  std::sort(glyphs.begin(), glyphs.end(), glyphLess);
  for (std::size_t index = 1; index < glyphs.size(); ++index) {
    if (glyphs[index - 1].role == glyphs[index].role &&
        glyphs[index - 1].codePoint == glyphs[index].codePoint) {
      return Status::failure("glyph metrics contain a duplicate code point");
    }
  }
  for (std::uint32_t role = 0; role < kTextRoleCount; ++role) {
    Glyph key;
    key.role = role;
    key.codePoint = kPlaceholderCodePoint;
    if (!std::binary_search(glyphs.begin(), glyphs.end(), key, glyphLess)) {
      return Status::failure("glyph atlas lacks a placeholder for a text role");
    }
  }

  pixels_.assign(rgba, rgba + byteLength);
  glyphs_ = std::move(glyphs);
  width_ = width;
  height_ = height;
  rasterScale_ = rasterScale;
  ++generation_;
  return Status::success();
}

bool GlyphAtlas::contains(std::uint32_t role, std::uint32_t codePoint) const {
  Glyph key;
  key.role = role;
  key.codePoint = codePoint;
  return std::binary_search(glyphs_.begin(), glyphs_.end(), key, glyphLess);
}

const Glyph* GlyphAtlas::resolve(std::uint32_t role, std::uint32_t codePoint) const {
  if (glyphs_.empty() || role >= kTextRoleCount) {
    return nullptr;
  }
  Glyph key;
  key.role = role;
  key.codePoint = codePoint;
  auto found = std::lower_bound(glyphs_.begin(), glyphs_.end(), key, glyphLess);
  if (found != glyphs_.end() && found->role == role && found->codePoint == codePoint) {
    return &*found;
  }
  key.codePoint = kPlaceholderCodePoint;
  found = std::lower_bound(glyphs_.begin(), glyphs_.end(), key, glyphLess);
  return &*found;  // load() guarantees one placeholder per role
}

namespace {

// Comparisons of summed advances tolerate rounding so a line that is exactly
// the box width still fits.
constexpr double kLayoutEpsilon = 1e-9;

double advanceOf(const GlyphAtlas& atlas, std::uint32_t role, std::uint32_t codePoint) {
  const Glyph* glyph = atlas.resolve(role, codePoint);
  return glyph == nullptr ? 0.0 : static_cast<double>(glyph->advance);
}

double widthOf(const GlyphAtlas& atlas, std::uint32_t role,
               const std::vector<std::uint32_t>& codePoints) {
  double width = 0.0;
  for (const std::uint32_t codePoint : codePoints) {
    width += advanceOf(atlas, role, codePoint);
  }
  return width;
}

// U+2026 when the atlas has it, otherwise three full stops when it has those,
// otherwise U+2026 anyway, which then draws the role's placeholder box.
std::vector<std::uint32_t> ellipsisFor(const GlyphAtlas& atlas, std::uint32_t role) {
  if (!atlas.contains(role, kEllipsisCodePoint) && atlas.contains(role, kFullStopCodePoint)) {
    return {kFullStopCodePoint, kFullStopCodePoint, kFullStopCodePoint};
  }
  return {kEllipsisCodePoint};
}

void dropTrailingSpaces(std::vector<std::uint32_t>& codePoints) {
  while (!codePoints.empty() && codePoints.back() == kSpaceCodePoint) {
    codePoints.pop_back();
  }
}

// One line cut to `width` with an ellipsis. `force` ends the line with the
// ellipsis even when it would fit (more lines follow that are clipped). Returns
// the drawn code points; empty when not even the ellipsis fits.
std::vector<std::uint32_t> ellipsize(const GlyphAtlas& atlas, std::uint32_t role,
                                     const std::vector<std::uint32_t>& line, double width,
                                     bool force) {
  if (!force && widthOf(atlas, role, line) <= width + kLayoutEpsilon) {
    return line;
  }
  const std::vector<std::uint32_t> ellipsis = ellipsisFor(atlas, role);
  const double ellipsisWidth = widthOf(atlas, role, ellipsis);
  if (ellipsisWidth > width + kLayoutEpsilon) {
    return {};
  }
  std::vector<std::uint32_t> drawn;
  double pen = 0.0;
  for (const std::uint32_t codePoint : line) {
    const double advance = advanceOf(atlas, role, codePoint);
    if (pen + advance + ellipsisWidth > width + kLayoutEpsilon) {
      break;
    }
    drawn.push_back(codePoint);
    pen += advance;
  }
  dropTrailingSpaces(drawn);
  drawn.insert(drawn.end(), ellipsis.begin(), ellipsis.end());
  return drawn;
}

// Greedy word wrap: words break at spaces and U+000A, a word wider than the box
// breaks between characters (at least one character per line, so the loop
// always advances). Spaces at the start of a line are dropped, spaces between
// words on one line are kept, trailing spaces are dropped by the caller.
std::vector<std::vector<std::uint32_t>> wrapLines(const GlyphAtlas& atlas, std::uint32_t role,
                                                  const std::uint32_t* codePoints,
                                                  std::uint32_t count, double width) {
  std::vector<std::vector<std::uint32_t>> lines;
  std::vector<std::uint32_t> current;
  std::vector<std::uint32_t> pendingSpaces;
  double currentWidth = 0.0;

  const auto pushCurrent = [&]() {
    dropTrailingSpaces(current);
    lines.push_back(current);
    current.clear();
    pendingSpaces.clear();
    currentWidth = 0.0;
  };

  const auto placeWord = [&](const std::vector<std::uint32_t>& word) {
    const double wordWidth = widthOf(atlas, role, word);
    const double spaceWidth = widthOf(atlas, role, pendingSpaces);
    if (!current.empty() && currentWidth + spaceWidth + wordWidth <= width + kLayoutEpsilon) {
      current.insert(current.end(), pendingSpaces.begin(), pendingSpaces.end());
      current.insert(current.end(), word.begin(), word.end());
      currentWidth += spaceWidth + wordWidth;
      pendingSpaces.clear();
      return;
    }
    if (!current.empty()) {
      pushCurrent();
    }
    pendingSpaces.clear();
    if (wordWidth <= width + kLayoutEpsilon) {
      current = word;
      currentWidth = wordWidth;
      return;
    }
    for (const std::uint32_t codePoint : word) {
      const double advance = advanceOf(atlas, role, codePoint);
      if (!current.empty() && currentWidth + advance > width + kLayoutEpsilon) {
        pushCurrent();
      }
      current.push_back(codePoint);
      currentWidth += advance;
    }
  };

  std::vector<std::uint32_t> word;
  bool lineOpen = false;  // a line feed or content started the current line
  for (std::uint32_t index = 0; index < count; ++index) {
    const std::uint32_t codePoint = codePoints[index];
    if (codePoint == kSpaceCodePoint || codePoint == kLineFeedCodePoint) {
      if (!word.empty()) {
        placeWord(word);
        word.clear();
        lineOpen = true;
      }
      if (codePoint == kLineFeedCodePoint) {
        pushCurrent();
        lineOpen = false;
      } else if (!current.empty()) {
        pendingSpaces.push_back(codePoint);
      }
      continue;
    }
    word.push_back(codePoint);
  }
  if (!word.empty()) {
    placeWord(word);
    lineOpen = true;
  }
  if (lineOpen || !current.empty()) {
    pushCurrent();
  }
  return lines;
}

}  // namespace

Status layoutText(const GlyphAtlas& atlas, std::uint32_t role, TextFlow flow, double boxWidth,
                  double boxHeight, const std::uint32_t* codePoints, std::uint32_t count,
                  TextLayout& out) {
  out = TextLayout{};
  if (role >= kTextRoleCount) {
    return Status::failure("text role is unknown");
  }
  if (static_cast<std::uint32_t>(flow) >= kTextFlowCount) {
    return Status::failure("text flow is unknown");
  }
  if (!std::isfinite(boxWidth) || !std::isfinite(boxHeight) || boxWidth < 0.0 ||
      boxHeight < 0.0) {
    return Status::failure("text box must be finite and not negative");
  }
  if (count > 0 && codePoints == nullptr) {
    return Status::failure("text code points must not be null");
  }
  TextStyle style;
  const Status styleStatus = textStyle(role, style);
  if (!styleStatus) {
    return styleStatus;
  }
  if (!atlas.ready() || count == 0) {
    return Status::success();
  }
  const double lineHeight = style.fontSize * style.lineHeight;

  std::vector<std::vector<std::uint32_t>> lines;
  if (flow == TextFlow::line) {
    lines.emplace_back(codePoints, codePoints + count);
  } else if (flow == TextFlow::ellipsis) {
    // One line: a line feed reads as a space in a title.
    std::vector<std::uint32_t> line(codePoints, codePoints + count);
    std::replace(line.begin(), line.end(), kLineFeedCodePoint, kSpaceCodePoint);
    const double fullWidth = widthOf(atlas, role, line);
    std::vector<std::uint32_t> drawn = ellipsize(atlas, role, line, boxWidth, false);
    out.truncated = fullWidth > boxWidth + kLayoutEpsilon;
    if (!drawn.empty()) {
      lines.push_back(std::move(drawn));
    }
  } else {
    if (boxWidth <= 0.0) {
      out.truncated = true;
      return Status::success();
    }
    lines = wrapLines(atlas, role, codePoints, count, boxWidth);
    const std::size_t maxLines = lineHeight > 0.0
        ? static_cast<std::size_t>(std::floor((boxHeight + kLayoutEpsilon) / lineHeight))
        : 0;
    if (lines.size() > maxLines) {
      out.truncated = true;
      lines.resize(maxLines);
      if (!lines.empty()) {
        lines.back() = ellipsize(atlas, role, lines.back(), boxWidth, true);
      }
    }
  }

  for (std::size_t lineIndex = 0; lineIndex < lines.size(); ++lineIndex) {
    double pen = 0.0;
    const double top = static_cast<double>(lineIndex) * lineHeight;
    for (const std::uint32_t codePoint : lines[lineIndex]) {
      out.glyphs.push_back(GlyphPlacement{codePoint, pen, top});
      pen += advanceOf(atlas, role, codePoint);
    }
    out.width = std::max(out.width, pen);
  }
  out.lines = static_cast<std::uint32_t>(lines.size());
  out.height = static_cast<double>(lines.size()) * lineHeight;
  return Status::success();
}

TextRuns::TextRuns() { runs_.reserve(kMaxTextRuns); }

Status TextRuns::add(double x, double y, std::uint32_t role, const std::uint32_t* codePoints,
                     std::uint32_t count) {
  if (!std::isfinite(x) || !std::isfinite(y)) {
    return Status::failure("text run anchor must be finite");
  }
  if (role >= kTextRoleCount) {
    return Status::failure("text role is unknown");
  }
  if (count > 0 && codePoints == nullptr) {
    return Status::failure("text run code points must not be null");
  }
  if (runs_.size() >= kMaxTextRuns) {
    return Status::failure("too many text runs");
  }
  if (glyphTotal_ + count > kMaxGlyphInstances) {
    return Status::failure("too many glyphs in text runs");
  }
  for (std::uint32_t index = 0; index < count; ++index) {
    if (codePoints[index] > kMaxCodePoint) {
      return Status::failure("text run code point is above U+10FFFF");
    }
  }
  TextRun run;
  run.x = x;
  run.y = y;
  run.role = role;
  run.codePoints.assign(codePoints, codePoints + count);
  runs_.push_back(std::move(run));
  glyphTotal_ += count;
  return Status::success();
}

Status TextRuns::add(double x, double y, std::uint32_t role, TextFlow flow, double boxWidth,
                     double boxHeight, const std::uint32_t* codePoints, std::uint32_t count) {
  if (static_cast<std::uint32_t>(flow) >= kTextFlowCount) {
    return Status::failure("text flow is unknown");
  }
  if (!std::isfinite(boxWidth) || !std::isfinite(boxHeight) || boxWidth < 0.0 ||
      boxHeight < 0.0) {
    return Status::failure("text box must be finite and not negative");
  }
  if (flow == TextFlow::line) {
    return add(x, y, role, codePoints, count);
  }
  // The ellipsis may add glyphs that are not code points of the run.
  if (count > kMaxGlyphInstances - kEllipsisGlyphReserve ||
      glyphTotal_ + count + kEllipsisGlyphReserve > kMaxGlyphInstances) {
    return Status::failure("too many glyphs in text runs");
  }
  const Status status = add(x, y, role, codePoints, count);
  if (!status) {
    return status;
  }
  TextRun& run = runs_.back();
  run.flow = flow;
  run.boxWidth = boxWidth;
  run.boxHeight = boxHeight;
  glyphTotal_ += kEllipsisGlyphReserve;
  return Status::success();
}

void TextRuns::clear() {
  runs_.clear();
  glyphTotal_ = 0;
}

GlyphBuffer::GlyphBuffer() { instances_.reserve(kMaxGlyphInstances); }

const std::uint8_t* GlyphBuffer::bytes() const {
  return instances_.empty() ? nullptr : reinterpret_cast<const std::uint8_t*>(instances_.data());
}

std::size_t GlyphBuffer::byteSize() const { return instances_.size() * sizeof(GlyphInstance); }

Status GlyphBuffer::build(const TextRuns& runs, const GlyphAtlas& atlas, const Camera& camera,
                          double viewportWidth, double viewportHeight,
                          std::vector<std::uint32_t>* runGlyphCounts) {
  instances_.clear();
  if (runGlyphCounts != nullptr) {
    runGlyphCounts->clear();
  }
  if (!std::isfinite(viewportWidth) || !std::isfinite(viewportHeight) || viewportWidth <= 0.0 ||
      viewportHeight <= 0.0) {
    return Status::failure("viewport must be positive and finite");
  }
  if (!atlas.ready()) {
    return Status::success();
  }
  const double zoom = camera.zoom();
  const double inverseWidth = 1.0 / static_cast<double>(atlas.width());
  const double inverseHeight = 1.0 / static_cast<double>(atlas.height());
  const Bounds viewport{0.0, 0.0, viewportWidth, viewportHeight};
  const auto pushQuad = [&](const Glyph& glyph, const Bounds& quad) {
    if (glyph.width <= 0.0F || glyph.height <= 0.0F || !quad.intersects(viewport) ||
        instances_.size() >= kMaxGlyphInstances) {
      return;
    }
    GlyphInstance instance;
    instance.x = static_cast<float>(quad.x);
    instance.y = static_cast<float>(quad.y);
    instance.width = static_cast<float>(quad.width);
    instance.height = static_cast<float>(quad.height);
    instance.u0 = static_cast<float>(static_cast<double>(glyph.atlasX) * inverseWidth);
    instance.v0 = static_cast<float>(static_cast<double>(glyph.atlasY) * inverseHeight);
    instance.u1 =
        static_cast<float>(static_cast<double>(glyph.atlasX + glyph.width) * inverseWidth);
    instance.v1 =
        static_cast<float>(static_cast<double>(glyph.atlasY + glyph.height) * inverseHeight);
    instances_.push_back(instance);
  };
  for (const TextRun& run : runs.runs()) {
    const std::size_t runStart = instances_.size();
    if (run.flow != TextFlow::line) {
      // Laid out once per atlas generation; zoom and pan only map the result.
      if (run.layoutGeneration != atlas.generation()) {
        const Status status = layoutText(atlas, run.role, run.flow, run.boxWidth, run.boxHeight,
                                         run.codePoints.data(),
                                         static_cast<std::uint32_t>(run.codePoints.size()),
                                         run.layout);
        if (!status) {
          instances_.clear();
          if (runGlyphCounts != nullptr) {
            runGlyphCounts->clear();
          }
          return status;
        }
        run.layoutGeneration = atlas.generation();
      }
      for (const GlyphPlacement& placement : run.layout.glyphs) {
        const Glyph* glyph = atlas.resolve(run.role, placement.codePoint);
        if (glyph == nullptr) {
          break;
        }
        const Point topLeft = camera.worldToScreen(
            Point{run.x + placement.x + static_cast<double>(glyph->bearingX),
                  run.y + placement.y + static_cast<double>(glyph->bearingY)});
        pushQuad(*glyph, Bounds{topLeft.x, topLeft.y, static_cast<double>(glyph->cssWidth) * zoom,
                                static_cast<double>(glyph->cssHeight) * zoom});
      }
      if (runGlyphCounts != nullptr) {
        runGlyphCounts->push_back(static_cast<std::uint32_t>(instances_.size() - runStart));
      }
      continue;
    }
    double pen = run.x;
    for (const std::uint32_t codePoint : run.codePoints) {
      const Glyph* glyph = atlas.resolve(run.role, codePoint);
      if (glyph == nullptr) {
        break;
      }
      const Point topLeft = camera.worldToScreen(
          Point{pen + static_cast<double>(glyph->bearingX),
                run.y + static_cast<double>(glyph->bearingY)});
      const Bounds quad{topLeft.x, topLeft.y, static_cast<double>(glyph->cssWidth) * zoom,
                        static_cast<double>(glyph->cssHeight) * zoom};
      pen += static_cast<double>(glyph->advance);
      if (glyph->width <= 0.0F || glyph->height <= 0.0F || !quad.intersects(viewport)) {
        continue;
      }
      GlyphInstance instance;
      instance.x = static_cast<float>(quad.x);
      instance.y = static_cast<float>(quad.y);
      instance.width = static_cast<float>(quad.width);
      instance.height = static_cast<float>(quad.height);
      instance.u0 = static_cast<float>(static_cast<double>(glyph->atlasX) * inverseWidth);
      instance.v0 = static_cast<float>(static_cast<double>(glyph->atlasY) * inverseHeight);
      instance.u1 = static_cast<float>(static_cast<double>(glyph->atlasX + glyph->width) *
                                       inverseWidth);
      instance.v1 = static_cast<float>(static_cast<double>(glyph->atlasY + glyph->height) *
                                       inverseHeight);
      instances_.push_back(instance);
    }
    if (runGlyphCounts != nullptr) {
      runGlyphCounts->push_back(static_cast<std::uint32_t>(instances_.size() - runStart));
    }
  }
  return Status::success();
}

}  // namespace air::engine
