#pragma once

// Project air engine: the C++20 canvas engine compiled to WebAssembly.
//
// The exported surface is a narrow C ABI so the TypeScript bridge can load the
// module without a binding generator. The engine spike starts with the version
// call; the core modules (doc, camera, spatial, render) and the render command
// buffer live next to it, and P2-03 adds the WebGL2 renderer and C API. P4-07
// adds the pure L19 fit helper (`engine_fit_view`), which the renderer does not
// need and which therefore stays in this renderer-independent ABI unit.

extern "C" {

/// Version of the engine build as a static string (`"0.1.0"` in the spike).
const char* air_engine_version();

/// Fits a world rectangle (the board's world bounds) into a viewport (L19) and
/// writes panX, panY and zoom to `out_pan_zoom[0]`, `[1]` and `[2]`. The result is
/// the same as Camera::fitBounds: zoom at most 100 % and never below the camera
/// minimum, the L02 top padding kept free above the content, and empty or invalid
/// bounds framed at the world origin with 100 %. Returns 1 on success and 0 on
/// failure (a non-positive or non-finite viewport, or a null output pointer).
int engine_fit_view(double bounds_x, double bounds_y, double bounds_width,
                    double bounds_height, double viewport_width, double viewport_height,
                    double* out_pan_zoom);

}  // extern "C"
