#include "engine/render_gl.h"

#if defined(__EMSCRIPTEN__)

#include <GLES3/gl3.h>
#include <emscripten/html5.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>

#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/render.h"
#include "engine/spatial.h"
#include "tokens.h"

namespace air::engine {
namespace {

constexpr int kToneCount = 6;
constexpr int kInstanceStrideFloats = 6;

// Vertex/fragment shaders are inline C++ strings (brief P2-03): one static unit
// quad, per-instance screen-space rect and tone, one instanced draw per frame.
constexpr const char* kVertexShader = R"(#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_rect;
layout(location = 2) in uint a_tone;
uniform vec2 u_resolution;
flat out int v_tone;
void main() {
  vec2 position = a_rect.xy + a_corner * a_rect.zw;
  vec2 clip = vec2(position.x / u_resolution.x * 2.0 - 1.0,
                   1.0 - position.y / u_resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_tone = int(a_tone);
}
)";

constexpr const char* kFragmentShader = R"(#version 300 es
precision mediump float;
flat in int v_tone;
uniform vec3 u_toneColors[6];
out vec4 out_color;
void main() {
  out_color = vec4(u_toneColors[v_tone], 1.0);
}
)";

std::string g_last_error;

int fail(const char* reason) {
  g_last_error = reason;
  return 0;
}

int fail(const char* prefix, const char* detail) {
  g_last_error = prefix;
  if (detail != nullptr && detail[0] != '\0') {
    g_last_error += detail;
  }
  return 0;
}

bool parseHexColor(const char* hex, float& red, float& green, float& blue) {
  if (hex == nullptr || hex[0] != '#' || hex[7] != '\0') {
    return false;
  }
  unsigned int value = 0;
  for (int index = 1; index < 7; ++index) {
    const char character = hex[index];
    unsigned int digit = 0;
    if (character >= '0' && character <= '9') {
      digit = static_cast<unsigned int>(character - '0');
    } else if (character >= 'a' && character <= 'f') {
      digit = static_cast<unsigned int>(character - 'a' + 10);
    } else if (character >= 'A' && character <= 'F') {
      digit = static_cast<unsigned int>(character - 'A' + 10);
    } else {
      return false;
    }
    value = value * 16U + digit;
  }
  red = static_cast<float>((value >> 16U) & 0xFFU) / 255.0F;
  green = static_cast<float>((value >> 8U) & 0xFFU) / 255.0F;
  blue = static_cast<float>(value & 0xFFU) / 255.0F;
  return true;
}

// Loads one tone colour from the generated token header into the GL palette; the
// shader receives it as a uniform array, so no visual value is hard-coded here.
bool loadToneColor(const char* token, float* destination) {
  return parseHexColor(token, destination[0], destination[1], destination[2]);
}

GLuint compileShader(GLenum type, const char* source) {
  const GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  GLint compiled = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
  if (compiled == GL_FALSE) {
    GLsizei length = 0;
    char log[1024] = {};
    glGetShaderInfoLog(shader, static_cast<GLsizei>(sizeof(log)), &length, log);
    fail("shader compile failed: ", log);
    glDeleteShader(shader);
    return 0;
  }
  return shader;
}

class Renderer {
 public:
  bool create(const char* canvasSelector) {
    if (created_) {
      return true;
    }
    EmscriptenWebGLContextAttributes attributes;
    emscripten_webgl_init_context_attributes(&attributes);
    attributes.majorVersion = 2;
    attributes.minorVersion = 0;
    attributes.alpha = false;
    attributes.depth = false;
    attributes.stencil = false;
    attributes.antialias = false;
    attributes.premultipliedAlpha = false;
    attributes.preserveDrawingBuffer = false;
    attributes.enableExtensionsByDefault = true;

    context_ = emscripten_webgl_create_context(canvasSelector, &attributes);
    if (context_ == 0) {
      fail("could not create a WebGL2 context on the canvas");
      return false;
    }
    if (emscripten_webgl_make_context_current(context_) != EMSCRIPTEN_RESULT_SUCCESS) {
      fail("could not activate the WebGL2 context");
      return false;
    }

    if (!loadToneColor(tokens::card, tone_colors_[0]) ||
        !loadToneColor(tokens::tone_a, tone_colors_[1]) ||
        !loadToneColor(tokens::tone_b, tone_colors_[2]) ||
        !loadToneColor(tokens::tone_c, tone_colors_[3]) ||
        !loadToneColor(tokens::tone_d, tone_colors_[4]) ||
        !loadToneColor(tokens::tone_e, tone_colors_[5])) {
      fail("generated tone tokens are not hexadecimal colours");
      return false;
    }
    if (!parseHexColor(tokens::canvas, clear_color_[0], clear_color_[1], clear_color_[2])) {
      fail("generated canvas token is not a hexadecimal colour");
      return false;
    }

    if (!buildProgram()) {
      return false;
    }
    buildBuffers();
    created_ = true;
    return true;
  }

