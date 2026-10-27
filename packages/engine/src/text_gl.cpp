#include "engine/text_gl.h"

#include <cstddef>
#include <cstdint>

#include "engine/text.h"

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

GLuint compileGlyphShader(GLenum type, const char* source) {
  const GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  GLint compiled = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
  if (compiled == GL_FALSE) {
    glDeleteShader(shader);
    detail::setLastError("glyph shader compile failed");
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
    const GLuint vertexShader = compileGlyphShader(GL_VERTEX_SHADER, kGlyphVertexShader);
    if (vertexShader == 0) {
      return false;
    }
    const GLuint fragmentShader = compileGlyphShader(GL_FRAGMENT_SHADER, kGlyphFragmentShader);
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

  int visibleGlyphCount() {
    if (!buildGlyphs()) {
      return -1;
    }
    return static_cast<int>(glyphs_.size());
  }

  bool draw() {
    // No runs: nothing is built, bound or uploaded, so a text-free frame keeps
    // the measured cost of the object pass alone.
    if (runs_.runs().empty() || !atlas_.ready()) {
      return true;
    }
    if (!buildGlyphs()) {
      return false;
    }
    if (glyphs_.empty()) {
      return true;
    }
    const detail::FrameView view = detail::frameView();
    const GLfloat uniforms[8] = {static_cast<GLfloat>(view.cssWidth),
                                 static_cast<GLfloat>(view.cssHeight),
                                 0.0F,
                                 0.0F,
                                 tint_[0],
                                 tint_[1],
                                 tint_[2],
                                 tint_[3]};
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glUseProgram(program_);
    glUniform4fv(glyph_uniform_, 2, uniforms);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glBindVertexArray(vertex_array_);
    glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
    glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(glyphs_.byteSize()),
                    glyphs_.bytes());
    glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, static_cast<GLsizei>(glyphs_.size()));
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

  GlyphAtlas atlas_;
  TextRuns runs_;
  GlyphBuffer glyphs_;
  GLuint program_{0};
  GLuint vertex_array_{0};
  GLuint quad_buffer_{0};
  GLuint instance_buffer_{0};
  GLuint texture_{0};
  GLint glyph_uniform_{-1};
  int max_texture_size_{0};
  float tint_[4] = {};
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

AIR_ENGINE_RENDER_GL_API int engine_visible_glyph_count() { return -1; }

#endif  // defined(__EMSCRIPTEN__)
