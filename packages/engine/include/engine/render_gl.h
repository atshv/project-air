#pragma once

// WebGL2 renderer for the engine (P2-03) and the document mutation / hit-test API
// of engine-core (P4-01). The implementation exists only in the WebAssembly
// build; the native build compiles stubs so the C++ unit suite stays green.
//
// The C API is exported to JavaScript (EMSCRIPTEN_KEEPALIVE) and reached through
// the thin TypeScript bridge `createEngine(canvas, options)` in
// packages/engine/src/bridge/engine.ts. The engine supports one renderer instance
// per module.
//
// Handles: engine_add_rectangle returns the object's document slot index; the
// mutation calls and engine_hit_test address live objects by that index. Every
// slot handle is invalidated by engine_load_rectangles (it replaces the whole
// document), and a removed object's slot may be reused by a later insert, so a
// handle is only valid until its object is removed or the document is reloaded.

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define AIR_ENGINE_RENDER_GL_API extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define AIR_ENGINE_RENDER_GL_API extern "C"
#endif

// Creates the WebGL2 context and render state for `canvas_selector` (a CSS
// selector such as "#canvas"). Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_create(const char* canvas_selector);

// P4-11: creates the WebGPU canvas context, device and pipeline for the same
// selector. WebGPU is browser-only; the call starts the asynchronous device
// creation and a frame before readiness fails cleanly. One renderer instance per
// C ABI module: WebGL2 and WebGPU are created in separate module instances.
AIR_ENGINE_RENDER_GL_API int engine_create_webgpu(const char* canvas_selector);

// P4-11: draws the current command buffer with one WebGPU instanced draw. Fails
// cleanly (0 + engine_last_error) before engine_create_webgpu or before the
// device/pipeline is ready.
AIR_ENGINE_RENDER_GL_API int engine_render_webgpu_frame();

// P4-11: 1 = WebGPU device and pipeline ready, 0 = asynchronous initialisation
// still running, -1 = failed or not created (engine_last_error has the reason).
AIR_ENGINE_RENDER_GL_API int engine_webgpu_ready();

// P4-12: the active backend (0 none, 1 WebGL2, 2 WebGPU) and the stable backend
// reason code (-1 before a backend exists; 0 ok, 1 webgpu-unavailable,
// 2 adapter-null, 3 device-rejected, 4 probe-timeout, 5 renderer-create-failed,
// 6 webgl2-unavailable). The bridge maps the codes to stable strings.
AIR_ENGINE_RENDER_GL_API int engine_active_backend();
AIR_ENGINE_RENDER_GL_API int engine_backend_reason();
AIR_ENGINE_RENDER_GL_API int engine_set_backend_reason(int reason);

// P4-12: abandons a WebGPU backend that failed after creation so exactly one
// renderer stays active (the bridge calls it before a WebGL2 fallback).
AIR_ENGINE_RENDER_GL_API int engine_abandon_webgpu();

// Records the CSS canvas size and the device pixel ratio. The drawing buffer size
// is set by the caller; returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_resize(int css_width, int css_height,
                                           float device_pixel_ratio);

// Sets the camera (see camera.h). Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_set_camera(double pan_x, double pan_y, double zoom);

// Loads rectangles, one call per document load; replaces the whole content, so
// every slot handle from engine_add_rectangle is invalidated. Data is a packed
// float array with stride 6 per rectangle: x, y, width, height, tone ordinal
// (0 = neutral, 1..5 = tone A..E), layer ordinal (0 = zones, 1 = blocks,
// 2 = note cards). The whole array is validated before the document is replaced:
// a rejected load returns 0 and leaves the previous document and its handles
// unchanged. Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_load_rectangles(const float* rectangles, int count);

// Adds one live rectangle without reloading the document and returns its stable
// document slot index (>= 0), or -1 on failure. The object starts with an empty
// fractional-order key (equal z keeps insertion order) until engine_update_z.
// `tone` and `layer` are the ordinals documented for engine_load_rectangles.
AIR_ENGINE_RENDER_GL_API int engine_add_rectangle(double x, double y, double width, double height,
                                                  int tone, int layer);

// Replaces the world geometry of the live object at `index`. Returns 1 on
// success, 0 on failure (unknown or removed index, non-finite or overflowing
// geometry); a rejected update leaves the document untouched.
AIR_ENGINE_RENDER_GL_API int engine_update_geometry(int index, double x, double y, double width,
                                                    double height);

// Sets the contract fractional-order key of the live object at `index` and
// re-sorts the draw order. Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_update_z(int index, const char* z);

// Removes the live object at `index`; the slot may be reused by a later insert,
// the object identity is never reused. Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_remove_object(int index);

// Topmost live object at the screen point in draw order (highest layer, then
// greatest z, then latest insertion order), as a document slot index, or -1 when
// no object is hit. A rejected non-finite point or a missing viewport also
// returns -1; engine_last_error() then holds the reason.
AIR_ENGINE_RENDER_GL_API int engine_hit_test(double screen_x, double screen_y);

// Number of instances the current document, camera and viewport render: builds
// the command buffer without drawing. Returns the count (>= 0) or -1 on failure.
AIR_ENGINE_RENDER_GL_API int engine_visible_instance_count();

// Builds the P2-02 command buffer, uploads it once and issues one instanced
// drawArraysInstanced call. Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_render_frame();

// Reason of the last failed call; never null.
AIR_ENGINE_RENDER_GL_API const char* engine_last_error();
