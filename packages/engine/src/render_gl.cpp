#include "engine/render_gl.h"

#if defined(__EMSCRIPTEN__)

#include <GLES3/gl3.h>
#include <emscripten/html5.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>

#include "engine/camera.h"
#include "engine/doc.h"
#include "engine/render.h"
#include "engine/render_webgpu.h"
#include "engine/selection_gl.h"
#include "engine/zone_highlight.h"
#include "engine/snap.h"
#include "engine/snap_gl.h"
#include "engine/spatial.h"
#include "renderer_internal.h"
#include "tokens.h"

namespace air::engine {
namespace {

constexpr int kToneCount = 6;

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

// L19 dot grid (design rule §8, layer 1 "canvas background"): a screen-space
// triangle with no per-dot instances. The fragment shader turns each pixel into
// world coordinates with the camera transform and paints the dots of a world grid
// whose spacing is tokens::canvas_grid; the renderer draws it below every object,
// so it is chrome and never enters the command buffer or hit testing. The camera,
// the device pixel ratio and the dot tokens travel in one packed uniform array.
constexpr const char* kGridVertexShader = R"(#version 300 es
uniform vec4 u_grid[3];  // 0: pan.xy, zoom, spacing · 1: dpr, radius, resolution.xy · 2: rgba
out vec2 v_pixel;
void main() {
  // One oversized triangle covering the viewport: no vertex buffer, no instances.
  vec2 resolution = u_grid[1].zw;
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_pixel = corner * resolution;
  vec2 clip = vec2(v_pixel.x / resolution.x * 2.0 - 1.0,
                   1.0 - v_pixel.y / resolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}
)";

constexpr const char* kGridFragmentShader = R"(#version 300 es
precision highp float;
in vec2 v_pixel;
uniform vec4 u_grid[3];  // 0: pan.xy, zoom, spacing · 1: dpr, radius, resolution.xy · 2: rgba
out vec4 out_color;
void main() {
  // Device pixels -> CSS pixels -> world coordinates (camera convention).
  vec2 css = v_pixel / u_grid[1].x;
  vec2 world = u_grid[0].xy + css / u_grid[0].z;
  // Distance to the nearest world grid point, measured in CSS pixels so the dot
  // size stays constant on screen while the spacing follows the zoom.
  vec2 nearest = floor(world / u_grid[0].w + 0.5) * u_grid[0].w;
  float distance = length((world - nearest) * u_grid[0].z);
  float coverage = 1.0 - smoothstep(u_grid[1].y - 0.5, u_grid[1].y + 0.5, distance);
  if (coverage <= 0.0) {
    discard;
  }
  out_color = vec4(u_grid[2].rgb, u_grid[2].a * coverage);
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

// Loads a token colour with an alpha channel ("rgba(r, g, b, a)") as a GL vec4.
// The dot grid draws tokens::faint over the cleared tokens::canvas surface; a
// malformed token is a build error at runtime, never a silently wrong colour.
bool parseRgbaColor(const char* value, float* rgba) {
  if (value == nullptr) {
    return false;
  }
  float red = 0.0F;
  float green = 0.0F;
  float blue = 0.0F;
  float alpha = 1.0F;
  if (std::sscanf(value, "rgba(%f, %f, %f, %f)", &red, &green, &blue, &alpha) != 4) {
    return false;
  }
  if (red < 0.0F || red > 255.0F || green < 0.0F || green > 255.0F || blue < 0.0F ||
      blue > 255.0F || alpha < 0.0F || alpha > 1.0F) {
    return false;
  }
  rgba[0] = red / 255.0F;
  rgba[1] = green / 255.0F;
  rgba[2] = blue / 255.0F;
  rgba[3] = alpha;
  return true;
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

enum class Backend { webgl2, webgpu };

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
    if (!parseRgbaColor(tokens::faint, grid_color_)) {
      fail("generated faint token is not an rgba colour");
      return false;
    }

    if (!buildProgram() || !buildGridProgram() || !detail::createTextPass()) {
      return false;
    }
    buildBuffers();
    buildGridBuffers();
    // Force the driver's grid pipeline creation outside any measured frame: the
    // first grid draw otherwise happens when the camera crosses the L19 zoom
    // threshold, and a lazy shader/pipeline compile then shows up as a one-frame
    // stall in the perf measurement. The 1x1 draw happens before the canvas is
    // resized and is removed by the first cleared frame.
    glViewport(0, 0, 1, 1);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    drawGrid(1, 1);
    glDisable(GL_BLEND);
    // An empty document is a valid document: index it now so a frame, a hit test
    // or the visible count works before the first engine_load_rectangles.
    spatial_.rebuild(document_);
    backend_ = Backend::webgl2;
    backend_reason_ = 0;
    created_ = true;
    return true;
  }

  // P4-11: a separate renderer instance for the WebGPU backend. The WebGL2 create
  // path and every WebGL2 byte stay untouched; the WebGPU module consumes the same
  // command buffer through this renderer's document/camera/spatial state.
  int createWebgpu(const char* canvasSelector) {
    if (created_) {
      return backend_ == Backend::webgpu
                 ? 1
                 : fail("a WebGL2 renderer already exists; create WebGPU in a separate module instance");
    }
    if (canvasSelector == nullptr || canvasSelector[0] == '\0') {
      return fail("engine_create_webgpu needs a canvas selector");
    }
    float toneColors[kToneCount][3] = {};
    float clear[3] = {};
    if (!loadToneColor(tokens::card, toneColors[0]) ||
        !loadToneColor(tokens::tone_a, toneColors[1]) ||
        !loadToneColor(tokens::tone_b, toneColors[2]) ||
        !loadToneColor(tokens::tone_c, toneColors[3]) ||
        !loadToneColor(tokens::tone_d, toneColors[4]) ||
        !loadToneColor(tokens::tone_e, toneColors[5])) {
      return fail("generated tone tokens are not hexadecimal colours");
    }
    if (!parseHexColor(tokens::canvas, clear[0], clear[1], clear[2])) {
      return fail("generated canvas token is not a hexadecimal colour");
    }
    if (!webgpu::create(canvasSelector, toneColors, clear)) {
      return fail(webgpu::lastError());
    }
    if (!detail::createTextDataOnly()) {
      return fail("could not prepare the WebGPU text data");
    }
    backend_ = Backend::webgpu;
    backend_reason_ = 0;
    created_ = true;
    // An empty document is valid: index it so a frame or a hit test works before
    // the first engine_load_rectangles, exactly like the WebGL2 create path.
    spatial_.rebuild(document_);
    return 1;
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
    if (backend_ == Backend::webgpu && !webgpu::resize(cssWidth, cssHeight, devicePixelRatio)) {
      return fail(webgpu::lastError());
    }
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
    // The document validates the whole packed array before it replaces the
    // content: a rejected load leaves the previous document and its spatial index
    // untouched instead of half loading and leaving a stale grid behind.
    const Status status = document_.loadPackedRectangles(rectangles, count);
    if (!status) {
      return fail(status.reason);
    }
    spatial_.rebuild(document_);
    // L10 (P4-16): selection is presentation state and never survives a document
    // reload (the old slot handles are invalid).
    selection_.clear();
    band_visible_ = false;
    highlight_.clear();
    return 1;
  }

  int addRectangle(double x, double y, double width, double height, int tone, int layer) {
    if (!created_) {
      fail("engine_create must be called before engine_add_rectangle");
      return -1;
    }
    ensureSpatialCurrent();
    Rectangle rectangle;
    rectangle.x = x;
    rectangle.y = y;
    rectangle.width = width;
    rectangle.height = height;
    rectangle.tone = toneFromOrdinal(tone);
    rectangle.layer = layerFromOrdinal(layer);

    ObjectId objectId = kInvalidObjectId;
    const Status status = document_.addObject(std::move(rectangle), objectId);
    if (!status) {
      fail(status.reason);
      return -1;
    }
    std::uint32_t slot = 0;
    const Status slotStatus = document_.slotForId(objectId, slot);
    if (!slotStatus) {
      fail(slotStatus.reason);
      return -1;
    }
    // Incremental index update: a gesture must not pay for a full document scan.
    spatial_.updateSlot(document_, slot);
    return static_cast<int>(slot);
  }

  int updateGeometry(int index, double x, double y, double width, double height) {
    if (!created_) {
      return fail("engine_create must be called before engine_update_geometry");
    }
    ensureSpatialCurrent();
    std::uint32_t slot = 0;
    const Status slotStatus = objectSlot(index, slot);
    if (!slotStatus) {
      return fail(slotStatus.reason);
    }
    const Status status =
        document_.updateGeometry(document_.rectangles()[slot].id, x, y, width, height);
    if (!status) {
      return fail(status.reason);
    }
    spatial_.updateSlot(document_, slot);
    return 1;
  }

  int updateZ(int index, const char* z) {
    if (!created_) {
      return fail("engine_create must be called before engine_update_z");
    }
    if (z == nullptr) {
      return fail("z value must not be null");
    }
    ensureSpatialCurrent();
    std::uint32_t slot = 0;
    const Status slotStatus = objectSlot(index, slot);
    if (!slotStatus) {
      return fail(slotStatus.reason);
    }
    const Status status = document_.updateZ(document_.rectangles()[slot].id, z);
    if (!status) {
      return fail(status.reason);
    }
    // The z key changes draw order but not the grid cells.
    spatial_.syncVersion(document_);
    return 1;
  }

  int removeObject(int index) {
    if (!created_) {
      return fail("engine_create must be called before engine_remove_object");
    }
    ensureSpatialCurrent();
    std::uint32_t slot = 0;
    const Status slotStatus = objectSlot(index, slot);
    if (!slotStatus) {
      return fail(slotStatus.reason);
    }
    const ObjectId objectId = document_.rectangles()[slot].id;
    const Status status = document_.removeObject(objectId);
    if (!status) {
      return fail(status.reason);
    }
    spatial_.removeSlot(document_, slot);
    return 1;
  }

  int hitTest(double screenX, double screenY) {
    if (!created_) {
      fail("engine_create must be called before engine_hit_test");
      return -1;
    }
    if (css_width_ <= 0 || css_height_ <= 0) {
      fail("engine_resize must be called before engine_hit_test");
      return -1;
    }
    HitResult result;
    const Status status =
        commands_.hitTest(document_, camera_, spatial_, static_cast<double>(css_width_),
                          static_cast<double>(css_height_), Point{screenX, screenY}, result);
    if (!status) {
      fail(status.reason);
      return -1;
    }
    return result.found ? static_cast<int>(result.slot) : -1;
  }

  int visibleInstanceCount() {
    if (!created_) {
      fail("engine_create must be called before engine_visible_instance_count");
      return -1;
    }
    if (css_width_ <= 0 || css_height_ <= 0) {
      fail("engine_resize must be called before engine_visible_instance_count");
      return -1;
    }
    // Build without uploading; this reports the current visibility, not the last
    // uploaded frame.
    const Status status = commands_.build(document_, camera_, static_cast<double>(css_width_),
                                          static_cast<double>(css_height_), spatial_);
    if (!status) {
      fail(status.reason);
      return -1;
    }
    return static_cast<int>(commands_.size());
  }

  int renderFrame() {
    if (!created_) {
      return fail("engine_create must be called before engine_render_frame");
    }
    if (css_width_ <= 0 || css_height_ <= 0) {
      return fail("engine_resize must be called before engine_render_frame");
    }
    // P6-15: bound text needs the depth-band split; a frame without bound text
    // keeps the single measured draw of the P4-03 command buffer.
    const bool interleave = detail::textBandsPresent();
    const Status status =
        commands_.build(document_, camera_, static_cast<double>(css_width_),
                        static_cast<double>(css_height_), spatial_, interleave);
    if (!status) {
      return fail(status.reason);
    }
    const std::vector<DrawBand>& bands = commands_.bands();
    const bool banded = interleave && !bands.empty();
    if (backend_ == Backend::webgpu) {
      // P4-11/P4-13: the command-buffer bytes and the chrome/glyph passes built by
      // the shared text core (same quads, palette, placements and draw order as
      // WebGL2). With bands the two passes interleave per depth band (P6-15).
      webgpu::FrameText text;
      if (!detail::webgpuTextFrame(text)) {
        return fail(g_last_error.c_str());
      }
      const bool gridVisible = Camera::gridVisibleAtZoom(camera_.zoom());
      if (!webgpu::frame(commands_.bytes(), commands_.size(), css_width_, css_height_,
                         device_pixel_ratio_, camera_.panX(), camera_.panY(), camera_.zoom(),
                         gridVisible, banded ? bands.data() : nullptr, banded ? bands.size() : 0,
                         &text)) {
        return fail(webgpu::lastError());
      }
      return 1;
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

    // Design rule §8, layer 1: the dot grid is chrome below every object, drawn as
    // one screen-space pattern instead of per-dot instances. It is hidden when the
    // camera is at or below the L19 grid threshold, so it never uploads anything
    // and never affects hit testing (it is not part of the command buffer). The
    // blend state is set only on frames that draw the grid; the object palette is
    // opaque, so the object pass never needs it.
    const bool gridVisible = Camera::gridVisibleAtZoom(camera_.zoom());
    if (gridVisible) {
      glEnable(GL_BLEND);
      glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
      drawGrid(drawingWidth, drawingHeight);
    }

    if (commands_.empty()) {
      if (gridVisible) {
        glDisable(GL_BLEND);
      }
      return drawText();
    }
    glUseProgram(program_);
    // The resolution only changes on a resize; a redundant uniform upload per
    // frame is measurable at the perf gate's frame rates.
    if (css_width_ != uniform_width_ || css_height_ != uniform_height_) {
      glUniform2f(resolution_uniform_, static_cast<GLfloat>(css_width_),
                  static_cast<GLfloat>(css_height_));
      uniform_width_ = css_width_;
      uniform_height_ = css_height_;
    }
    glBindVertexArray(vertex_array_);
    glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
    if (banded) {
      // P6-15: draw the band's objects, then the band's header chrome and bound
      // glyphs, then the next band. The tail draws the page runs and the chrome
      // that belongs above every object.
      if (!detail::prepareTextPass()) {
        return fail(g_last_error.c_str());
      }
      for (std::size_t band = 0; band < bands.size(); ++band) {
        const DrawBand& range = bands[band];
        // The text pass switches programs, VAOs and buffers, so every band
        // restores the object-pass state before its instanced draw.
        glUseProgram(program_);
        glBindVertexArray(vertex_array_);
        glBindBuffer(GL_ARRAY_BUFFER, instance_buffer_);
        glBufferSubData(GL_ARRAY_BUFFER, 0,
                        static_cast<GLsizeiptr>(range.count * sizeof(Instance)),
                        commands_.bytes() + range.first * sizeof(Instance));
        glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, static_cast<GLsizei>(range.count));
        if (!detail::drawTextBand(band)) {
          return fail(g_last_error.c_str());
        }
      }
      if (gridVisible) {
        glDisable(GL_BLEND);
      }
      if (!detail::drawTextTail()) {
        return fail(g_last_error.c_str());
      }
      return 1;
    }
    glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(commands_.byteSize()),
                    commands_.bytes());
    glDrawArraysInstanced(GL_TRIANGLE_STRIP, 0, 4, static_cast<GLsizei>(commands_.size()));
    if (gridVisible) {
      glDisable(GL_BLEND);
    }
    return drawText();
  }

