// Native suite of the runtime glyph atlas (P4-08, L02, ADR-0009): token styles,
// atlas planning with the texture-limit fallback, upload validation,
// DPR-independent CSS metrics, the missing-glyph placeholder and the glyph
// command buffer.

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <string_view>
#include <vector>

#include "engine/camera.h"
#include "engine/status.h"
#include "engine/text.h"
#include "engine/text_gl.h"
#include "test_support.h"
#include "tokens.h"

namespace {

using air::engine::AtlasPlan;
using air::engine::AtlasRequest;
using air::engine::Camera;
using air::engine::Glyph;
using air::engine::GlyphAtlas;
using air::engine::GlyphBuffer;
using air::engine::GlyphInstance;
using air::engine::kGlyphMetricsStride;
using air::engine::kMaxGlyphInstances;
using air::engine::kPlaceholderCodePoint;
using air::engine::kTextRoleCount;
using air::engine::planAtlas;
using air::engine::Status;
using air::engine::TextRole;
using air::engine::TextRuns;
using air::engine::TextStyle;

namespace test = air::engine::test;

constexpr std::uint32_t kTitle = static_cast<std::uint32_t>(TextRole::title);
constexpr std::uint32_t kBody = static_cast<std::uint32_t>(TextRole::body);
constexpr std::uint32_t kMaxTexture = 4096;

// A synthetic upload the way the bridge builds it: uniform cells in plan order,
// one placeholder per role first, then the requested code points; every glyph
// is a full cell whose bitmap starts one padding pixel before the pen. Metrics
// are raster px; the CSS advance per code point is fixed so DPR checks compare
// like with like.
struct Upload {
  AtlasPlan plan;
  std::vector<std::uint8_t> pixels;
  std::vector<float> metrics;
  std::uint32_t glyphCount{0};
};

double cssAdvance(std::uint32_t codePoint) { return codePoint == ' ' ? 4.0 : 8.0 + codePoint % 3; }

Upload makeUpload(const std::vector<std::uint32_t>& codePoints, double dpr,
                  std::uint32_t maxTexture = kMaxTexture) {
  Upload upload;
  AtlasRequest request;
  request.glyphCount = static_cast<std::uint32_t>(kTextRoleCount * (codePoints.size() + 1));
  request.cellWidth = 12.0;
  request.cellHeight = 21.0;
  request.devicePixelRatio = dpr;
  request.maxTextureSize = maxTexture;
  const Status status = planAtlas(request, upload.plan);
  test::expect(status.ok, "synthetic atlas plan succeeds");
  const AtlasPlan& plan = upload.plan;
  upload.pixels.assign(static_cast<std::size_t>(plan.width) * plan.height * 4U, 0);
  const auto scale = static_cast<float>(plan.rasterScale);
  std::uint32_t cell = 0;
  for (std::uint32_t role = 0; role < kTextRoleCount; ++role) {
    std::vector<std::uint32_t> all{kPlaceholderCodePoint};
    all.insert(all.end(), codePoints.begin(), codePoints.end());
    for (const std::uint32_t codePoint : all) {
      const float x = static_cast<float>((cell % plan.columns) * plan.cellWidth);
      const float y = static_cast<float>((cell / plan.columns) * plan.cellHeight);
      const float advance =
          static_cast<float>(codePoint == kPlaceholderCodePoint ? 10.0 : cssAdvance(codePoint));
      const float values[kGlyphMetricsStride] = {static_cast<float>(role),
                                                 static_cast<float>(codePoint),
                                                 x,
                                                 y,
                                                 static_cast<float>(plan.cellWidth),
                                                 static_cast<float>(plan.cellHeight),
                                                 -1.0F,
                                                 -1.0F,
                                                 advance * scale};
      upload.metrics.insert(upload.metrics.end(), values, values + kGlyphMetricsStride);
      // Mark the cell's first pixel so a pixel copy is observable.
      upload.pixels[(static_cast<std::size_t>(y) * plan.width + static_cast<std::size_t>(x)) * 4U +
                    3U] = static_cast<std::uint8_t>(cell % 251U + 1U);
      ++cell;
    }
  }
  upload.glyphCount = cell;
  return upload;
}

Status loadUpload(GlyphAtlas& atlas, const Upload& upload) {
  return atlas.load(upload.plan.width, upload.plan.height, upload.plan.rasterScale, kMaxTexture,
                    upload.pixels.data(), upload.pixels.size(), upload.metrics.data(),
                    upload.glyphCount);
}

std::vector<std::uint32_t> ascii() {
  std::vector<std::uint32_t> codePoints;
  for (std::uint32_t codePoint = 0x20; codePoint <= 0x7E; ++codePoint) {
    codePoints.push_back(codePoint);
  }
  return codePoints;
}

void testStylesFromTokens() {
  test::section("text styles come from tokens.h");
  TextStyle title;
  test::expect(air::engine::textStyle(kTitle, title).ok, "title style resolves");
  test::expect(std::string_view(title.fontFamily) == tokens::font_sans, "title uses font_sans");
  test::expect(title.fontSize == tokens::text_15, "title size is text_15 (L02 15 px)");
  test::expect(title.fontWeight == tokens::weight_semibold, "title weight is 600");
  test::expect(title.lineHeight == tokens::line_height, "title line height token");
  TextStyle body;
  test::expect(air::engine::textStyle(kBody, body).ok, "body style resolves");
  test::expect(body.fontSize == tokens::text_13, "body size is text_13");
  test::expect(body.fontWeight == tokens::weight_regular, "body weight is 400");
  TextStyle unknown;
  test::expect(!air::engine::textStyle(kTextRoleCount, unknown).ok, "unknown role fails");

  double out[3] = {};
  test::expect(engine_text_style(0, out) == 1, "C ABI title style succeeds");
  test::expect(out[0] == tokens::text_15 && out[1] == 600.0 && out[2] == tokens::line_height,
               "C ABI returns size, weight and line height");
  test::expect(engine_text_style(7, out) == 0 && engine_text_style(-1, out) == 0,
               "C ABI rejects unknown roles");
  test::expect(std::string_view(engine_text_font_family(1)) == tokens::font_sans,
               "C ABI font family is the token stack");
  test::expect(std::string_view(engine_text_font_family(9)).empty(),
               "C ABI font family of an unknown role is empty, not null");
}

void testPlanFitsAtEachRatio() {
  test::section("atlas plan fits at DPR 1, 2 and 3");
  for (const double dpr : {1.0, 2.0, 3.0}) {
    AtlasRequest request{392, 12.0, 21.0, dpr, kMaxTexture};
    AtlasPlan plan;
    test::expect(planAtlas(request, plan).ok, "plan succeeds");
    test::expect(plan.rasterScale == dpr, "raster scale equals the device pixel ratio");
    test::expect((plan.width & (plan.width - 1U)) == 0 && (plan.height & (plan.height - 1U)) == 0,
                 "atlas sides are powers of two");
    test::expect(plan.width <= kMaxTexture && plan.height <= kMaxTexture, "atlas fits the limit");
    test::expect(plan.cellWidth == static_cast<std::uint32_t>(std::ceil(12.0 * dpr)) + 2U,
                 "cell width includes one padding px per side");
    test::expect(plan.cellHeight == static_cast<std::uint32_t>(std::ceil(21.0 * dpr)) + 2U,
                 "cell height includes one padding px per side");
    test::expect(static_cast<std::uint64_t>(plan.columns) * plan.rows >= 392U,
                 "grid holds every glyph");
    test::expect(plan.columns * plan.cellWidth <= plan.width &&
                     plan.rows * plan.cellHeight <= plan.height,
                 "cells stay inside the atlas");
  }
  AtlasRequest request{392, 12.0, 21.0, 2.0, kMaxTexture};
  AtlasPlan first;
  AtlasPlan second;
  test::expect(planAtlas(request, first).ok && planAtlas(request, second).ok, "plans succeed");
  test::expect(std::memcmp(&first, &second, sizeof(AtlasPlan)) == 0, "plan is deterministic");
}

void testPlanTextureLimitFallback() {
  test::section("texture-limit fallback halves the raster scale");
  // 392 cells of 12x21 CSS px: at scale 3 a cell is 38x65 raster px; a 512 px
  // limit only holds the set at scale 1.
  AtlasRequest request{392, 12.0, 21.0, 3.0, 512};
  AtlasPlan plan;
  test::expect(planAtlas(request, plan).ok, "small limit still plans");
  test::expect(plan.rasterScale == 1.0, "scale 3 falls back to 1.5, then to the floor 1");
  test::expect(plan.width <= 512 && plan.height <= 512, "fallback atlas fits the limit");

  request.devicePixelRatio = 4.0;
  request.maxTextureSize = 1024;
  test::expect(planAtlas(request, plan).ok, "scale 4 with a 1024 limit plans");
  test::expect(plan.rasterScale == 2.0, "scale 4 halves once to 2");

  AtlasPlan untouched;
  untouched.width = 77;
  request.maxTextureSize = 64;
  request.devicePixelRatio = 2.0;
  test::expect(!planAtlas(request, untouched).ok, "no fit at scale 1 fails");
  test::expect(untouched.width == 77, "a failed plan leaves the output untouched");
  request.maxTextureSize = 8;
  request.glyphCount = 1;
  test::expect(!planAtlas(request, untouched).ok, "limit below one cell fails");
  // A fractional ratio below 1 is a valid raster scale but is never halved.
  request = AtlasRequest{10, 12.0, 21.0, 0.5, 64};
  test::expect(planAtlas(request, plan).ok && plan.rasterScale == 0.5, "DPR 0.5 plans at 0.5");
}

void testPlanRejectsInvalidInput() {
  test::section("atlas plan rejects invalid input");
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  AtlasPlan plan;
  const AtlasRequest base{100, 12.0, 21.0, 2.0, kMaxTexture};
  for (const double dpr : {0.0, -1.0, nan, inf, 8.5}) {
    AtlasRequest request = base;
    request.devicePixelRatio = dpr;
    test::expect(!planAtlas(request, plan).ok, "invalid device pixel ratio fails");
  }
  AtlasRequest request = base;
  request.devicePixelRatio = 8.0;
  test::expect(planAtlas(request, plan).ok, "DPR 8 is the inclusive upper bound");
  for (const double cell : {0.0, -3.0, nan, inf, 600.0}) {
    request = base;
    request.cellWidth = cell;
    test::expect(!planAtlas(request, plan).ok, "invalid cell width fails");
    request = base;
    request.cellHeight = cell;
    test::expect(!planAtlas(request, plan).ok, "invalid cell height fails");
  }
  request = base;
  request.glyphCount = 0;
  test::expect(!planAtlas(request, plan).ok, "zero glyphs fail");
  request.glyphCount = 5000;
  test::expect(!planAtlas(request, plan).ok, "more than 4096 glyphs fail");
  request = base;
  request.maxTextureSize = 0;
  test::expect(!planAtlas(request, plan).ok, "zero texture limit fails");

  double out[7] = {};
  test::expect(engine_text_plan_atlas(392, 12.0, 21.0, 3.0, 512, out) == 1,
               "C ABI plan succeeds");
  test::expect(out[6] == 1.0 && out[0] <= 512.0 && out[1] <= 512.0,
               "C ABI reports the fallback scale and size");
  test::expect(engine_text_plan_atlas(-1, 12.0, 21.0, 1.0, 512, out) == 0,
               "C ABI rejects a negative glyph count");
  test::expect(engine_text_plan_atlas(10, 12.0, 21.0, 1.0, -5, out) == 0,
               "C ABI rejects a negative texture limit");
}

void testUploadAccepted() {
  test::section("atlas upload is validated and copied");
  const Upload upload = makeUpload(ascii(), 2.0);
  GlyphAtlas atlas;
  test::expect(!atlas.ready() && atlas.generation() == 0, "a new atlas is empty");
  test::expect(atlas.resolve(kTitle, 'A') == nullptr, "an empty atlas resolves nothing");
  test::expect(loadUpload(atlas, upload).ok, "valid upload succeeds");
  test::expect(atlas.ready() && atlas.generation() == 1, "upload increments the generation");
  test::expect(atlas.glyphCount() == upload.glyphCount, "every glyph is stored");
  test::expect(atlas.width() == upload.plan.width && atlas.height() == upload.plan.height,
               "atlas size is kept");
  test::expect(atlas.pixels() == upload.pixels, "atlas pixels are copied byte for byte");
  test::expect(atlas.contains(kTitle, 'A') && atlas.contains(kBody, '~'),
               "both roles hold the glyph set");
  test::expect(atlas.contains(kTitle, kPlaceholderCodePoint), "placeholder is stored");
}

void testUploadRejected() {
  test::section("atlas upload rejections keep the previous atlas");
  const Upload good = makeUpload(ascii(), 1.0);
  GlyphAtlas atlas;
  test::expect(loadUpload(atlas, good).ok, "baseline upload succeeds");
  const std::uint64_t generation = atlas.generation();
  const std::size_t glyphCount = atlas.glyphCount();

  const auto expectRejected = [&](const Upload& upload, std::string_view what) {
    test::expect(!loadUpload(atlas, upload).ok, what);
    test::expect(atlas.generation() == generation && atlas.glyphCount() == glyphCount &&
                     atlas.pixels() == good.pixels,
                 "rejected upload leaves the atlas untouched");
  };

  Upload upload = good;
  upload.pixels.pop_back();
  expectRejected(upload, "short pixel buffer fails");

  upload = good;
  upload.metrics[kGlyphMetricsStride + 1] = upload.metrics[1];  // duplicate placeholder
  expectRejected(upload, "duplicate code point fails");

  upload = good;
  // Remove the title placeholder: the first glyph becomes an unused code point.
  upload.metrics[1] = static_cast<float>('Z' + 100);
  expectRejected(upload, "missing placeholder fails");

  upload = good;
  upload.metrics[2] = static_cast<float>(good.plan.width);  // atlasX past the edge
  expectRejected(upload, "glyph rectangle outside the atlas fails");

  upload = good;
  upload.metrics[8] = -1.0F;
  expectRejected(upload, "negative advance fails");

  upload = good;
  upload.metrics[6] = std::numeric_limits<float>::quiet_NaN();
  expectRejected(upload, "non-finite bearing fails");

  upload = good;
  upload.metrics[0] = 5.0F;
  expectRejected(upload, "unknown role fails");

  upload = good;
  upload.metrics[1] = 0x110000;
  expectRejected(upload, "code point above U+10FFFF fails");

  upload = good;
  upload.metrics[1] = 65.5F;
  expectRejected(upload, "fractional code point fails");

  test::expect(!atlas.load(good.plan.width + 1, good.plan.height, 1.0, kMaxTexture,
                           good.pixels.data(), good.pixels.size(), good.metrics.data(),
                           good.glyphCount)
                    .ok,
               "non-power-of-two width fails");
  test::expect(!atlas.load(good.plan.width, good.plan.height, 1.0, good.plan.width / 2,
                           good.pixels.data(), good.pixels.size(), good.metrics.data(),
                           good.glyphCount)
                    .ok,
               "atlas above the texture limit fails");
  test::expect(!atlas.load(good.plan.width, good.plan.height, 0.0, kMaxTexture,
                           good.pixels.data(), good.pixels.size(), good.metrics.data(),
                           good.glyphCount)
                    .ok,
               "zero raster scale fails");
  test::expect(!atlas.load(good.plan.width, good.plan.height, 1.0, kMaxTexture, nullptr,
                           good.pixels.size(), good.metrics.data(), good.glyphCount)
                    .ok,
               "null pixels fail");
  test::expect(!atlas.load(good.plan.width, good.plan.height, 1.0, kMaxTexture,
                           good.pixels.data(), good.pixels.size(), nullptr, good.glyphCount)
                    .ok,
               "null metrics fail");
  test::expect(atlas.generation() == generation, "generation unchanged after rejections");
}

void testCssMetricsIndependentOfDpr() {
  test::section("glyph metrics in CSS px are equal across DPR 1, 2 and 3");
  GlyphAtlas reference;
  test::expect(loadUpload(reference, makeUpload(ascii(), 1.0)).ok, "DPR 1 upload succeeds");
  for (const double dpr : {2.0, 3.0}) {
    GlyphAtlas atlas;
    test::expect(loadUpload(atlas, makeUpload(ascii(), dpr)).ok, "upload succeeds");
    test::expect(atlas.rasterScale() == dpr, "raster scale is kept");
    for (const std::uint32_t codePoint : {static_cast<std::uint32_t>('A'),
                                          static_cast<std::uint32_t>(' '),
                                          static_cast<std::uint32_t>('~')}) {
      const Glyph* expected = reference.resolve(kTitle, codePoint);
      const Glyph* actual = atlas.resolve(kTitle, codePoint);
      test::expect(expected != nullptr && actual != nullptr, "glyph resolves");
      if (expected == nullptr || actual == nullptr) {
        continue;
      }
      test::expectNear(actual->advance, expected->advance, 1e-6, "CSS advance is DPR-free");
      test::expectNear(actual->advance, cssAdvance(codePoint), 1e-6, "CSS advance value");
      test::expectNear(actual->bearingX, -1.0 / dpr, 1e-6, "bearing is raster px / scale");
      test::expectNear(actual->cssHeight, static_cast<double>(actual->height) / dpr, 1e-6,
                       "CSS height is raster height / scale");
      // The padded raster cell covers the same CSS box (within one raster px).
      test::expect(std::fabs(actual->cssHeight - expected->cssHeight) <= 2.0,
                   "cell CSS height stays within the padding");
    }
  }
}

void testMissingGlyphPlaceholder() {
  test::section("a missing code point resolves to the role placeholder");
  GlyphAtlas atlas;
  test::expect(loadUpload(atlas, makeUpload(ascii(), 2.0)).ok, "upload succeeds");
  for (const std::uint32_t codePoint : {0x4E2DU, 0x1F600U, 0xFFFDU, 0xE4U}) {
    test::expect(!atlas.contains(kTitle, codePoint), "code point is not in the ASCII atlas");
    const Glyph* glyph = atlas.resolve(kTitle, codePoint);
    test::expect(glyph != nullptr && glyph->codePoint == kPlaceholderCodePoint &&
                     glyph->role == kTitle,
                 "resolves to the title placeholder");
    test::expect(glyph != nullptr && glyph->width > 0.0F && glyph->height > 0.0F,
                 "placeholder is a visible box, not a gap");
  }
  const Glyph* body = atlas.resolve(kBody, 0x4E2DU);
  test::expect(body != nullptr && body->role == kBody, "body falls back to its own placeholder");
  test::expect(atlas.resolve(kTextRoleCount, 'A') == nullptr, "unknown role resolves nothing");
}

void testRunsValidation() {
  test::section("text runs validate before storing");
  TextRuns runs;
  const std::uint32_t hello[] = {'H', 'a', 'l', 'l', 'o'};
  test::expect(runs.add(0.0, 0.0, kTitle, hello, 5).ok, "valid run is stored");
  test::expect(runs.add(1.0, 2.0, kBody, nullptr, 0).ok, "empty run is accepted");
  test::expect(runs.runs().size() == 2 && runs.glyphTotal() == 5, "runs and glyphs counted");
  const double nan = std::numeric_limits<double>::quiet_NaN();
  test::expect(!runs.add(nan, 0.0, kTitle, hello, 5).ok, "non-finite anchor fails");
  test::expect(!runs.add(0.0, 0.0, kTextRoleCount, hello, 5).ok, "unknown role fails");
  test::expect(!runs.add(0.0, 0.0, kTitle, nullptr, 3).ok, "null code points fail");
  const std::uint32_t tooHigh[] = {'a', 0x110000U};
  test::expect(!runs.add(0.0, 0.0, kTitle, tooHigh, 2).ok, "code point above U+10FFFF fails");
  std::vector<std::uint32_t> many(kMaxGlyphInstances, 'x');
  test::expect(!runs.add(0.0, 0.0, kTitle, many.data(), kMaxGlyphInstances).ok,
               "glyph total above the limit fails");
  test::expect(runs.runs().size() == 2 && runs.glyphTotal() == 5,
               "rejected runs leave the store untouched");
  runs.clear();
  test::expect(runs.runs().empty() && runs.glyphTotal() == 0, "clear empties the store");
}

void testGlyphBuffer() {
  test::section("glyph buffer places quads by advance, culls and is deterministic");
  const Upload upload = makeUpload(ascii(), 2.0);
  GlyphAtlas atlas;
  test::expect(loadUpload(atlas, upload).ok, "upload succeeds");
  Camera camera;
  test::expect(camera.setView(-100.0, -50.0, 1.0).ok, "camera set");

  TextRuns runs;
  const std::uint32_t text[] = {'A', 0x4E2DU, ' ', 'B'};
  test::expect(runs.add(0.0, 0.0, kTitle, text, 4).ok, "run added");

  GlyphBuffer empty;
  test::expect(empty.build(runs, GlyphAtlas{}, camera, 800.0, 600.0).ok && empty.empty(),
               "no atlas: empty buffer, no failure");

  GlyphBuffer buffer;
  test::expect(buffer.build(runs, atlas, camera, 800.0, 600.0).ok, "build succeeds");
  // ' ' is a full padded cell in the synthetic atlas, so all four glyphs draw.
  test::expect(buffer.size() == 4, "every glyph incl. the placeholder draws");
  if (buffer.size() == 4) {
    const GlyphInstance& first = buffer.instances()[0];
    const double bearing = -1.0 / 2.0;
    test::expectNear(first.x, 100.0 + bearing, 1e-4, "first quad at the run anchor + bearing");
    test::expectNear(first.y, 50.0 + bearing, 1e-4, "first quad top at the line box + bearing");
    const GlyphInstance& second = buffer.instances()[1];
    test::expectNear(second.x - first.x, cssAdvance('A'), 1e-4, "pen advances by the CSS advance");
    const Glyph* placeholder = atlas.resolve(kTitle, kPlaceholderCodePoint);
    test::expectNear(second.u0, placeholder->atlasX / static_cast<float>(atlas.width()), 1e-6,
                     "missing glyph samples the placeholder cell");
    const GlyphInstance& fourth = buffer.instances()[3];
    test::expectNear(fourth.x - first.x, cssAdvance('A') + 10.0 + cssAdvance(' '), 1e-4,
                     "placeholder advance and space advance are applied");
    test::expect(first.u0 >= 0.0F && first.u1 <= 1.0F && first.v0 >= 0.0F && first.v1 <= 1.0F &&
                     first.u0 < first.u1 && first.v0 < first.v1,
                 "UVs are normalised inside the atlas");
  }

  GlyphBuffer again;
  test::expect(again.build(runs, atlas, camera, 800.0, 600.0).ok, "rebuild succeeds");
  test::expect(again.byteSize() == buffer.byteSize() &&
                   std::memcmp(again.bytes(), buffer.bytes(), buffer.byteSize()) == 0,
               "identical input gives byte-identical glyph records");

  test::expect(camera.setView(-100.0, -50.0, 2.0).ok, "zoom 2");
  test::expect(again.build(runs, atlas, camera, 800.0, 600.0).ok, "zoomed build succeeds");
  if (again.size() == 4 && buffer.size() == 4) {
    test::expectNear(again.instances()[0].width, buffer.instances()[0].width * 2.0, 1e-4,
                     "quads scale with the zoom");
  }

  test::expect(camera.setView(10000.0, 10000.0, 1.0).ok, "camera far away");
  test::expect(again.build(runs, atlas, camera, 800.0, 600.0).ok && again.empty(),
               "a run outside the viewport is culled");

  test::expect(!again.build(runs, atlas, camera, 0.0, 600.0).ok && again.empty(),
               "zero viewport fails and leaves the buffer empty");
  test::expect(!again.build(runs, atlas, camera, std::numeric_limits<double>::infinity(), 1.0).ok,
               "non-finite viewport fails");

  // A replaced atlas re-resolves existing runs: the same runs now sample the
  // new table.
  GlyphAtlas replaced;
  test::expect(loadUpload(replaced, makeUpload(ascii(), 1.0)).ok, "replacement upload");
  test::expect(camera.setView(-100.0, -50.0, 1.0).ok, "camera reset");
  test::expect(again.build(runs, replaced, camera, 800.0, 600.0).ok && again.size() == 4,
               "runs re-resolve against a replaced atlas");
  if (again.size() == 4 && buffer.size() == 4) {
    test::expectNear(again.instances()[1].x - again.instances()[0].x,
                     buffer.instances()[1].x - buffer.instances()[0].x, 1e-4,
                     "CSS layout is the same for a DPR 1 and a DPR 2 atlas");
  }

  TextRuns emptyRuns;
  test::expect(again.build(emptyRuns, atlas, camera, 800.0, 600.0).ok && again.empty(),
               "no runs draw nothing");
}

void testNativeStubs() {
  test::section("renderer-bound C ABI calls are stubs in the native build");
  test::expect(engine_text_max_texture_size() == -1, "max texture size is -1 natively");
  test::expect(engine_text_load_atlas(1, 1, 1.0, nullptr, 0, nullptr, 0) == 0, "load is a stub");
  test::expect(engine_text_add_run(0.0, 0.0, 0, nullptr, 0) == 0, "add run is a stub");
  test::expect(engine_text_clear_runs() == 0, "clear runs is a stub");
  test::expect(engine_visible_glyph_count() == -1, "glyph count is -1 natively");
}

}  // namespace

