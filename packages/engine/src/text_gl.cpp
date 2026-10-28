#include "engine/text_gl.h"

#include <cstddef>
#include <cstdint>

#include "engine/text.h"
#include "engine/text_binding.h"

#if defined(__EMSCRIPTEN__)
#include "renderer_internal.h"
#endif

namespace {

using air::engine::AtlasPlan;
using air::engine::AtlasRequest;
using air::engine::Status;
using air::engine::TextStyle;

// The pure calls report through engine_last_error() where a renderer exists.
int reportFailure(const char* reason) {
#if defined(__EMSCRIPTEN__)
  air::engine::detail::setLastError(reason);
#else
  (void)reason;
#endif
  return 0;
}

}  // namespace

// Pure calls: identical in the native and the WebAssembly build -------------

AIR_ENGINE_RENDER_GL_API int engine_text_style(int role, double* out) {
  if (out == nullptr || role < 0) {
    return reportFailure("text role is unknown");
  }
  TextStyle style;
  const Status status = air::engine::textStyle(static_cast<std::uint32_t>(role), style);
  if (!status) {
    return reportFailure(status.reason);
  }
  out[0] = style.fontSize;
  out[1] = static_cast<double>(style.fontWeight);
  out[2] = style.lineHeight;
  return 1;
}

AIR_ENGINE_RENDER_GL_API const char* engine_text_font_family(int role) {
  TextStyle style;
  if (role < 0 || !air::engine::textStyle(static_cast<std::uint32_t>(role), style)) {
    return "";
  }
  return style.fontFamily;
}

AIR_ENGINE_RENDER_GL_API int engine_text_plan_atlas(int glyph_count, double cell_width,
                                                    double cell_height,
                                                    double device_pixel_ratio,
                                                    int max_texture_size, double* out) {
  if (out == nullptr || glyph_count < 0 || max_texture_size < 0) {
    return reportFailure("atlas glyph count and texture size must not be negative");
  }
  AtlasRequest request;
  request.glyphCount = static_cast<std::uint32_t>(glyph_count);
  request.cellWidth = cell_width;
  request.cellHeight = cell_height;
  request.devicePixelRatio = device_pixel_ratio;
  request.maxTextureSize = static_cast<std::uint32_t>(max_texture_size);
  AtlasPlan plan;
  const Status status = air::engine::planAtlas(request, plan);
  if (!status) {
    return reportFailure(status.reason);
  }
  out[0] = plan.width;
  out[1] = plan.height;
  out[2] = plan.columns;
  out[3] = plan.rows;
  out[4] = plan.cellWidth;
  out[5] = plan.cellHeight;
  out[6] = plan.rasterScale;
  return 1;
}

#if defined(__EMSCRIPTEN__)

#include <GLES3/gl3.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>

#include "tokens.h"

namespace air::engine {
namespace {

// Glyph pass (ADR-0009): one static unit quad, per-instance screen rectangle and
// atlas UVs, one instanced draw. The atlas holds white glyph coverage in alpha;
// the shader tints it with tokens::fg, so no colour is hard-coded.
constexpr const char* kGlyphVertexShader = R"(#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_rect;
layout(location = 2) in vec4 a_uv;
uniform vec4 u_glyph[2];  // 0: resolution.xy, unused · 1: rgba tint
out vec2 v_uv;
void main() {
  vec2 position = a_rect.xy + a_corner * a_rect.zw;
  vec2 clip = vec2(position.x / u_glyph[0].x * 2.0 - 1.0,
                   1.0 - position.y / u_glyph[0].y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
}
)";

// u_glyph is shared with the vertex stage, so it keeps the vertex default
// precision (highp); a mediump copy fails to link.
constexpr const char* kGlyphFragmentShader = R"(#version 300 es
precision mediump float;
in vec2 v_uv;
uniform highp vec4 u_glyph[2];
uniform sampler2D u_atlas;
out vec4 out_color;
void main() {
  float coverage = texture(u_atlas, v_uv).a;
  if (coverage <= 0.0) {
    discard;
  }
  out_color = vec4(u_glyph[1].rgb, u_glyph[1].a * coverage);
}
)";

// L02 header chrome (P4-10): the same unit-quad instancing as the glyph pass, but
// with a per-instance tint, so the 40 px header band (tokens::faint) and its rule
// (tokens::border) come straight from the generated token header. Chrome is drawn
// before the glyphs of the frame; it never enters the object command buffer.
constexpr const char* kChromeVertexShader = R"(#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_rect;
layout(location = 2) in vec4 a_tint;
uniform vec2 u_resolution;
out vec4 v_tint;
void main() {
  vec2 position = a_rect.xy + a_corner * a_rect.zw;
  vec2 clip = vec2(position.x / u_resolution.x * 2.0 - 1.0,
                   1.0 - position.y / u_resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_tint = a_tint;
}
)";

constexpr const char* kChromeFragmentShader = R"(#version 300 es
precision mediump float;
in vec4 v_tint;
out vec4 out_color;
void main() {
  out_color = v_tint;
}
)";