  // L07 (P4-15): computes and stores the snap of the current drag. The pure core
  // in snap.cpp does the work; the renderer owns the scratch buffer and the guide
  // state the chrome pass reads. Returns the guide count or -1 on failure.
  int requestSnap(int index, double x, double y, int free, double* out) {
    if (!created_) {
      return fail("engine_create must be called before engine_snap_position");
    }
    if (css_width_ <= 0 || css_height_ <= 0) {
      return fail("engine_resize must be called before engine_snap_position");
    }
    if (out == nullptr) {
      return fail("engine_snap_position needs an output buffer");
    }
    std::uint32_t slot = 0;
    const Status status = objectSlot(index, slot);
    if (!status) {
      return fail(status.reason);
    }
    ensureSpatialCurrent();
    SnapResult result;
    const Status snapped = air::engine::snapPosition(
        document_, spatial_, camera_, slot, static_cast<double>(css_width_),
        static_cast<double>(css_height_), x, y, free != 0, snap_scratch_, result);
    if (!snapped) {
      return fail(snapped.reason);
    }
    snap_result_ = result;
    out[0] = result.x;
    out[1] = result.y;
    return static_cast<int>(result.guideCount);
  }

  int guideAt(int guideIndex, double* out) const {
    if (out == nullptr || guideIndex < 0 ||
        static_cast<std::size_t>(guideIndex) >= snap_result_.guideCount) {
      return 0;
    }
    const SnapGuide& guide = snap_result_.guides[guideIndex];
    out[0] = static_cast<double>(guide.orientation);
    out[1] = guide.position;
    out[2] = guide.start;
    out[3] = guide.end;
    return 1;
  }

