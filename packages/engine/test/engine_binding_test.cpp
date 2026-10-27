// Native suite of the L02 presentation binding (P4-10): token header geometry,
// zone content inset, the ellipsis title and clipped preview placement, block
// growth, culling with the object, the header chrome class, determinism and
// device-pixel-ratio independence.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string_view>
#include <vector>

#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/spatial.h"
#include "engine/status.h"
#include "engine/text.h"
#include "engine/text_binding.h"
#include "test_support.h"
#include "tokens.h"

namespace {

using air::engine::Camera;
using air::engine::ChromeInstance;
using air::engine::Document;
using air::engine::GlyphAtlas;
using air::engine::GlyphBuffer;
using air::engine::kChromeHeaderBand;
using air::engine::kChromeHeaderRule;
using air::engine::kGlyphMetricsStride;
using air::engine::kPlaceholderCodePoint;
using air::engine::kTextRoleCount;
using air::engine::Layer;
using air::engine::ObjectTextBoxes;
using air::engine::objectTextBoxes;
using air::engine::Rectangle;
using air::engine::SpatialIndex;
using air::engine::Status;
using air::engine::TextBindings;
using air::engine::TextFlow;
using air::engine::TextRole;
using air::engine::TextLayout;
using air::engine::TextRuns;
using air::engine::textRequiredHeight;
using air::engine::Tone;

namespace test = air::engine::test;

constexpr std::uint32_t kTitle = static_cast<std::uint32_t>(TextRole::title);
constexpr std::uint32_t kBody = static_cast<std::uint32_t>(TextRole::body);
constexpr std::uint32_t kMaxTexture = 4096;

// Synthetic atlas metrics are fixed in CSS px and scaled by the device pixel
// ratio, so two uploads at different ratios describe the same CSS typography —
// exactly what the bridge measures from the token font stack.
double cssAdvance(std::uint32_t codePoint) {
  if (codePoint == ' ') {
    return 4.0;
  }
  if (codePoint == 0x2026) {
    return 8.0;
  }
  return 8.0 + static_cast<double>(codePoint % 3U);
}

struct Upload {
  air::engine::AtlasPlan plan;
  std::vector<std::uint8_t> pixels;
  std::vector<float> metrics;
  std::uint32_t glyphCount{0};
};

Upload makeUpload(const std::vector<std::uint32_t>& codePoints, double dpr) {
  Upload upload;
  air::engine::AtlasRequest request;
  request.glyphCount = static_cast<std::uint32_t>(kTextRoleCount * (codePoints.size() + 1));
  request.cellWidth = 12.0;
  request.cellHeight = 21.0;
  request.devicePixelRatio = dpr;
  request.maxTextureSize = kMaxTexture;
  const Status status = air::engine::planAtlas(request, upload.plan);
  test::expect(status.ok, "synthetic atlas plan succeeds");
  const air::engine::AtlasPlan& plan = upload.plan;
  upload.pixels.assign(static_cast<std::size_t>(plan.width) * plan.height * 4U, 0);
  const auto scale = static_cast<float>(plan.rasterScale);
  std::uint32_t cell = 0;
  for (std::uint32_t role = 0; role < kTextRoleCount; ++role) {
    std::vector<std::uint32_t> all{kPlaceholderCodePoint};
    all.insert(all.end(), codePoints.begin(), codePoints.end());
    for (const std::uint32_t codePoint : all) {
      const float x = static_cast<float>((cell % plan.columns) * plan.cellWidth);
      const float y = static_cast<float>((cell / plan.columns) * plan.cellHeight);
      const float advance = static_cast<float>(codePoint == kPlaceholderCodePoint
                                                   ? 10.0
                                                   : cssAdvance(codePoint)) *
                            scale;
      const float values[kGlyphMetricsStride] = {static_cast<float>(role),
                                                 static_cast<float>(codePoint),
                                                 x,
                                                 y,
                                                 static_cast<float>(plan.cellWidth),
                                                 static_cast<float>(plan.cellHeight),
                                                 -1.0F,
                                                 -1.0F,
                                                 advance};
      upload.metrics.insert(upload.metrics.end(), values, values + kGlyphMetricsStride);
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
  codePoints.push_back(0x2026);
  codePoints.push_back(0x00E4);
  codePoints.push_back(0x00FC);
  return codePoints;
}

GlyphAtlas makeAtlas(double dpr = 1.0) {
  GlyphAtlas atlas;
  const Status status = loadUpload(atlas, makeUpload(ascii(), dpr));
  test::expect(status.ok, "atlas loads");
  return atlas;
}

std::vector<std::uint32_t> codePointsOf(std::string_view text) {
  std::vector<std::uint32_t> codePoints;
  for (const char character : text) {
    codePoints.push_back(static_cast<std::uint32_t>(static_cast<unsigned char>(character)));
  }
  return codePoints;
}

Rectangle rectangle(Layer layer, double x, double y, double width, double height) {
  Rectangle value;
  value.x = x;
  value.y = y;
  value.width = width;
  value.height = height;
  value.layer = layer;
  value.tone = Tone::neutral;
  return value;
}

std::uint32_t add(Document& document, const Rectangle& value) {
  air::engine::ObjectId id = air::engine::kInvalidObjectId;
  const Status status = document.addObject(value, id);
  test::expect(status.ok, "object added");
  std::uint32_t slot = 0;
  test::expect(document.slotForId(id, slot).ok, "slot resolves");
  return slot;
}

bool findUnbound(const TextBindings& bindings);

Camera cameraAt(double panX, double panY, double zoom) {
  Camera camera;
  test::expect(camera.setView(panX, panY, zoom).ok, "camera view set");
  return camera;
}

void testHeaderGeometry() {
  test::section("L02 header geometry comes from tokens.h");
  const Rectangle zone = rectangle(Layer::zones, 100.0, 200.0, 400.0, 300.0);
  const ObjectTextBoxes zoneBoxes = objectTextBoxes(zone);
  test::expect(zoneBoxes.header, "a zone has a header band");
  test::expectNear(zoneBoxes.headerHeight, tokens::header_height, 1e-12,
                   "the zone header is the 40 px token");
  test::expectNear(zoneBoxes.contentInset, tokens::header_height + tokens::space_16, 1e-12,
                   "zone content starts below the header plus the content padding");
  test::expectNear(zoneBoxes.band.x, 100.0, 1e-12, "band starts at the zone x");
  test::expectNear(zoneBoxes.band.y, 200.0, 1e-12, "band starts at the zone y");
  test::expectNear(zoneBoxes.band.width, 400.0, 1e-12, "band spans the zone width");
  test::expectNear(zoneBoxes.band.height, tokens::header_height, 1e-12, "band is 40 px high");
  test::expectNear(zoneBoxes.rule.y, zone.y + tokens::header_height, 1e-12,
                   "the header rule sits exactly at the 40 px boundary");
  test::expectNear(zoneBoxes.rule.height, tokens::border_width, 1e-12,
                   "the rule is the border width token");
  test::expectNear(zoneBoxes.preview.y, zone.y + tokens::header_height + tokens::space_16, 1e-12,
                   "zone content (a description preview) starts below the header");
  test::expectNear(zoneBoxes.title.x, 100.0 + tokens::space_16, 1e-12, "title x uses the padding");
  const double titleCentre =
      zoneBoxes.title.y + tokens::text_15 * tokens::line_height / 2.0;
  test::expectNear(titleCentre, 200.0 + tokens::header_height / 2.0, 1e-12,
                   "the title is centred in the 40 px header");

  const Rectangle block = rectangle(Layer::blocks, 120.0, 260.0, 200.0, 180.0);
  const ObjectTextBoxes blockBoxes = objectTextBoxes(block);
  test::expect(blockBoxes.header, "a block has a header band");
  test::expectNear(blockBoxes.headerHeight, tokens::header_height, 1e-12,
                   "the block header is 40 px");
  test::expectNear(blockBoxes.preview.y, block.y + tokens::header_height + tokens::space_16, 1e-12,
                   "the block preview starts below its header");
  test::expectNear(blockBoxes.preview.height, 180.0 - tokens::header_height - 2 * tokens::space_16,
                   1e-12, "the preview is clipped to the block's own height");

  const Rectangle card = rectangle(Layer::noteCards, 32.0, 48.0, 176.0, 128.0);
  const ObjectTextBoxes cardBoxes = objectTextBoxes(card);
  test::expect(!cardBoxes.header, "a card has no header band");
  test::expectNear(cardBoxes.title.y, card.y + tokens::space_16, 1e-12,
                   "the card title starts at the top padding");
  test::expectNear(cardBoxes.title.width,
                   176.0 - 2 * tokens::space_16 - tokens::button_card - tokens::space_8, 1e-12,
                   "the card title box reserves the quiet delete affordance");
  test::expectNear(cardBoxes.preview.y,
                   card.y + tokens::space_16 + tokens::text_15 * tokens::line_height +
                       tokens::space_8,
                   1e-12, "the card preview follows the title line box");

  const Rectangle shortBlock = rectangle(Layer::blocks, 0.0, 0.0, 64.0, 20.0);
  const ObjectTextBoxes shortBoxes = objectTextBoxes(shortBlock);
  test::expectNear(shortBoxes.band.height, 20.0, 1e-12,
                   "a block shorter than its header keeps the band inside it");
  test::expectNear(shortBoxes.rule.height, 0.0, 1e-12,
                   "no header rule when the header does not fit");
  test::expectNear(shortBoxes.preview.height, 0.0, 1e-12,
                   "no preview space when the block is shorter than its header");

  const Rectangle narrow = rectangle(Layer::noteCards, 0.0, 0.0, 20.0, 100.0);
  test::expectNear(objectTextBoxes(narrow).title.width, 0.0, 1e-12,
                   "an object narrower than its padding has a zero title box");
}

void testTitleEllipsis() {
  test::section("titles are single-line ellipsis runs at 15 px/600");
  const GlyphAtlas atlas = makeAtlas();
  Document document;
  SpatialIndex spatial;
  const std::uint32_t card = add(document, rectangle(Layer::noteCards, 64.0, 64.0, 200.0, 160.0));
  const std::uint32_t zone = add(document, rectangle(Layer::zones, 400.0, 64.0, 240.0, 320.0));
  spatial.rebuild(document);

  TextBindings bindings;
  const std::vector<std::uint32_t> longTitle =
      codePointsOf("Ausflug an den Walensee mit Ubernachtung");
  const std::vector<std::uint32_t> zoneName = codePointsOf("Sommer am Walensee");
  test::expect(bindings.set(document, card, longTitle.data(),
                            static_cast<std::uint32_t>(longTitle.size()), nullptr, 0)
                   .ok,
               "a card title binds");
  test::expect(bindings.set(document, zone, zoneName.data(),
                            static_cast<std::uint32_t>(zoneName.size()), nullptr, 0)
                   .ok,
               "a zone name binds");
  test::expect(bindings.size() == 2, "both bindings are stored");

  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  TextRuns runs;
  std::vector<ChromeInstance> chrome;
  test::expect(bindings.bindVisible(document, camera, spatial, 1440.0, 900.0, runs, chrome).ok,
               "visible bindings build");

  GlyphBuffer glyphBuffer;
  test::expect(glyphBuffer.build(runs, atlas, camera, 1440.0, 900.0).ok,
               "the bound titles build glyphs");
  const auto& allRuns = runs.runs();
  test::expect(allRuns.size() == 2, "one title run per visible object");
  test::expect(allRuns[0].role == kTitle, "the title uses the title role (15 px / 600)");
  test::expect(allRuns[0].flow == TextFlow::ellipsis, "titles use the ellipsis flow");
  test::expectNear(allRuns[0].boxWidth,
                   200.0 - 2 * tokens::space_16 - tokens::button_card - tokens::space_8, 1e-12,
                   "the title box is the card width minus the padding and the affordance");
  test::expect(allRuns[0].layout.truncated, "a long card title is truncated");
  test::expect(!allRuns[1].layout.truncated, "a short zone name fits its header");
  test::expect(!allRuns[0].layout.glyphs.empty(), "the truncated title still draws glyphs");
  test::expect(allRuns[0].layout.glyphs.back().codePoint == 0x2026,
               "the cut title ends with U+2026");
  double widest = 0.0;
  for (const auto& glyph : allRuns[0].layout.glyphs) {
    widest = std::max(widest, glyph.x + cssAdvance(glyph.codePoint));
  }
  test::expect(!glyphBuffer.empty(), "the bound titles draw glyph quads");
  test::expect(widest <= allRuns[0].boxWidth + 1e-9,
               "the ellipsized title never overflows its box");
  test::expect(allRuns[1].layout.glyphs.size() == zoneName.size(),
               "the zone name is drawn in full");

  // Chrome: the zone has a 40 px band and rule; the card has none.
  test::expect(chrome.size() == 2, "the titled zone emits the header band and rule");
  test::expect(chrome[0].kind == kChromeHeaderBand && chrome[1].kind == kChromeHeaderRule,
               "chrome kinds are band and rule");
  test::expectNear(chrome[0].x, 400.0, 1e-5, "the band maps through the camera");
  test::expectNear(chrome[0].height, tokens::header_height, 1e-5,
                   "the band is 40 screen px at zoom 1");
  test::expectNear(chrome[1].y, 64.0 + tokens::header_height, 1e-5,
                   "the rule sits at the 40 px boundary on screen");
}

void testPreviewClippingAndGrowth() {
  test::section("previews wrap, clip and define the grown block height");
  const GlyphAtlas atlas = makeAtlas();
  const Rectangle block = rectangle(Layer::blocks, 100.0, 100.0, 256.0, 160.0);
  const std::vector<std::uint32_t> preview = codePointsOf(
      "Treffpunkt am Bahnhof um neun Uhr. Danach gemeinsam zum Ufer, Picknick mitbringen, "
      "bei Regen ins Cafe am Hafen und spater zuruck. Bitte an warme Kleidung denken.");
  const ObjectTextBoxes boxes = objectTextBoxes(block);
  const double lineHeight = tokens::text_13 * tokens::line_height;

  TextLayout layout;
  test::expect(air::engine::layoutText(atlas, kBody, TextFlow::wrap, boxes.preview.width,
                                       boxes.preview.height, preview.data(),
                                       static_cast<std::uint32_t>(preview.size()), layout)
                   .ok,
               "the preview lays out");
  test::expect(layout.truncated, "a long preview is clipped to the block height");
  test::expect(layout.lines == static_cast<std::uint32_t>(
                                  std::floor(boxes.preview.height / lineHeight + 1e-9)),
               "the visible lines are floor(height / line height)");
  test::expect(layout.glyphs.back().codePoint == 0x2026,
               "the last visible preview line ends with U+2026");

  TextLayout unclipped;
  test::expect(air::engine::layoutText(atlas, kBody, TextFlow::wrap, boxes.preview.width, 1e9,
                                       preview.data(),
                                       static_cast<std::uint32_t>(preview.size()), unclipped)
                   .ok,
               "the unclipped preview lays out");
  test::expect(unclipped.height > layout.height, "clipping hides lines of the preview");
  double required = 0.0;
  test::expect(textRequiredHeight(atlas, block, preview.data(),
                                  static_cast<std::uint32_t>(preview.size()), required)
                   .ok,
               "the required height computes");
  test::expect(required > block.height,
               "the preview needs more height than the block has: the block grows");
  test::expectNear(required, boxes.preview.y - block.y + unclipped.height + tokens::space_16,
                   1e-12,
                   "the required height is the inset plus the unclipped content plus the padding");

  // The grown reference stays the object's x/y/width: only the height changes.
  Rectangle grown = block;
  grown.height = required;
  const ObjectTextBoxes grownBoxes = objectTextBoxes(grown);
  TextLayout grownLayout;
  test::expect(air::engine::layoutText(atlas, kBody, TextFlow::wrap, grownBoxes.preview.width,
                                       grownBoxes.preview.height, preview.data(),
                                       static_cast<std::uint32_t>(preview.size()), grownLayout)
                   .ok,
               "the grown box lays out");
  test::expect(!grownLayout.truncated, "the grown block shows all preview lines: no scrolling");

  double shortRequired = 0.0;
  const std::vector<std::uint32_t> empty;
  test::expect(textRequiredHeight(atlas, block, empty.data(), 0, shortRequired).ok &&
                   shortRequired == tokens::header_height + 2 * tokens::space_16,
               "an empty preview needs the minimal header height");
  const Rectangle card = rectangle(Layer::noteCards, 0.0, 0.0, 200.0, 160.0);
  double cardRequired = 0.0;
  test::expect(textRequiredHeight(atlas, card, preview.data(),
                                  static_cast<std::uint32_t>(preview.size()), cardRequired)
                   .ok,
               "the card required height computes");
  const ObjectTextBoxes cardBoxes = objectTextBoxes(card);
  TextLayout cardLayout;
  test::expect(air::engine::layoutText(atlas, kBody, TextFlow::wrap, cardBoxes.preview.width, 1e9,
                                       preview.data(),
                                       static_cast<std::uint32_t>(preview.size()), cardLayout)
                   .ok,
               "the card preview lays out");
  test::expectNear(cardRequired,
                   cardBoxes.preview.y - card.y + cardLayout.height + tokens::space_16, 1e-12,
                   "the card keeps its title line above the preview");
}

void testBindingCulling() {
  test::section("text is bound only for visible objects");
  const GlyphAtlas atlas = makeAtlas();
  Document document;
  SpatialIndex spatial;
  const std::uint32_t nearSlot =
      add(document, rectangle(Layer::noteCards, 0.0, 0.0, 200.0, 120.0));
  const std::uint32_t farSlot =
      add(document, rectangle(Layer::noteCards, 4000.0, 4000.0, 200.0, 120.0));
  const std::uint32_t tinySlot =
      add(document, rectangle(Layer::noteCards, 240.0, 0.0, 200.0, 10.0));
  spatial.rebuild(document);

  TextBindings bindings;
  const std::vector<std::uint32_t> title = codePointsOf("Notiz");
  for (const std::uint32_t slot : {nearSlot, farSlot, tinySlot}) {
    test::expect(bindings.set(document, slot, title.data(),
                              static_cast<std::uint32_t>(title.size()), nullptr, 0)
                     .ok,
                 "binding stored");
  }

  TextRuns runs;
  std::vector<ChromeInstance> chrome;
  const Camera nearCamera = cameraAt(0.0, 0.0, 1.0);
  test::expect(bindings.bindVisible(document, nearCamera, spatial, 800.0, 600.0, runs, chrome).ok,
               "near bindings build");
  test::expect(runs.runs().size() == 1, "only the visible readable object binds text");
  test::expectNear(runs.runs()[0].x, tokens::space_16, 1e-12, "the run anchors at the object");

  const Camera farCamera = cameraAt(4000.0, 4000.0, 1.0);
  test::expect(bindings.bindVisible(document, farCamera, spatial, 800.0, 600.0, runs, chrome).ok,
               "far bindings build");
  GlyphBuffer farGlyphs;
  test::expect(farGlyphs.build(runs, atlas, farCamera, 800.0, 600.0).ok, "far glyphs build");
  test::expect(runs.runs().size() == 1 && runs.runs()[0].layout.glyphs.size() == title.size(),
               "the far object binds when it is the visible one");

  const Camera zoomedOut = cameraAt(0.0, 0.0, 0.1);
  test::expect(bindings.bindVisible(document, zoomedOut, spatial, 800.0, 600.0, runs, chrome).ok,
               "zoomed-out bindings build");
  test::expect(runs.runs().size() == 0,
               "a zoomed-out object below one title line binds no text");

  const Camera emptyCamera = cameraAt(20000.0, 20000.0, 1.0);
  test::expect(bindings.bindVisible(document, emptyCamera, spatial, 800.0, 600.0, runs, chrome).ok,
               "an empty viewport builds");
  test::expect(runs.runs().empty() && chrome.empty(), "nothing binds outside the viewport");

  spatial.rebuild(document);
  test::expect(!bindings.bindVisible(document, nearCamera, spatial, 0.0, 600.0, runs, chrome).ok,
               "a non-positive viewport is rejected");
}

void testChromeOcclusion() {
  test::section("header chrome never overpaints a higher layer");
  const GlyphAtlas atlas = makeAtlas();
  Document document;
  SpatialIndex spatial;
  const std::uint32_t zone =
      add(document, rectangle(Layer::zones, 100.0, 100.0, 400.0, 300.0));
  const std::uint32_t card =
      add(document, rectangle(Layer::noteCards, 120.0, 110.0, 120.0, 60.0));
  spatial.rebuild(document);

  TextBindings bindings;
  const std::vector<std::uint32_t> zoneName = codePointsOf("Projekt");
  const std::vector<std::uint32_t> cardTitle = codePointsOf("Notiz");
  test::expect(bindings.set(document, zone, zoneName.data(),
                            static_cast<std::uint32_t>(zoneName.size()), nullptr, 0)
                   .ok,
               "zone name bound");
  test::expect(bindings.set(document, card, cardTitle.data(),
                            static_cast<std::uint32_t>(cardTitle.size()), nullptr, 0)
                   .ok,
               "card title bound");

  TextRuns runs;
  std::vector<ChromeInstance> chrome;
  const Camera camera = cameraAt(0.0, 0.0, 1.0);
  test::expect(bindings.bindVisible(document, camera, spatial, 1440.0, 900.0, runs, chrome).ok,
               "bindings build with a card over the zone header");
  test::expect(chrome.empty(), "the zone header band is dropped under a card");

  // Moving the card off the header brings the zone chrome back.
  const std::uint32_t cardSlot = card;
  test::expect(document.updateGeometry(document.rectangles()[cardSlot].id, 120.0, 260.0, 120.0,
                                       60.0)
                   .ok,
               "the card moves off the zone header");
  spatial.updateSlot(document, cardSlot);
  test::expect(bindings.bindVisible(document, camera, spatial, 1440.0, 900.0, runs, chrome).ok,
               "bindings rebuild");
  test::expect(chrome.size() == 2, "the zone chrome is drawn again");
}

void testDeterminismAndDpr() {
  test::section("binding geometry is deterministic and DPR-independent");
  GlyphAtlas atlasOne = makeAtlas(1.0);
  GlyphAtlas atlasTwo = makeAtlas(2.0);
  Document document;
  SpatialIndex spatial;
  const std::uint32_t block =
      add(document, rectangle(Layer::blocks, 32.0, 32.0, 240.0, 200.0));
  spatial.rebuild(document);
  const std::vector<std::uint32_t> title = codePointsOf("Packliste");
  const std::vector<std::uint32_t> preview =
      codePointsOf("Zelt, Schlafsack, Kocher, Cafe, Wasser und eine warme Jacke.");
  TextBindings bindings;
  test::expect(bindings.set(document, block, title.data(),
                            static_cast<std::uint32_t>(title.size()), preview.data(),
                            static_cast<std::uint32_t>(preview.size()))
                   .ok,
               "block binding stored");
  const Camera camera = cameraAt(0.0, 0.0, 1.5);

  TextRuns runsOne;
  TextRuns runsTwo;
  std::vector<ChromeInstance> chromeOne;
  std::vector<ChromeInstance> chromeTwo;
  test::expect(bindings.bindVisible(document, camera, spatial, 800.0, 600.0, runsOne, chromeOne).ok,
               "first binding builds");
  test::expect(bindings.bindVisible(document, camera, spatial, 800.0, 600.0, runsTwo, chromeTwo).ok,
               "second binding builds");
  test::expect(runsOne.runs().size() == runsTwo.runs().size(), "identical run count");
  test::expect(chromeOne.size() == chromeTwo.size(), "identical chrome count");
  bool sameChrome = true;
  for (std::size_t index = 0; index < chromeOne.size(); ++index) {
    sameChrome = sameChrome && chromeOne[index].x == chromeTwo[index].x &&
                 chromeOne[index].y == chromeTwo[index].y &&
                 chromeOne[index].width == chromeTwo[index].width &&
                 chromeOne[index].height == chromeTwo[index].height &&
                 chromeOne[index].kind == chromeTwo[index].kind;
  }
  test::expect(sameChrome, "identical input gives byte-identical chrome");

  GlyphBuffer bufferDprOne;
  GlyphBuffer bufferDprTwo;
  test::expect(bufferDprOne.build(runsOne, atlasOne, camera, 800.0, 600.0).ok &&
                   bufferDprTwo.build(runsTwo, atlasTwo, camera, 800.0, 600.0).ok,
               "both DPR buffers build");
  test::expect(!bufferDprOne.empty() && bufferDprOne.size() == bufferDprTwo.size(),
               "the same glyph count at DPR 1 and DPR 2");
  // The layout of the P4-09 flow is CSS px: the same code points and boxes on
  // both atlases, independent of the raster scale.
  const auto& runOne = runsOne.runs().front();
  const auto& runTwo = runsTwo.runs().front();
  test::expect(runOne.layout.glyphs.size() == runTwo.layout.glyphs.size(), "same placement count");
  bool samePlacement = true;
  for (std::size_t index = 0; index < runOne.layout.glyphs.size(); ++index) {
    samePlacement = samePlacement &&
                    runOne.layout.glyphs[index].x == runTwo.layout.glyphs[index].x &&
                    runOne.layout.glyphs[index].y == runTwo.layout.glyphs[index].y &&
                    runOne.layout.glyphs[index].codePoint == runTwo.layout.glyphs[index].codePoint;
  }
  test::expect(samePlacement, "DPR 1 and DPR 2 place the same glyphs in CSS px");
  test::expect(runOne.layout.truncated == runTwo.layout.truncated,
               "DPR does not change clipping");

  // The document keeps no text: only the caller-owned binding store holds it.
  test::expect(bindings.size() == 1, "the text lives in the binding store only");
  test::expect(atlasOne.ready() && atlasTwo.ready(), "atlases are ready");
}

void testBindingValidation() {
  test::section("binding input is validated");
  Document document;
  SpatialIndex spatial;
  const std::uint32_t slot = add(document, rectangle(Layer::noteCards, 0.0, 0.0, 100.0, 80.0));
  spatial.rebuild(document);
  TextBindings bindings;
  const std::vector<std::uint32_t> title = codePointsOf("Titel");
  test::expect(!bindings.set(document, 99, title.data(),
                             static_cast<std::uint32_t>(title.size()), nullptr, 0)
                    .ok,
               "an unknown slot is rejected");
  std::vector<std::uint32_t> invalid = title;
  invalid.push_back(0x110000);
  test::expect(!bindings.set(document, slot, invalid.data(),
                             static_cast<std::uint32_t>(invalid.size()), nullptr, 0)
                    .ok,
               "a code point above U+10FFFF is rejected");
  test::expect(!bindings.set(document, slot, nullptr, 1, nullptr, 0).ok,
               "a null title pointer with a count is rejected");
  test::expect(bindings.empty(), "a rejected binding leaves the store empty");
  test::expect(findUnbound(bindings), "an unbound object is not found");

  // Empty title and preview are valid and draw nothing.
  test::expect(bindings.set(document, slot, nullptr, 0, nullptr, 0).ok,
               "empty text binds");
  TextRuns runs;
  std::vector<ChromeInstance> chrome;
  test::expect(bindings.bindVisible(document, cameraAt(0.0, 0.0, 1.0), spatial, 800.0, 600.0,
                                   runs, chrome)
                   .ok,
               "empty binding builds");
  test::expect(runs.runs().empty(), "empty text adds no run");
}

bool findUnbound(const TextBindings& bindings) {
  return bindings.find(air::engine::kInvalidObjectId) == nullptr;
}

}  // namespace

int main() {
  testHeaderGeometry();
  testTitleEllipsis();
  testPreviewClippingAndGrowth();
  testBindingCulling();
  testChromeOcclusion();
  testDeterminismAndDpr();
  testBindingValidation();
  if (air::engine::test::failures != 0) {
    std::fprintf(stderr, "%d binding check(s) failed\n", air::engine::test::failures);
    return 1;
  }
  std::printf("engine binding tests passed\n");
  return 0;
}
