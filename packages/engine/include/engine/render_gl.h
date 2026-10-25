#pragma once

// WebGL2 renderer for the engine spike (P2-03). The implementation exists only in
// the WebAssembly build; the native build compiles stubs so the C++ unit suite
// stays green.
//
// The C API is exported to JavaScript (EMSCRIPTEN_KEEPALIVE) and reached through
// the thin TypeScript bridge `createEngine(canvas, options)` in
// packages/engine/src/bridge/engine.ts. The spike supports one engine instance
// per module and renders rectangles only.

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define AIR_ENGINE_RENDER_GL_API extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define AIR_ENGINE_RENDER_GL_API extern "C"
#endif

// Creates the WebGL2 context and render state for `canvas_selector` (a CSS
// selector such as "#canvas"). Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_create(const char* canvas_selector);

// Records the CSS canvas size and the device pixel ratio. The drawing buffer size
// is set by the caller; returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_resize(int css_width, int css_height,
                                           float device_pixel_ratio);

// Sets the camera (see camera.h). Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_set_camera(double pan_x, double pan_y, double zoom);

// Loads rectangles, one call per document load. Data is a packed float array with
// stride 6 per rectangle: x, y, width, height, tone ordinal (0 = neutral,
// 1..5 = tone A..E), layer ordinal (0 = zones, 1 = blocks, 2 = note cards).
// Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_load_rectangles(const float* rectangles, int count);

// Builds the P2-02 command buffer, uploads it once and issues one instanced
// drawArraysInstanced call. Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_render_frame();

// Reason of the last failed call; never null.
AIR_ENGINE_RENDER_GL_API const char* engine_last_error();