  int clearSnap() {
    snap_result_.guideCount = 0;
    return 1;
  }

  // L10 (P4-16): stores the selected live slots and the live rubber band for the
  // chrome pass. Selection is presentation state: it never enters the document,
  // an operation payload or the command buffer.
  int setSelection(const int* indices, int count) {
    if (!created_) {
      return fail("engine_create must be called before engine_set_selection");
    }
    if (count < 0) {
      return fail("the selection count must not be negative");
    }
    if (count > 0 && indices == nullptr) {
      return fail("engine_set_selection needs an index buffer");
    }
    selection_.clear();
    for (int index = 0; index < count; ++index) {
      const int slot = indices[index];
      if (slot < 0) {
        return fail("selection slot indices must not be negative");
      }
      const auto candidate = static_cast<std::uint32_t>(slot);
      if (candidate >= document_.slotCount() || !document_.isLive(candidate)) {
        continue;  // a removed object simply has no frame
      }
      selection_.push_back(candidate);
    }
    return 1;
  }

  int setBand(double x, double y, double width, double height, int visible) {
    if (!created_) {
      return fail("engine_create must be called before engine_set_band");
    }
    if (visible == 0) {
      band_visible_ = false;
      return 1;
    }
    if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(width) ||
        !std::isfinite(height) || width < 0.0 || height < 0.0) {
      return fail("the band needs finite, non-negative world geometry");
    }
    band_ = Bounds{x, y, width, height};
    band_visible_ = true;
    return 1;
  }