// ---------------------------------------------------------------------------
// Layout (P4-09, L02): synthetic advances are 9 for 'a', 10 for 'b', 8 for 'c',
// 4 for a space, 9 for U+2026 and for '.', and 10 for the placeholder.

using air::engine::GlyphPlacement;
using air::engine::kEllipsisCodePoint;
using air::engine::layoutText;
using air::engine::TextFlow;
using air::engine::TextLayout;

std::vector<std::uint32_t> codes(std::string_view text) {
  std::vector<std::uint32_t> out;
  for (const char character : text) {
    out.push_back(static_cast<std::uint32_t>(static_cast<unsigned char>(character)));
  }
  return out;
}

std::vector<std::uint32_t> withEllipsis() {
  std::vector<std::uint32_t> set = ascii();
  set.push_back(kEllipsisCodePoint);
  return set;
}

TextLayout layoutOf(const GlyphAtlas& atlas, TextFlow flow, double width, double height,
                    std::string_view text, std::uint32_t role = kBody) {
  const std::vector<std::uint32_t> points = codes(text);
  TextLayout layout;
  const Status status = layoutText(atlas, role, flow, width, height, points.data(),
                                   static_cast<std::uint32_t>(points.size()), layout);
  test::expect(status.ok, "layoutText succeeds");
  return layout;
}

