#pragma once

// C ABI of the L07 snapping request and its guide chrome (P4-15). The pure
// snapping core lives in snap.h; these calls bind it to the renderer's working
// copy, camera and viewport and keep the guides for the chrome pass.
//
// Reached through createEngine(canvas).snapDrag / clearSnapGuides in
// packages/engine/src/bridge/engine.ts. Failures return -1 (or 0 for the guide
// accessor) and leave the reason in engine_last_error(). Guides are presentation
// state: they never enter the document, an operation payload or the
// command-buffer instance counts.

#include "engine/render_gl.h"

// Snaps the world top-left (x, y) of the live object at document slot `index`
// with the L07 rules of snap.h (`free` = the Shift modifier, non-zero frees the
// position). Writes the snapped world position to out_xy[0..1] and returns the
// number of guide lines for the next frames (0..3), or -1 on failure.
AIR_ENGINE_RENDER_GL_API int engine_snap_position(int index, double x, double y, int free,
                                                  double* out_xy);

// Copies guide `guide_index` into out_guide[0..3]: orientation (0 = vertical,
// 1 = horizontal), world position, world start and world end of the span.
// Returns 1 on success, 0 for a missing guide or a null output pointer.
AIR_ENGINE_RENDER_GL_API int engine_snap_guide(int guide_index, double* out_guide);

// Clears the guides (a drag ended, was cancelled or the view is no longer
// dragging). Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_snap_clear();