  // L08 (P4-27): a successful drop highlights the zone for 1 s in the chrome
  // pass. Presentation state only: nothing is stored in the document.
  int setZoneHighlight(int slot) {
    if (!created_) {
      return fail("engine_create must be called before engine_set_zone_highlight");
    }
    if (slot < 0) {
      highlight_.clear();
      return 1;
    }
    const auto candidate = static_cast<std::uint32_t>(slot);
    if (candidate >= document_.slotCount() || !document_.isLive(candidate)) {
      return fail("engine_set_zone_highlight needs a live slot index");
    }
    highlight_.show(slot, nowSeconds());
    return 1;
  }

  int clearZoneHighlight() {
    highlight_.clear();
    return 1;
  }

  static double nowSeconds() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
  }

  // P4-11: explicit WebGPU frame call and readiness (asynchronous device init).
  int renderWebgpuFrame() {
    if (!created_ || backend_ != Backend::webgpu) {
      return fail("engine_create_webgpu must be called before engine_render_webgpu_frame");
    }
    return renderFrame();
  }

  int webgpuReady() {
    if (!created_ || backend_ != Backend::webgpu) {
      fail("engine_create_webgpu must be called before engine_webgpu_ready");
      return -1;
    }
    const int status = webgpu::ready();
    if (status < 0) {
      fail(webgpu::lastError());
      return -1;
    }
    return status;
  }

  // P4-12: the active backend and the stable fallback reason through the C ABI.
  // Codes: 0 no backend, 1 WebGL2, 2 WebGPU; reason -1 before a backend exists,
  // otherwise 0 ok / 1 webgpu-unavailable / 2 adapter-null / 3 device-rejected /
  // 4 probe-timeout / 5 renderer-create-failed / 6 webgl2-unavailable.
  int activeBackend() const {
    if (!created_) {
      return 0;
    }
    return backend_ == Backend::webgpu ? 2 : 1;
  }

  int backendReason() const { return created_ ? backend_reason_ : -1; }

  int setBackendReason(int reason) {
    if (!created_) {
      return fail("engine_set_backend_reason needs a created backend");
    }
    if (reason < 0 || reason > 6) {
      return fail("engine_set_backend_reason needs a reason code between 0 and 6");
    }
    backend_reason_ = reason;
    return 1;
  }

  // P4-12: abandons a WebGPU backend that failed after creation (readiness), so
  // exactly one renderer can then be created. No partial device stays active.
  int abandonWebgpu() {
    if (backend_ != Backend::webgpu) {
      return 1;
    }
    webgpu::shutdown();
    backend_ = Backend::webgl2;
    backend_reason_ = 0;
    created_ = false;
    selection_.clear();
    band_visible_ = false;
    highlight_.clear();
    return 1;
  }

  const char* lastError() const { return g_last_error.c_str(); }

  detail::FrameView frameView() const {
    return detail::FrameView{created_,
                             &camera_,
                             css_width_,
                             css_height_,
                             &document_,
                             &spatial_,
                             snap_result_.guides,
                             snap_result_.guideCount,
                             selection_.data(),
                             selection_.size(),
                             band_visible_ ? &band_ : nullptr,
                             highlightBounds(),
                             commands_.bands().data(),
                             commands_.bands().size()};
  }

 private:
  // The world bounds of the highlighted live zone while the one-second window is
  // open, or nullptr (expired, cleared, stale slot).
  const Bounds* highlightBounds() const {
    const int slot = highlight_.slot();
    if (slot < 0 || !highlight_.visible(nowSeconds())) {
      return nullptr;
    }
    const auto index = static_cast<std::size_t>(slot);
    if (index >= document_.slotCount() || !document_.isLive(index)) {
      return nullptr;
    }
    highlight_bounds_ = document_.rectangles()[index].bounds();
    return &highlight_bounds_;
  }

  // An incremental patch must never trust a stale grid: before the document is
  // mutated, an index that does not match the current document and version is
  // rebuilt. This is defence in depth against a path that left the document
  // partially populated (a rejected load, a foreign document).
  void ensureSpatialCurrent() {
    spatial_.ensureCurrent(document_);
  }

  // P4-08: glyph runs draw above every object (text_gl.cpp); a frame without
  // runs touches no GL state there.
  static int drawText() { return detail::drawTextPass() ? 1 : 0; }

  // Maps an ABI slot index to a live document slot; rejects -1, out-of-range and
  // tombstoned slots without touching the document.
  Status objectSlot(int index, std::uint32_t& slot) const {
    if (index < 0 || static_cast<std::size_t>(index) >= document_.slotCount()) {
      return Status::failure("object index is out of range");
    }
    const std::uint32_t candidate = static_cast<std::uint32_t>(index);
    if (!document_.isLive(candidate)) {
      return Status::failure("object index is not a live object");
    }
    slot = candidate;
    return Status::success();
  }

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
    // The tone palette is constant for the life of the context: upload it once
    // instead of once per frame.
    glUseProgram(program_);
    glUniform3fv(tone_colors_uniform_, kToneCount, &tone_colors_[0][0]);
    glUseProgram(0);
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

  bool buildGridProgram() {
    const GLuint vertexShader = compileShader(GL_VERTEX_SHADER, kGridVertexShader);
    if (vertexShader == 0) {
      return false;
    }
    const GLuint fragmentShader = compileShader(GL_FRAGMENT_SHADER, kGridFragmentShader);
    if (fragmentShader == 0) {
      glDeleteShader(vertexShader);
      return false;
    }
    grid_program_ = glCreateProgram();
    glAttachShader(grid_program_, vertexShader);
    glAttachShader(grid_program_, fragmentShader);
    glLinkProgram(grid_program_);
    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);

    GLint linked = 0;
    glGetProgramiv(grid_program_, GL_LINK_STATUS, &linked);
    if (linked == GL_FALSE) {
      GLsizei length = 0;
      char log[1024] = {};
      glGetProgramInfoLog(grid_program_, static_cast<GLsizei>(sizeof(log)), &length, log);
      fail("grid shader link failed: ", log);
      return false;
    }
    grid_uniform_ = glGetUniformLocation(grid_program_, "u_grid");
    if (grid_uniform_ < 0) {
      fail("grid shader uniform array was not found");
      return false;
    }
    return true;
  }

  void buildGridBuffers() {
    // The full-screen triangle is generated from gl_VertexID, so the grid needs an
    // empty vertex array and no per-dot buffer at all.
    glGenVertexArrays(1, &grid_vertex_array_);
  }

  // The whole grid state travels in one packed uniform upload and one draw: at
  // 6,000+ measured frames per second the Emscripten GL call overhead itself is
  // the frame-time cost, so the per-frame grid path stays at four GL calls.
  void drawGrid(int drawingWidth, int drawingHeight) {
    const GLfloat grid[12] = {
        static_cast<GLfloat>(camera_.panX()),   static_cast<GLfloat>(camera_.panY()),
        static_cast<GLfloat>(camera_.zoom()),   static_cast<GLfloat>(tokens::canvas_grid),
        device_pixel_ratio_,                    static_cast<GLfloat>(tokens::border_width),
        static_cast<GLfloat>(drawingWidth),     static_cast<GLfloat>(drawingHeight),
        grid_color_[0],                         grid_color_[1],
        grid_color_[2],                         grid_color_[3]};
    glUseProgram(grid_program_);
    glUniform4fv(grid_uniform_, 3, grid);
    glBindVertexArray(grid_vertex_array_);
    glDrawArrays(GL_TRIANGLES, 0, 3);
  }

  Backend backend_{Backend::webgl2};
  int backend_reason_{0};
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
  GLuint grid_program_{0};
  GLuint grid_vertex_array_{0};
  GLint grid_uniform_{-1};
  float tone_colors_[kToneCount][3] = {};
  float clear_color_[3] = {};
  float grid_color_[4] = {};
  SnapScratch snap_scratch_;
  SnapResult snap_result_{};
  std::vector<std::uint32_t> selection_;
  Bounds band_{};
  bool band_visible_{false};
  ZoneHighlightState highlight_{};
  mutable Bounds highlight_bounds_{};
  int css_width_{0};
  int css_height_{0};
  int uniform_width_{-1};
  int uniform_height_{-1};
  float device_pixel_ratio_{1.0F};
  bool created_{false};
};

