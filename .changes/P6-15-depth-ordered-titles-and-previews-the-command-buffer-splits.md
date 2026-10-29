area: engine
kind: patch

Depth-ordered titles and previews: the command buffer splits the draw order into camera-independent depth bands and both backends interleave the object pass with each band's header chrome and bound glyphs, so a front object always covers the text of an object behind it (native engine_depth_order_tests, reviewed overlapping-titles baseline on WebGL2 and WebGPU, perf unchanged without bound text).