// One instanced chrome quad: screen-space rectangle plus the straight-alpha tint
// resolved from tokens.h (32 bytes, the glyph-pass seam).
struct ChromeGpuInstance {
  float x{0.0F};
  float y{0.0F};
  float width{0.0F};
  float height{0.0F};
  float red{0.0F};
  float green{0.0F};
  float blue{0.0F};
  float alpha{0.0F};
};
static_assert(sizeof(ChromeGpuInstance) == 32, "chrome GPU instance layout is the seam");

// Performance constant, not a design value: header chrome is bounded by the
// number of visible zone/block titles a viewport can bind.
constexpr std::size_t kMaxChromeInstances = 4096;

// Key of the last visible binding set: the binding is rebuilt only when the
// document, the camera, the viewport or the binding set changed.
struct BindingSyncKey {
  std::uint64_t documentInstance{0};
  std::uint32_t documentVersion{0};
  double panX{0.0};
  double panY{0.0};
  double zoom{0.0};
  int cssWidth{0};
  int cssHeight{0};
  std::uint64_t bindingsGeneration{0};
};

bool sameKey(const BindingSyncKey& left, const BindingSyncKey& right) {
  return left.documentInstance == right.documentInstance &&
         left.documentVersion == right.documentVersion && left.panX == right.panX &&
         left.panY == right.panY && left.zoom == right.zoom && left.cssWidth == right.cssWidth &&
         left.cssHeight == right.cssHeight &&
         left.bindingsGeneration == right.bindingsGeneration;
}

// Parses a generated hexadecimal colour token ("#rrggbb") into straight-alpha
// floats. tokens::accent is stored as hex (faint/border are rgba() strings), and
// a guide must use exactly the token value, never a raw colour.
bool parseHexToken(const char* value, float* rgba) {
  if (value == nullptr || value[0] != '#' || std::strlen(value) != 7 || rgba == nullptr) {
    return false;
  }
  for (int channel = 0; channel < 3; ++channel) {
    int parsed = 0;
    for (int digit = 0; digit < 2; ++digit) {
      const char character = value[1 + channel * 2 + digit];
      int nibble = 0;
      if (character >= '0' && character <= '9') {
        nibble = character - '0';
      } else if (character >= 'a' && character <= 'f') {
        nibble = character - 'a' + 10;
      } else if (character >= 'A' && character <= 'F') {
        nibble = character - 'A' + 10;
      } else {
        return false;
      }
      parsed = parsed * 16 + nibble;
    }
    rgba[channel] = static_cast<float>(parsed) / 255.0F;
  }
  rgba[3] = 1.0F;
  return true;
}

GLuint compileShader(GLenum type, const char* source, const char* label) {
  const GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  GLint compiled = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
  if (compiled == GL_FALSE) {
    glDeleteShader(shader);
    detail::setLastError(label);
    return 0;
  }
  return shader;
}