std::vector<std::uint32_t> drawnCodes(const TextLayout& layout) {
  std::vector<std::uint32_t> out;
  for (const GlyphPlacement& glyph : layout.glyphs) {
    out.push_back(glyph.codePoint);
  }
  return out;
}

double lineHeightOf(std::uint32_t role) {
  TextStyle style;
  const Status status = air::engine::textStyle(role, style);
  test::expect(status.ok, "token style resolves");
  return style.fontSize * style.lineHeight;
}

void testEllipsisFlow() {
  test::section("ellipsis flow: fit, cut, trailing space, fallback, too narrow");
  GlyphAtlas atlas;
  test::expect(loadUpload(atlas, makeUpload(withEllipsis(), 1.0)).ok, "atlas with U+2026 loads");

  TextLayout fits = layoutOf(atlas, TextFlow::ellipsis, 27.0, 0.0, "abc");
  test::expect(drawnCodes(fits) == codes("abc") && !fits.truncated && fits.lines == 1,
               "a run exactly as wide as the box is drawn unchanged");
  test::expectNear(fits.width, 27.0, 1e-9, "the fitting line keeps its width");

  TextLayout cut = layoutOf(atlas, TextFlow::ellipsis, 40.0, 0.0, "aaaaaaaaaa");
  std::vector<std::uint32_t> expected = codes("aaa");
  expected.push_back(kEllipsisCodePoint);
  test::expect(drawnCodes(cut) == expected && cut.truncated, "a long title ends with U+2026");
  test::expect(cut.width <= 40.0, "the cut line plus the ellipsis fits the box");
  test::expectNear(cut.glyphs.back().x, 27.0, 1e-9, "the ellipsis follows the last kept glyph");

  TextLayout spaced = layoutOf(atlas, TextFlow::ellipsis, 31.0, 0.0, "aa aaaa");
  expected = codes("aa");
  expected.push_back(kEllipsisCodePoint);
  test::expect(drawnCodes(spaced) == expected, "a space before the cut is dropped");

  TextLayout narrow = layoutOf(atlas, TextFlow::ellipsis, 5.0, 0.0, "aaaa");
  test::expect(narrow.glyphs.empty() && narrow.truncated && narrow.lines == 0,
               "a box narrower than the ellipsis draws nothing");
  TextLayout zero = layoutOf(atlas, TextFlow::ellipsis, 0.0, 0.0, "a");
  test::expect(zero.glyphs.empty() && zero.truncated, "a zero-width box draws nothing");

  TextLayout feed = layoutOf(atlas, TextFlow::ellipsis, 200.0, 0.0, "a\nb");
  test::expect(drawnCodes(feed) == codes("a b"), "a line feed reads as a space in a title");

  GlyphAtlas stops;
  test::expect(loadUpload(stops, makeUpload(ascii(), 1.0)).ok, "atlas without U+2026 loads");
  TextLayout fallback = layoutOf(stops, TextFlow::ellipsis, 40.0, 0.0, "aaaaaaaaaa");
  test::expect(drawnCodes(fallback) == codes("a..."),
               "without U+2026 the ellipsis is three full stops");

  GlyphAtlas letters;
  test::expect(loadUpload(letters, makeUpload(codes("ab"), 1.0)).ok, "letters-only atlas loads");
  TextLayout boxed = layoutOf(letters, TextFlow::ellipsis, 20.0, 0.0, "aaaa");
  test::expect(boxed.glyphs.size() == 2 && boxed.glyphs.back().codePoint == kEllipsisCodePoint,
               "without U+2026 and '.' the ellipsis draws the placeholder box");
}