  int resize(int cssWidth, int cssHeight, float devicePixelRatio) {
    if (!created_) {
      return fail("engine_create must be called before engine_resize");
    }
    if (cssWidth <= 0 || cssHeight <= 0) {
      return fail("canvas size must be positive");
    }
    if (!std::isfinite(devicePixelRatio) || devicePixelRatio <= 0.0F) {
      return fail("device pixel ratio must be positive and finite");
    }
    css_width_ = cssWidth;
    css_height_ = cssHeight;
    device_pixel_ratio_ = devicePixelRatio;
    return 1;
  }

  int setCamera(double panX, double panY, double zoom) {
    if (!created_) {
      return fail("engine_create must be called before engine_set_camera");
    }
    // Atomic: a rejected zoom must not leave a partially updated pan behind.
    const Status status = camera_.setView(panX, panY, zoom);
    if (!status) {
      return fail(status.reason);
    }
    return 1;
  }

  int loadRectangles(const float* rectangles, int count) {
    if (!created_) {
      return fail("engine_create must be called before engine_load_rectangles");
    }
    const int maxRectangles = static_cast<int>(Document::kMaxRectangles);
    if (count < 0 || count > maxRectangles) {
      return fail("rectangle count is outside the supported range");
    }
    if (count > 0 && rectangles == nullptr) {
      return fail("rectangle data must not be null");
    }

    document_.clear();
    for (int index = 0; index < count; ++index) {
      const float* data =
          rectangles + static_cast<std::size_t>(index) * static_cast<std::size_t>(kInstanceStrideFloats);
      Rectangle rectangle;
      rectangle.x = data[0];
      rectangle.y = data[1];
      rectangle.width = data[2];
      rectangle.height = data[3];
      const int tone = static_cast<int>(std::lround(data[4]));
      rectangle.tone = static_cast<Tone>(std::clamp(tone, 0, kToneCount - 1));
      switch (std::clamp(static_cast<int>(std::lround(data[5])), 0, 2)) {
        case 0:
          rectangle.layer = Layer::zones;
          break;
        case 1:
          rectangle.layer = Layer::blocks;
          break;
        default:
          rectangle.layer = Layer::noteCards;
          break;
      }
      char fractionalIndex[16] = {};
      std::snprintf(fractionalIndex, sizeof(fractionalIndex), "%012d", index);
      rectangle.z = fractionalIndex;

      const Status status = document_.addRectangle(std::move(rectangle));
      if (!status) {
        return fail(status.reason);
      }
    }
    spatial_.rebuild(document_);
    return 1;
  }