class TextPass {
 public:
  bool create() {
    if (created_) {
      return true;
    }
    if (!detail::parseRgbaToken(tokens::fg, tint_)) {
      detail::setLastError("generated fg token is not an rgba colour");
      return false;
    }
    if (!detail::parseRgbaToken(tokens::faint, chromeBandColor_) ||
        !detail::parseRgbaToken(tokens::border, chromeRuleColor_) ||
        !parseHexToken(tokens::accent, chromeGuideColor_)) {
      detail::setLastError("generated faint/border/accent tokens are not colours");
      return false;
    }
    const GLuint vertexShader =
        compileShader(GL_VERTEX_SHADER, kGlyphVertexShader, "glyph shader compile failed");
    if (vertexShader == 0) {
      return false;
    }
    const GLuint fragmentShader = compileShader(GL_FRAGMENT_SHADER, kGlyphFragmentShader,
                                                  "glyph shader compile failed");
    if (fragmentShader == 0) {
      glDeleteShader(vertexShader);
      return false;
    }
    program_ = glCreateProgram();
    glAttachShader(program_, vertexShader);
    glAttachShader(program_, fragmentShader);
    glLinkProgram(program_);
    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);
    GLint linked = 0;
    glGetProgramiv(program_, GL_LINK_STATUS, &linked);
    if (linked == GL_FALSE) {
      GLsizei length = 0;
      char log[1024] = {};
      glGetProgramInfoLog(program_, static_cast<GLsizei>(sizeof(log)), &length, log);
      // setLastError copies the reason, so a local message is safe.
      const std::string reason = std::string("glyph shader link failed: ") + log;
      detail::setLastError(reason.c_str());
      return false;
    }
    glyph_uniform_ = glGetUniformLocation(program_, "u_glyph");
    const GLint atlasUniform = glGetUniformLocation(program_, "u_atlas");
    if (glyph_uniform_ < 0 || atlasUniform < 0) {
      detail::setLastError("glyph shader uniforms were not found");
      return false;
    }
    glUseProgram(program_);
    glUniform1i(atlasUniform, 0);
    glUseProgram(0);

    GLint maxTextureSize = 0;
    glGetIntegerv(GL_MAX_TEXTURE_SIZE, &maxTextureSize);
    max_texture_size_ = maxTextureSize > 0 ? maxTextureSize : 0;

    if (!buildChromeProgram() || !buildChromeBuffers()) {
      return false;
    }

