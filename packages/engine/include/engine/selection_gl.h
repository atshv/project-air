#pragma once

// C ABI of the L10 selection chrome (P4-16). Selection and the live rubber band
// are presentation state: the renderer keeps the selected document slots and the
// band world rectangle for the chrome pass, which frames each visible selected
// object with 1 px tokens::accent and fills/borders the band with
// tokens::accent_soft / tokens::accent. The document, the operation payload and
// the command-buffer instance counts are untouched.
//
// Reached through createEngine(canvas).setSelection / setBand in
// packages/engine/src/bridge/engine.ts. Both calls need a created renderer and
// report failures through engine_last_error().

#include "engine/render_gl.h"

// Replaces the selection: `indices` are live document slot indices (the ones
// engine_hit_test / engine_add_rectangle return). A null pointer with count 0
// clears the selection. Unknown or removed slots are skipped (a removed object
// simply has no frame). Returns 1 on success, 0 on failure (negative count, a
// null pointer with a non-zero count, before engine_create).
AIR_ENGINE_RENDER_GL_API int engine_set_selection(const int* indices, int count);

// Sets the live rubber band in world px, or clears it with `visible == 0`. The
// geometry must be finite and non-negative when visible. Returns 1 on success,
// 0 on failure. The band is presentation-only and is cleared by a document load.
AIR_ENGINE_RENDER_GL_API int engine_set_band(double x, double y, double width, double height,
                                             int visible);