void testWrapFlow() {
  test::section("wrap flow: spaces, line feeds, long words, height clip");
  GlyphAtlas atlas;
  test::expect(loadUpload(atlas, makeUpload(withEllipsis(), 1.0)).ok, "atlas loads");
  const double lineHeight = lineHeightOf(kBody);
  const double tall = lineHeight * 10.0;

  TextLayout words = layoutOf(atlas, TextFlow::wrap, 60.0, tall, "aaa aaa aaa");
  test::expect(words.lines == 2 && !words.truncated, "words wrap at the space that overflows");
  test::expect(words.glyphs.size() == 10, "the space at the break is not placed");
  test::expectNear(words.glyphs[7].x, 0.0, 1e-9, "the second line starts at the box edge");
  test::expectNear(words.glyphs[7].y, lineHeight, 1e-9, "the second line is one line height down");
  test::expectNear(words.width, 58.0, 1e-9, "the widest line is 'aaa aaa'");
  test::expectNear(words.height, 2.0 * lineHeight, 1e-9, "the height is two lines");

  TextLayout feeds = layoutOf(atlas, TextFlow::wrap, 200.0, tall, "aa\n\nbb");
  test::expect(feeds.lines == 3, "a line feed breaks and an empty line stays a line");
  test::expectNear(feeds.glyphs.back().y, 2.0 * lineHeight, 1e-9, "the third line is two down");
  TextLayout trailing = layoutOf(atlas, TextFlow::wrap, 200.0, tall, "aa\n");
  test::expect(trailing.lines == 1, "a final line feed adds no empty line");

  TextLayout longWord = layoutOf(atlas, TextFlow::wrap, 40.0, tall, "aaaaaaaaaa");
  test::expect(longWord.lines == 3 && longWord.glyphs.size() == 10,
               "an over-long word breaks between characters (4 + 4 + 2)");

  TextLayout clipped = layoutOf(atlas, TextFlow::wrap, 30.0, 2.0 * lineHeight, "aaa aaa aaa aaa");
  std::vector<std::uint32_t> expected = codes("aaaaa");
  expected.push_back(kEllipsisCodePoint);
  test::expect(clipped.lines == 2 && clipped.truncated, "lines beyond the box height are clipped");
  test::expect(drawnCodes(clipped) == expected,
               "the last visible line ends with U+2026 even when it would fit");
  test::expect(clipped.width <= 30.0, "the clipped block stays inside the box width");

  TextLayout shortBox = layoutOf(atlas, TextFlow::wrap, 100.0, lineHeight * 0.5, "aaa");
  test::expect(shortBox.glyphs.empty() && shortBox.truncated,
               "a box lower than one line draws nothing");
  TextLayout exact = layoutOf(atlas, TextFlow::wrap, 100.0, lineHeight, "aaa");
  test::expect(exact.lines == 1 && !exact.truncated, "a box of exactly one line holds one line");

  TextLayout spaces = layoutOf(atlas, TextFlow::wrap, 100.0, tall, "   ");
  test::expect(spaces.glyphs.empty() && spaces.lines == 0, "a space-only run draws nothing");
  TextLayout doubled = layoutOf(atlas, TextFlow::wrap, 100.0, tall, "a  a");
  test::expect(drawnCodes(doubled) == codes("a  a"), "spaces between words on one line stay");
  TextLayout leading = layoutOf(atlas, TextFlow::wrap, 100.0, tall, "  a");
  test::expect(drawnCodes(leading) == codes("a"), "spaces at the start of a line are dropped");
  TextLayout empty = layoutOf(atlas, TextFlow::wrap, 100.0, tall, "");
  test::expect(empty.glyphs.empty() && empty.lines == 0 && !empty.truncated, "an empty run is empty");
  TextLayout noWidth = layoutOf(atlas, TextFlow::wrap, 0.0, tall, "a");
  test::expect(noWidth.glyphs.empty() && noWidth.truncated, "a zero-width wrap box draws nothing");
}

