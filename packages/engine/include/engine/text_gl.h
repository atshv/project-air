#pragma once

// C ABI of the runtime glyph atlas (P4-08, ADR-0009). The pure calls
// (engine_text_style, engine_text_font_family, engine_text_plan_atlas) work in
// both builds and need no renderer; the atlas upload, the runs and the glyph
// count need a created WebGL2 renderer and are stubs in the native build.
//
// Reached through createEngine(canvas).buildTextAtlas / addTextRun /
// clearTextRuns in packages/engine/src/bridge/engine.ts. Failures return 0 or -1
// and leave the reason in engine_last_error().

#include "engine/render_gl.h"

// Typography of a text role (0 = title, 1 = body) from tokens.h:
// out[0] font size (CSS px), out[1] font weight, out[2] line height (multiple of
// the font size). Returns 1 on success, 0 for an unknown role.
AIR_ENGINE_RENDER_GL_API int engine_text_style(int role, double* out);

// CSS font-family stack of a text role from tokens.h, or an empty string for an
// unknown role; never null.
AIR_ENGINE_RENDER_GL_API const char* engine_text_font_family(int role);

// Plans the atlas (text.h planAtlas): out[0] width, out[1] height, out[2] columns,
// out[3] rows, out[4] cell width, out[5] cell height (raster px incl. padding),
// out[6] raster scale. Returns 1 on success, 0 on failure (out untouched).
AIR_ENGINE_RENDER_GL_API int engine_text_plan_atlas(int glyph_count, double cell_width,
                                                    double cell_height,
                                                    double device_pixel_ratio,
                                                    int max_texture_size, double* out);

// GL MAX_TEXTURE_SIZE of the renderer's context, or -1 before engine_create.
AIR_ENGINE_RENDER_GL_API int engine_text_max_texture_size();

// Replaces the glyph atlas in one call: RGBA pixels (width * height * 4 bytes)
// and `glyph_count` packed metrics (text.h kGlyphMetricsStride floats each). The
// whole upload is validated first; a rejected upload returns 0 and keeps the
// previous atlas and texture. Existing runs re-resolve against the new atlas.
AIR_ENGINE_RENDER_GL_API int engine_text_load_atlas(int width, int height, double raster_scale,
                                                    const unsigned char* rgba, int byte_length,
                                                    const float* metrics, int glyph_count);

// Adds a world-anchored glyph run (top-left of the line box) of `count` Unicode
// code points in `role`. Returns 1 on success, 0 on failure.
AIR_ENGINE_RENDER_GL_API int engine_text_add_run(double x, double y, int role,
                                                 const unsigned int* code_points, int count);

// Adds a run with a layout flow (0 = line, 1 = ellipsis, 2 = wrap; P4-09) inside a
// box of `width` x `height` CSS px anchored at the top-left (x, y). The layout is
// computed from the atlas once per atlas build. Returns 1 on success, 0 on
// failure (unknown role or flow, non-finite or negative box, limits).
AIR_ENGINE_RENDER_GL_API int engine_text_add_box_run(double x, double y, int role, int flow,
                                                     double width, double height,
                                                     const unsigned int* code_points, int count);

// Removes every glyph run. Returns 1 on success, 0 before engine_create.
AIR_ENGINE_RENDER_GL_API int engine_text_clear_runs();

// Glyph quads the current runs, atlas, camera and viewport draw (>= 0), or -1 on
// failure; builds the glyph buffer without drawing.
AIR_ENGINE_RENDER_GL_API int engine_visible_glyph_count();