    const GLfloat quad[8] = {0.0F, 0.0F, 1.0F, 0.0F, 0.0F, 1.0F, 1.0F, 1.0F};
    glGenBuffers(1, &quad_buffer_);
    glBindBuffer(GL_ARRAY_BUFFER, quad_buffer_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
    glGenBuffers(1, &instance_buffer_);
    glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
    // Allocated once for the run limit; frames only update a prefix.
    glBufferData(GL_ARRAY_BUFFER,
                 static_cast<GLsizeiptr>(kMaxGlyphInstances * sizeof(GlyphInstance)), nullptr,
                 GL_DYNAMIC_DRAW);
    glGenVertexArrays(1, &vertex_array_);
    glBindVertexArray(vertex_array_);
    glBindBuffer(GL_ARRAY_BUFFER, quad_buffer_);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
    glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, static_cast<GLsizei>(sizeof(GlyphInstance)),
                          reinterpret_cast<const void*>(offsetof(GlyphInstance, x)));
    glVertexAttribDivisor(1, 1);
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, static_cast<GLsizei>(sizeof(GlyphInstance)),
                          reinterpret_cast<const void*>(offsetof(GlyphInstance, u0)));
    glVertexAttribDivisor(2, 1);
    glBindVertexArray(0);

    glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glBindTexture(GL_TEXTURE_2D, 0);
    created_ = true;
    return true;
  }

  int maxTextureSize() const { return created_ ? max_texture_size_ : -1; }

  int loadAtlas(int width, int height, double rasterScale, const unsigned char* rgba,
                int byteLength, const float* metrics, int glyphCount) {
    if (!created_) {
      detail::setLastError("engine_create must be called before engine_text_load_atlas");
      return 0;
    }
    if (width <= 0 || height <= 0 || byteLength < 0 || glyphCount <= 0) {
      detail::setLastError("atlas size, byte length and glyph count must be positive");
      return 0;
    }
    const Status status = atlas_.load(
        static_cast<std::uint32_t>(width), static_cast<std::uint32_t>(height), rasterScale,
        static_cast<std::uint32_t>(max_texture_size_), rgba,
        static_cast<std::size_t>(byteLength), metrics, static_cast<std::uint32_t>(glyphCount));
    if (!status) {
      detail::setLastError(status.reason);
      return 0;
    }
    // One texture upload per accepted atlas build, never per frame. Rows are
    // tightly packed RGBA; the alpha channel is the glyph coverage.
    glBindTexture(GL_TEXTURE_2D, texture_);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE,
                 atlas_.pixels().data());
    glBindTexture(GL_TEXTURE_2D, 0);
    return 1;
  }

  int addRun(double x, double y, int role, const unsigned int* codePoints, int count) {
    if (!created_) {
      detail::setLastError("engine_create must be called before engine_text_add_run");
      return 0;
    }
    if (role < 0 || count < 0) {
      detail::setLastError("text role and code point count must not be negative");
      return 0;
    }
    static_assert(sizeof(unsigned int) == sizeof(std::uint32_t), "code points are 32-bit");
    const Status status =
        runs_.add(x, y, static_cast<std::uint32_t>(role),
                  reinterpret_cast<const std::uint32_t*>(codePoints),
                  static_cast<std::uint32_t>(count));
    if (!status) {
      detail::setLastError(status.reason);
      return 0;
    }
    return 1;
  }

  int addBoxRun(double x, double y, int role, int flow, double width, double height,
                const unsigned int* codePoints, int count) {
    if (!created_) {
      detail::setLastError("engine_create must be called before engine_text_add_box_run");
      return 0;
    }
    if (role < 0 || flow < 0 || count < 0) {
      detail::setLastError("text role, flow and code point count must not be negative");
      return 0;
    }
    const Status status =
        runs_.add(x, y, static_cast<std::uint32_t>(role), static_cast<TextFlow>(flow), width,
                  height, reinterpret_cast<const std::uint32_t*>(codePoints),
                  static_cast<std::uint32_t>(count));
    if (!status) {
      detail::setLastError(status.reason);
      return 0;
    }
    return 1;
  }

  int clearRuns() {
    if (!created_) {
      detail::setLastError("engine_create must be called before engine_text_clear_runs");
      return 0;
    }
    runs_.clear();
    return 1;
  }

  int bindObject(int index, const unsigned int* title, int titleCount,
                 const unsigned int* preview, int previewCount) {
    if (!created_) {
      detail::setLastError("engine_create must be called before engine_text_bind_object");
      return 0;
    }
    if (index < 0 || titleCount < 0 || previewCount < 0) {
      detail::setLastError("object index and code point counts must not be negative");
      return 0;
    }
    const detail::FrameView view = detail::frameView();
    if (!view.created || view.document == nullptr) {
      detail::setLastError("engine_create must be called before engine_text_bind_object");
      return 0;
    }
    if (static_cast<std::size_t>(index) >= view.document->slotCount() ||
        !view.document->isLive(static_cast<std::uint32_t>(index))) {
      detail::setLastError("object index is out of range or removed");
      return 0;
    }
    static_assert(sizeof(unsigned int) == sizeof(std::uint32_t), "code points are 32-bit");
    const Status status = bindings_.set(
        *view.document, static_cast<std::uint32_t>(index),
        reinterpret_cast<const std::uint32_t*>(title), static_cast<std::uint32_t>(titleCount),
        reinterpret_cast<const std::uint32_t*>(preview), static_cast<std::uint32_t>(previewCount));
    if (!status) {
      detail::setLastError(status.reason);
      return 0;
    }
    // A new binding invalidates the cached visible binding set.
    bindingsGeneration_ += 1;
    return 1;
  }

  int clearBindings() {
    if (!created_) {
      detail::setLastError("engine_create must be called before engine_text_clear_bindings");
      return 0;
    }
    bindings_.clear();
    bindingsGeneration_ += 1;
    return 1;
  }

  int requiredHeight(int index, double* out) {
    if (!created_) {
      detail::setLastError("engine_create must be called before engine_text_required_height");
      return 0;
    }
    if (out == nullptr) {
      detail::setLastError("required height needs an output pointer");
      return 0;
    }
    const detail::FrameView view = detail::frameView();
    if (!view.created || view.document == nullptr) {
      detail::setLastError("engine_create must be called before engine_text_required_height");
      return 0;
    }
    if (index < 0 || static_cast<std::size_t>(index) >= view.document->slotCount() ||
        !view.document->isLive(static_cast<std::uint32_t>(index))) {
      detail::setLastError("object index is out of range or removed");
      return 0;
    }
    const Rectangle& rectangle =
        view.document->rectangles()[static_cast<std::uint32_t>(index)];
    const ObjectText* text = bindings_.find(rectangle.id);
    const std::uint32_t* preview = text == nullptr ? nullptr : text->preview.data();
    const auto previewCount =
        text == nullptr ? 0U : static_cast<std::uint32_t>(text->preview.size());
    double height = 0.0;
    const Status status = textRequiredHeight(atlas_, rectangle, preview, previewCount, height);
    if (!status) {
      detail::setLastError(status.reason);
      return 0;
    }
    *out = height;
    return 1;
  }

  int visibleGlyphCount() {
    if (!buildGlyphs()) {
      return -1;
    }
    int total = static_cast<int>(glyphs_.size());
    const detail::FrameView view = detail::frameView();
    if (!syncBindings(view) || !buildBoundGlyphs(view)) {
      return -1;
    }
    total += static_cast<int>(boundGlyphs_.size());
    return total;
  }

  bool draw() {
    const detail::FrameView view = detail::frameView();
    const std::size_t guideCount =
        view.guides == nullptr ? 0 : std::min(view.guideCount, air::engine::kMaxSnapGuides);
    // No runs, no bindings and no snap guides: nothing is built, bound or
    // uploaded, so a text-free frame keeps the measured cost of the object pass
    // alone (the perf scene never drags, so it has no guides).
    if (guideCount == 0 && (!atlas_.ready() || (runs_.runs().empty() && bindings_.empty()))) {
      return true;
    }
    if (runs_.runs().empty()) {
      glyphs_.clear();
    } else if (!buildGlyphs()) {
      return false;
    }
    if (!syncBindings(view) || !buildBoundGlyphs(view)) {
      return false;
    }
    if (glyphs_.empty() && boundGlyphs_.empty() && chromeGpu_.empty() && guideCount == 0) {
      return true;
    }
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    drawChrome(view);
    drawGlyphBuffers(view);
    glDisable(GL_BLEND);
    return true;
  }

 private:
  bool buildGlyphs() {
    const detail::FrameView view = detail::frameView();
    if (!created_ || !view.created || view.camera == nullptr) {
      detail::setLastError("engine_create must be called before drawing text");
      return false;
    }
    if (view.cssWidth <= 0 || view.cssHeight <= 0) {
      detail::setLastError("engine_resize must be called before drawing text");
      return false;
    }
    const Status status =
        glyphs_.build(runs_, atlas_, *view.camera, static_cast<double>(view.cssWidth),
                      static_cast<double>(view.cssHeight));
    if (!status) {
      detail::setLastError(status.reason);
      return false;
    }
    return true;
  }

  // Rebuilds the visible binding runs only when the document, the camera, the
  // viewport or the binding set changed, so a still frame costs nothing and a
  // pan/zoom rebinds exactly once per change.
  bool syncBindings(const detail::FrameView& view) {
    if (bindings_.empty()) {
      boundRuns_.clear();
      boundGlyphs_.clear();
      chrome_.clear();
      chromeGpu_.clear();
      bindingSyncValid_ = false;
      return true;
    }
    if (view.document == nullptr || view.spatial == nullptr || view.camera == nullptr ||
        view.cssWidth <= 0 || view.cssHeight <= 0) {
      detail::setLastError("engine_resize must be called before binding text");
      return false;
    }
    const BindingSyncKey key{view.document->instanceId(),
                             view.document->version(),
                             view.camera->panX(),
                             view.camera->panY(),
                             view.camera->zoom(),
                             view.cssWidth,
                             view.cssHeight,
                             bindingsGeneration_};
    if (bindingSyncValid_ && sameKey(key, bindingSyncKey_)) {
      return true;
    }
    const Status status = bindings_.bindVisible(
        *view.document, *view.camera, *view.spatial, static_cast<double>(view.cssWidth),
        static_cast<double>(view.cssHeight), boundRuns_, chrome_);
    if (!status) {
      detail::setLastError(status.reason);
      return false;
    }
    bindingSyncKey_ = key;
    bindingSyncValid_ = true;
    buildChromeInstances();
    return true;
  }

  bool buildBoundGlyphs(const detail::FrameView& view) {
    if (boundRuns_.runs().empty() || !atlas_.ready()) {
      boundGlyphs_.clear();
      return true;
    }
    if (view.camera == nullptr) {
      detail::setLastError("engine_create must be called before drawing text");
      return false;
    }
    const Status status =
        boundGlyphs_.build(boundRuns_, atlas_, *view.camera, static_cast<double>(view.cssWidth),
                           static_cast<double>(view.cssHeight));
    if (!status) {
      detail::setLastError(status.reason);
      return false;
    }
    return true;
  }

  // Chrome is resolved from tokens.h once and kept as GPU instances; the binding
  // sync already produced the screen-space quads, so a frame only uploads them.
  void buildChromeInstances() {
    chromeGpu_.clear();
    for (const ChromeInstance& instance : chrome_) {
      if (chromeGpu_.size() >= kMaxChromeInstances) {
        break;
      }
      const float* color =
          instance.kind == kChromeHeaderRule ? chromeRuleColor_ : chromeBandColor_;
      ChromeGpuInstance gpu;
      gpu.x = instance.x;
      gpu.y = instance.y;
      gpu.width = instance.width;
      gpu.height = instance.height;
      gpu.red = color[0];
      gpu.green = color[1];
      gpu.blue = color[2];
      gpu.alpha = color[3];
      chromeGpu_.push_back(gpu);
    }
  }

  void drawChrome(const detail::FrameView& view) {
    const std::size_t guideCount =
        view.guides == nullptr ? 0 : std::min(view.guideCount, air::engine::kMaxSnapGuides);
    if (chromeGpu_.empty() && guideCount == 0) {
      return;
    }
    glUseProgram(chrome_program_);
    glUniform2f(chrome_resolution_uniform_, static_cast<GLfloat>(view.cssWidth),
                static_cast<GLfloat>(view.cssHeight));
    glBindVertexArray(chrome_vertex_array_);
    glBindBuffer(GL_ARRAY_BUFFER, chrome_instance_buffer_);
    if (!chromeGpu_.empty()) {
      glBufferSubData(GL_ARRAY_BUFFER, 0,
                      static_cast<GLsizeiptr>(chromeGpu_.size() * sizeof(ChromeGpuInstance)),
                      chromeGpu_.data());
      glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, static_cast<GLsizei>(chromeGpu_.size()));
    }
    if (guideCount > 0 && view.camera != nullptr) {
      // L07 (P4-15): the snap lines are chrome, not command-buffer instances.
      // Each guide is one screen-space quad of tokens::border_width thickness in
      // tokens::accent; the span is the world span from the snapping core, so it
      // stays continuous across both elements plus 16 px at every zoom.
      ChromeGpuInstance guides[air::engine::kMaxSnapGuides];
      std::size_t count = 0;
      const double zoom = view.camera->zoom();
      const double panX = view.camera->panX();
      const double panY = view.camera->panY();
      for (std::size_t index = 0; index < guideCount; ++index) {
        const SnapGuide& guide = view.guides[index];
        const double start = static_cast<double>(guide.start);
        const double end = static_cast<double>(guide.end);
        if (!(end > start)) {
          continue;
        }
        ChromeGpuInstance instance;
        if (guide.orientation == SnapOrientation::vertical) {
          instance.x = static_cast<float>((guide.position - panX) * zoom -
                                          tokens::border_width / 2.0);
          instance.y = static_cast<float>((start - panY) * zoom);
          instance.width = static_cast<float>(tokens::border_width);
          instance.height = static_cast<float>((end - start) * zoom);
        } else {
          instance.x = static_cast<float>((start - panX) * zoom);
          instance.y = static_cast<float>((guide.position - panY) * zoom -
                                          tokens::border_width / 2.0);
          instance.width = static_cast<float>((end - start) * zoom);
          instance.height = static_cast<float>(tokens::border_width);
        }
        instance.red = chromeGuideColor_[0];
        instance.green = chromeGuideColor_[1];
        instance.blue = chromeGuideColor_[2];
        instance.alpha = chromeGuideColor_[3];
        guides[count] = instance;
        count += 1;
      }
      if (count > 0) {
        glBufferSubData(GL_ARRAY_BUFFER, 0,
                        static_cast<GLsizeiptr>(count * sizeof(ChromeGpuInstance)), guides);
        glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, static_cast<GLsizei>(count));
      }
    }
  }

  void drawGlyphBuffers(const detail::FrameView& view) {
    if (glyphs_.empty() && boundGlyphs_.empty()) {
      return;
    }
    const GLfloat uniforms[8] = {static_cast<GLfloat>(view.cssWidth),
                                 static_cast<GLfloat>(view.cssHeight),
                                 0.0F,
                                 0.0F,
                                 tint_[0],
                                 tint_[1],
                                 tint_[2],
                                 tint_[3]};
    glUseProgram(program_);
    glUniform4fv(glyph_uniform_, 2, uniforms);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glBindVertexArray(vertex_array_);
    glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
    drawGlyphBuffer(glyphs_);
    drawGlyphBuffer(boundGlyphs_);
  }

  void drawGlyphBuffer(const GlyphBuffer& buffer) {
    if (buffer.empty()) {
      return;
    }
    glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(buffer.byteSize()),
                    buffer.bytes());
    glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, static_cast<GLsizei>(buffer.size()));
  }

  bool buildChromeProgram() {
    const GLuint vertexShader =
        compileShader(GL_VERTEX_SHADER, kChromeVertexShader, "chrome shader compile failed");
    if (vertexShader == 0) {
      return false;
    }
    const GLuint fragmentShader =
        compileShader(GL_FRAGMENT_SHADER, kChromeFragmentShader, "chrome shader compile failed");
    if (fragmentShader == 0) {
      glDeleteShader(vertexShader);
      return false;
    }
    chrome_program_ = glCreateProgram();
    glAttachShader(chrome_program_, vertexShader);
    glAttachShader(chrome_program_, fragmentShader);
    glLinkProgram(chrome_program_);
    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);
    GLint linked = 0;
    glGetProgramiv(chrome_program_, GL_LINK_STATUS, &linked);
    if (linked == GL_FALSE) {
      GLsizei length = 0;
      char log[1024] = {};
      glGetProgramInfoLog(chrome_program_, static_cast<GLsizei>(sizeof(log)), &length, log);
      const std::string reason = std::string("chrome shader link failed: ") + log;
      detail::setLastError(reason.c_str());
      return false;
    }
    chrome_resolution_uniform_ = glGetUniformLocation(chrome_program_, "u_resolution");
    if (chrome_resolution_uniform_ < 0) {
      detail::setLastError("chrome shader uniform was not found");
      return false;
    }
    return true;
  }

  bool buildChromeBuffers() {
    const GLfloat quad[8] = {0.0F, 0.0F, 1.0F, 0.0F, 0.0F, 1.0F, 1.0F, 1.0F};
    glGenBuffers(1, &chrome_quad_buffer_);
    glBindBuffer(GL_ARRAY_BUFFER, chrome_quad_buffer_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
    glGenBuffers(1, &chrome_instance_buffer_);
    glBindBuffer(GL_ARRAY_BUFFER, chrome_instance_buffer_);
    glBufferData(GL_ARRAY_BUFFER,
                 static_cast<GLsizeiptr>(kMaxChromeInstances * sizeof(ChromeGpuInstance)),
                 nullptr, GL_DYNAMIC_DRAW);
    glGenVertexArrays(1, &chrome_vertex_array_);
    glBindVertexArray(chrome_vertex_array_);
    glBindBuffer(GL_ARRAY_BUFFER, chrome_quad_buffer_);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
    glBindBuffer(GL_ARRAY_BUFFER, chrome_instance_buffer_);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE,
                          static_cast<GLsizei>(sizeof(ChromeGpuInstance)),
                          reinterpret_cast<const void*>(offsetof(ChromeGpuInstance, x)));
    glVertexAttribDivisor(1, 1);
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE,
                          static_cast<GLsizei>(sizeof(ChromeGpuInstance)),
                          reinterpret_cast<const void*>(offsetof(ChromeGpuInstance, red)));
    glVertexAttribDivisor(2, 1);
    glBindVertexArray(0);
    return true;
  }

  GlyphAtlas atlas_;
  TextRuns runs_;
  GlyphBuffer glyphs_;
  TextBindings bindings_;
  TextRuns boundRuns_;
  GlyphBuffer boundGlyphs_;
  std::vector<ChromeInstance> chrome_;
  std::vector<ChromeGpuInstance> chromeGpu_;
  BindingSyncKey bindingSyncKey_{};
  bool bindingSyncValid_{false};
  std::uint64_t bindingsGeneration_{0};
  GLuint program_{0};
  GLuint vertex_array_{0};
  GLuint quad_buffer_{0};
  GLuint instance_buffer_{0};
  GLuint texture_{0};
  GLint glyph_uniform_{-1};
  int max_texture_size_{0};
  float tint_[4] = {};
  GLuint chrome_program_{0};
  GLuint chrome_vertex_array_{0};
  GLuint chrome_quad_buffer_{0};
  GLuint chrome_instance_buffer_{0};
  GLint chrome_resolution_uniform_{-1};
  float chromeBandColor_[4] = {};
  float chromeRuleColor_[4] = {};
  float chromeGuideColor_[4] = {};
  bool created_{false};
};