void testLayoutDprAndValidation() {
  test::section("layout is identical at DPR 1 and 2; invalid input is rejected");
  GlyphAtlas one;
  GlyphAtlas two;
  test::expect(loadUpload(one, makeUpload(withEllipsis(), 1.0)).ok, "DPR 1 atlas loads");
  test::expect(loadUpload(two, makeUpload(withEllipsis(), 2.0)).ok, "DPR 2 atlas loads");
  const std::string_view text = "abc abc abcabcabc ab\nc";
  for (const TextFlow flow : {TextFlow::ellipsis, TextFlow::wrap}) {
    const TextLayout left = layoutOf(one, flow, 45.0, lineHeightOf(kTitle) * 3.0, text, kTitle);
    const TextLayout right = layoutOf(two, flow, 45.0, lineHeightOf(kTitle) * 3.0, text, kTitle);
    bool same = left.glyphs.size() == right.glyphs.size() && left.lines == right.lines;
    for (std::size_t index = 0; same && index < left.glyphs.size(); ++index) {
      same = left.glyphs[index].codePoint == right.glyphs[index].codePoint &&
             std::abs(left.glyphs[index].x - right.glyphs[index].x) < 1e-6 &&
             std::abs(left.glyphs[index].y - right.glyphs[index].y) < 1e-6;
    }
    test::expect(same, "placements in CSS px do not depend on the device pixel ratio");
  }

  const std::vector<std::uint32_t> points = codes("a");
  TextLayout layout;
  test::expect(!layoutText(one, 7, TextFlow::wrap, 10.0, 10.0, points.data(), 1, layout).ok,
               "an unknown role is rejected");
  test::expect(!layoutText(one, kBody, static_cast<TextFlow>(9), 10.0, 10.0, points.data(), 1,
                           layout).ok,
               "an unknown flow is rejected");
  test::expect(!layoutText(one, kBody, TextFlow::wrap, -1.0, 10.0, points.data(), 1, layout).ok,
               "a negative box is rejected");
  test::expect(!layoutText(one, kBody, TextFlow::wrap, std::nan(""), 10.0, points.data(), 1,
                           layout).ok,
               "a NaN box is rejected");
  test::expect(!layoutText(one, kBody, TextFlow::wrap, 10.0, 10.0, nullptr, 1, layout).ok,
               "null code points are rejected");
  GlyphAtlas notReady;
  test::expect(layoutText(notReady, kBody, TextFlow::wrap, 10.0, 10.0, points.data(), 1, layout).ok &&
                   layout.glyphs.empty(),
               "without an atlas the layout is empty and succeeds");

  TextRuns runs;
  test::expect(!runs.add(0.0, 0.0, kBody, static_cast<TextFlow>(3), 1.0, 1.0, points.data(), 1).ok,
               "a run with an unknown flow is rejected");
  test::expect(!runs.add(0.0, 0.0, kBody, TextFlow::ellipsis, -2.0, 1.0, points.data(), 1).ok,
               "a run with a negative box is rejected");
  test::expect(runs.runs().empty() && runs.glyphTotal() == 0, "rejected runs leave the store empty");
  test::expect(runs.add(0.0, 0.0, kBody, TextFlow::ellipsis, 10.0, 0.0, points.data(), 1).ok,
               "a box run is accepted");
  test::expect(runs.glyphTotal() == 1 + air::engine::kEllipsisGlyphReserve,
               "a box run reserves the ellipsis glyphs");
}