Renderer g_renderer;

}  // namespace

namespace detail {

FrameView frameView() { return g_renderer.frameView(); }

void setLastError(const char* reason) { fail(reason); }

bool parseRgbaToken(const char* value, float* rgba) { return parseRgbaColor(value, rgba); }

}  // namespace detail
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

AIR_ENGINE_RENDER_GL_API int engine_add_rectangle(double x, double y, double width, double height,
                                                  int tone, int layer) {
  return air::engine::g_renderer.addRectangle(x, y, width, height, tone, layer);
}

AIR_ENGINE_RENDER_GL_API int engine_update_geometry(int index, double x, double y, double width,
                                                    double height) {
  return air::engine::g_renderer.updateGeometry(index, x, y, width, height);
}

AIR_ENGINE_RENDER_GL_API int engine_update_z(int index, const char* z) {
  return air::engine::g_renderer.updateZ(index, z);
}

AIR_ENGINE_RENDER_GL_API int engine_remove_object(int index) {
  return air::engine::g_renderer.removeObject(index);
}

AIR_ENGINE_RENDER_GL_API int engine_hit_test(double screen_x, double screen_y) {
  return air::engine::g_renderer.hitTest(screen_x, screen_y);
}

AIR_ENGINE_RENDER_GL_API int engine_visible_instance_count() {
  return air::engine::g_renderer.visibleInstanceCount();
}