TextPass g_text;

}  // namespace

namespace detail {

bool createTextPass() { return g_text.create(); }

bool drawTextPass() { return g_text.draw(); }

}  // namespace detail
}  // namespace air::engine

AIR_ENGINE_RENDER_GL_API int engine_text_max_texture_size() {
  return air::engine::g_text.maxTextureSize();
}

AIR_ENGINE_RENDER_GL_API int engine_text_load_atlas(int width, int height, double raster_scale,
                                                    const unsigned char* rgba, int byte_length,
                                                    const float* metrics, int glyph_count) {
  return air::engine::g_text.loadAtlas(width, height, raster_scale, rgba, byte_length, metrics,
                                       glyph_count);
}

AIR_ENGINE_RENDER_GL_API int engine_text_add_run(double x, double y, int role,
                                                 const unsigned int* code_points, int count) {
  return air::engine::g_text.addRun(x, y, role, code_points, count);
}

AIR_ENGINE_RENDER_GL_API int engine_text_add_box_run(double x, double y, int role, int flow,
                                                     double width, double height,
                                                     const unsigned int* code_points, int count) {
  return air::engine::g_text.addBoxRun(x, y, role, flow, width, height, code_points, count);
}

AIR_ENGINE_RENDER_GL_API int engine_text_clear_runs() { return air::engine::g_text.clearRuns(); }