void testBoxRunsInGlyphBuffer() {
  test::section("box runs share the glyph buffer; line runs keep their bytes; cache refresh");
  GlyphAtlas atlas;
  test::expect(loadUpload(atlas, makeUpload(withEllipsis(), 1.0)).ok, "atlas loads");
  Camera camera;
  const std::vector<std::uint32_t> points = codes("aaaaaaaaaa");

  TextRuns legacy;
  TextRuns flowed;
  test::expect(legacy.add(16.0, 32.0, kTitle, points.data(), 10).ok, "line run (P4-08 call)");
  test::expect(flowed.add(16.0, 32.0, kTitle, TextFlow::line, 0.0, 0.0, points.data(), 10).ok,
               "line run through the box call");
  GlyphBuffer left;
  GlyphBuffer right;
  test::expect(left.build(legacy, atlas, camera, 800.0, 600.0).ok &&
                   right.build(flowed, atlas, camera, 800.0, 600.0).ok,
               "both line buffers build");
  test::expect(left.byteSize() == right.byteSize() &&
                   std::memcmp(left.bytes(), right.bytes(), left.byteSize()) == 0,
               "the line flow keeps the P4-08 bytes");

  TextRuns boxed;
  test::expect(boxed.add(16.0, 32.0, kTitle, TextFlow::ellipsis, 40.0, 0.0, points.data(), 10).ok,
               "ellipsis run added");
  GlyphBuffer buffer;
  test::expect(buffer.build(boxed, atlas, camera, 800.0, 600.0).ok, "ellipsis buffer builds");
  test::expect(buffer.size() == 4, "three letters and the ellipsis become four quads");
  const std::vector<std::uint8_t> first(buffer.bytes(), buffer.bytes() + buffer.byteSize());
  test::expect(buffer.build(boxed, atlas, camera, 800.0, 600.0).ok, "rebuild succeeds");
  test::expect(std::vector<std::uint8_t>(buffer.bytes(), buffer.bytes() + buffer.byteSize()) == first,
               "identical input gives byte-identical glyph records");
  test::expect(boxed.runs().front().layoutGeneration == atlas.generation(),
               "the run caches its layout for this atlas generation");

  Camera zoomed;
  test::expect(zoomed.setZoom(2.0).ok, "zoom 2 is accepted");
  test::expect(buffer.build(boxed, atlas, zoomed, 800.0, 600.0).ok && buffer.size() == 4,
               "zoom maps the same layout: the line break never changes with zoom");

  GlyphAtlas replacement;
  test::expect(loadUpload(replacement, makeUpload(ascii(), 1.0)).ok, "replacement atlas loads");
  // A second atlas object starts its own generation sequence; load it twice so
  // its generation differs from the cached one.
  test::expect(loadUpload(replacement, makeUpload(ascii(), 1.0)).ok, "replacement reloads");
  test::expect(buffer.build(boxed, replacement, camera, 800.0, 600.0).ok, "rebuild on the new atlas");
  test::expect(boxed.runs().front().layout.glyphs.size() == 4 &&
                   boxed.runs().front().layout.glyphs.back().codePoint == '.',
               "a replaced atlas re-lays the run: three full stops instead of U+2026");
}

int main() {
  testStylesFromTokens();
  testPlanFitsAtEachRatio();
  testPlanTextureLimitFallback();
  testPlanRejectsInvalidInput();
  testUploadAccepted();
  testUploadRejected();
  testCssMetricsIndependentOfDpr();
  testMissingGlyphPlaceholder();
  testRunsValidation();
  testGlyphBuffer();
  testNativeStubs();
  testEllipsisFlow();
  testWrapFlow();
  testLayoutDprAndValidation();
  testBoxRunsInGlyphBuffer();
  if (air::engine::test::failures != 0) {
    std::fprintf(stderr, "%d text check(s) failed\n", air::engine::test::failures);
    return 1;
  }
  std::printf("engine text tests passed\n");
  return 0;
}