AIR_ENGINE_RENDER_GL_API int engine_render_frame() {
  return air::engine::g_renderer.renderFrame();
}

AIR_ENGINE_RENDER_GL_API int engine_create_webgpu(const char* canvas_selector) {
  return air::engine::g_renderer.createWebgpu(canvas_selector);
}

AIR_ENGINE_RENDER_GL_API int engine_render_webgpu_frame() {
  return air::engine::g_renderer.renderWebgpuFrame();
}

AIR_ENGINE_RENDER_GL_API int engine_webgpu_ready() { return air::engine::g_renderer.webgpuReady(); }

AIR_ENGINE_RENDER_GL_API int engine_active_backend() {
  return air::engine::g_renderer.activeBackend();
}

AIR_ENGINE_RENDER_GL_API int engine_backend_reason() {
  return air::engine::g_renderer.backendReason();
}

AIR_ENGINE_RENDER_GL_API int engine_set_backend_reason(int reason) {
  return air::engine::g_renderer.setBackendReason(reason);
}

AIR_ENGINE_RENDER_GL_API int engine_abandon_webgpu() {
  return air::engine::g_renderer.abandonWebgpu();
}

AIR_ENGINE_RENDER_GL_API int engine_snap_position(int index, double x, double y, int free,
                                                  double* out_xy) {
  return air::engine::g_renderer.requestSnap(index, x, y, free, out_xy);
}

