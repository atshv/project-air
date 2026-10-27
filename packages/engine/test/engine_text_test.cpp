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
  if (air::engine::test::failures != 0) {
    std::fprintf(stderr, "%d text check(s) failed\n", air::engine::test::failures);
    return 1;
  }
  std::printf("engine text tests passed\n");
  return 0;
}