AIR_ENGINE_RENDER_GL_API int engine_text_bind_object(int index, const unsigned int* title,
                                                     int title_count,
                                                     const unsigned int* preview,
                                                     int preview_count) {
  return air::engine::g_text.bindObject(index, title, title_count, preview, preview_count);
}

AIR_ENGINE_RENDER_GL_API int engine_text_clear_bindings() {
  return air::engine::g_text.clearBindings();
}

AIR_ENGINE_RENDER_GL_API int engine_text_required_height(int index, double* out) {
  return air::engine::g_text.requiredHeight(index, out);
}

AIR_ENGINE_RENDER_GL_API int engine_visible_glyph_count() {
  return air::engine::g_text.visibleGlyphCount();
}

#else  // !defined(__EMSCRIPTEN__)

// Native stubs: the atlas texture and the glyph pass exist only with WebGL2; the
// C++ suite tests GlyphAtlas, TextRuns and GlyphBuffer directly.

AIR_ENGINE_RENDER_GL_API int engine_text_max_texture_size() { return -1; }

AIR_ENGINE_RENDER_GL_API int engine_text_load_atlas(int width, int height, double raster_scale,
                                                    const unsigned char* rgba, int byte_length,
                                                    const float* metrics, int glyph_count) {
  (void)width;
  (void)height;
  (void)raster_scale;
  (void)rgba;
  (void)byte_length;
  (void)metrics;
  (void)glyph_count;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_text_add_run(double x, double y, int role,
                                                 const unsigned int* code_points, int count) {
  (void)x;
  (void)y;
  (void)role;
  (void)code_points;
  (void)count;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_text_add_box_run(double x, double y, int role, int flow,
                                                     double width, double height,
                                                     const unsigned int* code_points, int count) {
  (void)x;
  (void)y;
  (void)role;
  (void)flow;
  (void)width;
  (void)height;
  (void)code_points;
  (void)count;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_text_clear_runs() { return 0; }

AIR_ENGINE_RENDER_GL_API int engine_text_bind_object(int index, const unsigned int* title,
                                                     int title_count,
                                                     const unsigned int* preview,
                                                     int preview_count) {
  (void)index;
  (void)title;
  (void)title_count;
  (void)preview;
  (void)preview_count;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_text_clear_bindings() { return 0; }

AIR_ENGINE_RENDER_GL_API int engine_text_required_height(int index, double* out) {
  (void)index;
  (void)out;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_visible_glyph_count() { return -1; }

#endif  // defined(__EMSCRIPTEN__)