AIR_ENGINE_RENDER_GL_API int engine_snap_guide(int guide_index, double* out_guide) {
  return air::engine::g_renderer.guideAt(guide_index, out_guide);
}

AIR_ENGINE_RENDER_GL_API int engine_snap_clear() { return air::engine::g_renderer.clearSnap(); }

AIR_ENGINE_RENDER_GL_API int engine_set_selection(const int* indices, int count) {
  return air::engine::g_renderer.setSelection(indices, count);
}

AIR_ENGINE_RENDER_GL_API int engine_set_band(double x, double y, double width, double height,
                                             int visible) {
  return air::engine::g_renderer.setBand(x, y, width, height, visible);
}

AIR_ENGINE_RENDER_GL_API int engine_set_zone_highlight(int slot) {
  return air::engine::g_renderer.setZoneHighlight(slot);
}

AIR_ENGINE_RENDER_GL_API int engine_clear_zone_highlight() {
  return air::engine::g_renderer.clearZoneHighlight();
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

// Index-returning stubs report -1 so a caller can never mistake them for slot 0.
AIR_ENGINE_RENDER_GL_API int engine_add_rectangle(double x, double y, double width, double height,
                                                  int tone, int layer) {
  (void)x;
  (void)y;
  (void)width;
  (void)height;
  (void)tone;
  (void)layer;
  return -1;
}

AIR_ENGINE_RENDER_GL_API int engine_update_geometry(int index, double x, double y, double width,
                                                    double height) {
  (void)index;
  (void)x;
  (void)y;
  (void)width;
  (void)height;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_update_z(int index, const char* z) {
  (void)index;
  (void)z;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_remove_object(int index) {
  (void)index;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_hit_test(double screen_x, double screen_y) {
  (void)screen_x;
  (void)screen_y;
  return -1;
}

AIR_ENGINE_RENDER_GL_API int engine_visible_instance_count() { return -1; }

AIR_ENGINE_RENDER_GL_API int engine_render_frame() { return 0; }

// P4-11 native stubs: no browser API exists, so the WebGPU entry points fail
// cleanly (engine_last_error reports the reason) and never crash.
AIR_ENGINE_RENDER_GL_API int engine_create_webgpu(const char* canvas_selector) {
  (void)canvas_selector;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_render_webgpu_frame() { return 0; }

AIR_ENGINE_RENDER_GL_API int engine_webgpu_ready() { return -1; }

AIR_ENGINE_RENDER_GL_API int engine_active_backend() { return 0; }

AIR_ENGINE_RENDER_GL_API int engine_backend_reason() { return -1; }

AIR_ENGINE_RENDER_GL_API int engine_set_backend_reason(int reason) {
  (void)reason;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_abandon_webgpu() { return 0; }

AIR_ENGINE_RENDER_GL_API int engine_snap_position(int index, double x, double y, int free,
                                                  double* out_xy) {
  (void)index;
  (void)x;
  (void)y;
  (void)free;
  (void)out_xy;
  return -1;
}

AIR_ENGINE_RENDER_GL_API int engine_snap_guide(int guide_index, double* out_guide) {
  (void)guide_index;
  (void)out_guide;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_snap_clear() { return 0; }

AIR_ENGINE_RENDER_GL_API int engine_set_selection(const int* indices, int count) {
  (void)indices;
  (void)count;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_set_band(double x, double y, double width, double height,
                                             int visible) {
  (void)x;
  (void)y;
  (void)width;
  (void)height;
  (void)visible;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_set_zone_highlight(int slot) {
  (void)slot;
  return 0;
}

AIR_ENGINE_RENDER_GL_API int engine_clear_zone_highlight() { return 0; }

AIR_ENGINE_RENDER_GL_API const char* engine_last_error() { return kRendererUnavailable; }

#endif  // defined(__EMSCRIPTEN__)