  int renderFrame() {
    if (!created_) {
      return fail("engine_create must be called before engine_render_frame");
    }
    if (css_width_ <= 0 || css_height_ <= 0) {
      return fail("engine_resize must be called before engine_render_frame");
    }
    const Status status =
        commands_.build(document_, camera_, static_cast<double>(css_width_),
                        static_cast<double>(css_height_), spatial_);
    if (!status) {
      return fail(status.reason);
    }

    int drawingWidth = 0;
    int drawingHeight = 0;
    if (emscripten_webgl_get_drawing_buffer_size(context_, &drawingWidth, &drawingHeight) !=
        EMSCRIPTEN_RESULT_SUCCESS) {
      drawingWidth = static_cast<int>(std::lround(static_cast<double>(css_width_) *
                                                  static_cast<double>(device_pixel_ratio_)));
      drawingHeight = static_cast<int>(std::lround(static_cast<double>(css_height_) *
                                                   static_cast<double>(device_pixel_ratio_)));
    }
    glViewport(0, 0, drawingWidth, drawingHeight);
    glClearColor(clear_color_[0], clear_color_[1], clear_color_[2], 1.0F);
    glClear(GL_COLOR_BUFFER_BIT);

    if (commands_.empty()) {
      return 1;
    }
    glUseProgram(program_);
    glUniform2f(resolution_uniform_, static_cast<GLfloat>(css_width_),
                static_cast<GLfloat>(css_height_));
    glUniform3fv(tone_colors_uniform_, kToneCount, &tone_colors_[0][0]);
    glBindVertexArray(vertex_array_);
    glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
    glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(commands_.byteSize()),
                    commands_.bytes());
    glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, static_cast<GLsizei>(commands_.size()));
    glBindVertexArray(0);
    glUseProgram(0);
    return 1;
  }

  const char* lastError() const { return g_last_error.c_str(); }

 private:
  bool buildProgram() {
    const GLuint vertexShader = compileShader(GL_VERTEX_SHADER, kVertexShader);
    if (vertexShader == 0) {
      return false;
    }
    const GLuint fragmentShader = compileShader(GL_FRAGMENT_SHADER, kFragmentShader);
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
      fail("shader link failed: ", log);
      return false;
    }
    resolution_uniform_ = glGetUniformLocation(program_, "u_resolution");
    tone_colors_uniform_ = glGetUniformLocation(program_, "u_toneColors");
    if (resolution_uniform_ < 0 || tone_colors_uniform_ < 0) {
      fail("shader uniforms were not found");
      return false;
    }
    return true;
  }

  void buildBuffers() {
    const GLfloat quad[8] = {0.0F, 0.0F, 1.0F, 0.0F, 0.0F, 1.0F, 1.0F, 1.0F};
    glGenBuffers(1, &quad_buffer_);
    glBindBuffer(GL_ARRAY_BUFFER, quad_buffer_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);

    glGenBuffers(1, &instance_buffer_);
    glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
    // Allocate once for the maximum document size; frames only update a prefix.
    glBufferData(GL_ARRAY_BUFFER,
                 static_cast<GLsizeiptr>(Document::kMaxRectangles * sizeof(Instance)), nullptr,
                 GL_DYNAMIC_DRAW);

    glGenVertexArrays(1, &vertex_array_);
    glBindVertexArray(vertex_array_);
    glBindBuffer(GL_ARRAY_BUFFER, quad_buffer_);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);

    glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, static_cast<GLsizei>(sizeof(Instance)),
                          reinterpret_cast<const void*>(offsetof(Instance, x)));
    glVertexAttribDivisor(1, 1);
    glEnableVertexAttribArray(2);
    glVertexAttribIPointer(2, 1, GL_UNSIGNED_INT, static_cast<GLsizei>(sizeof(Instance)),
                           reinterpret_cast<const void*>(offsetof(Instance, tone)));
    glVertexAttribDivisor(2, 1);
    glBindVertexArray(0);
  }

  Document document_;
  Camera camera_;
  SpatialIndex spatial_;
  CommandBuffer commands_;
  EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context_{0};
  GLuint program_{0};
  GLuint vertex_array_{0};
  GLuint quad_buffer_{0};
  GLuint instance_buffer_{0};
  GLint resolution_uniform_{-1};
  GLint tone_colors_uniform_{-1};
  float tone_colors_[kToneCount][3] = {};
  float clear_color_[3] = {};
  int css_width_{0};
  int css_height_{0};
  float device_pixel_ratio_{1.0F};
  bool created_{false};
};

Renderer g_renderer;

}  // namespace
}  // namespace air::engine

AIR_ENGINE_RENDER_GL_API int engine_create(const char* canvas_selector) {
  return air::engine::g_renderer.create(canvas_selector) ? 1 : 0;
}

AIR_ENGINE_RENDER_GL_API int engine_resize(int css_width, int css_height,
                                           float device_pixel_ratio) {
  return air::engine::g_renderer.resize(css_width, css_height, device_pixel_ratio);
}

AIR_ENGINE_RENDER_GL_API int engine_set_camera(double pan_x, double pan_y, double zoom) {
  return air::engine::g_renderer.setCamera(pan_x, pan_y, zoom);
}

AIR_ENGINE_RENDER_GL_API int engine_load_rectangles(const float* rectangles, int count) {
  return air::engine::g_renderer.loadRectangles(rectangles, count);
}

AIR_ENGINE_RENDER_GL_API int engine_render_frame() {
  return air::engine::g_renderer.renderFrame();
}

AIR_ENGINE_RENDER_GL_API const char* engine_last_error() {
  return air::engine::g_renderer.lastError();
}

#else  // !defined(__EMSCRIPTEN__)

// Native builds compile the C ABI as stubs so the C++ unit suite and the static
// library stay green; the WebGL2 renderer only exists in the WebAssembly build.
namespace {
constexpr const char* kRendererUnavailable =
    "WebGL2 renderer is only available in the WebAssembly build";
}  // namespace

AIR_ENGINE_RENDER_GL_API int engine_create(const char* canvas_selector) {
  (void)canvas_selector;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_resize(int css_width, int css_height,
                                           float device_pixel_ratio) {
  (void)css_width;
  (void)css_height;
  (void)device_pixel_ratio;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_set_camera(double pan_x, double pan_y, double zoom) {
  (void)pan_x;
  (void)pan_y;
  (void)zoom;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_load_rectangles(const float* rectangles, int count) {
  (void)rectangles;
  (void)count;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_render_frame() { return 0; }

AIR_ENGINE_RENDER_GL_API const char* engine_last_error() { return kRendererUnavailable; }

#endif  // defined(__EMSCRIPTEN__)
