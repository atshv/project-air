# Project air — packages/engine.
#
# The toolchain is pinned in docs/versions.md: CMake 4.4.4 and Emscripten 6.0.13.
# Native builds produce the `air_engine` library and the CTest suites
# `engine_unit_tests`, `engine_core_tests` and `engine_text_tests`; `emcmake`
# builds the same sources into engine.js + engine.wasm.

cmake_minimum_required(VERSION 4.4)

project(air_engine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  add_compile_options(-Wall -Wextra -Wpedantic -Werror)
endif()

# Generated C++ headers of the contract and the design tokens (AD-3, AD-7).
set(AIR_ENGINE_INCLUDE_DIRS
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
  "${CMAKE_CURRENT_SOURCE_DIR}/../contracts/generated"
  "${CMAKE_CURRENT_SOURCE_DIR}/../ui-kit"
)

# One set of translation units feeds the native library, the tests and the WASM
# artifact.
add_library(air_engine_objects OBJECT
  src/camera.cpp
  src/doc.cpp
  src/engine.cpp
  src/render.cpp
  src/render_gl.cpp
  src/snap.cpp
  src/spatial.cpp
  src/text.cpp
  src/text_binding.cpp
  src/text_gl.cpp
)
target_include_directories(air_engine_objects PUBLIC ${AIR_ENGINE_INCLUDE_DIRS})

add_library(air_engine STATIC $<TARGET_OBJECTS:air_engine_objects>)
target_include_directories(air_engine PUBLIC ${AIR_ENGINE_INCLUDE_DIRS})

if(EMSCRIPTEN)
  # A JavaScript module without main(); the exported C ABI is the bridge surface.
  add_executable(engine $<TARGET_OBJECTS:air_engine_objects>)
  set_target_properties(engine PROPERTIES
    OUTPUT_NAME "engine"
    SUFFIX ".js"
  )
  target_link_options(engine PRIVATE
    "--no-entry"
    "-sEXPORTED_FUNCTIONS=_air_engine_version,_engine_create,_engine_resize,_engine_set_camera,_engine_load_rectangles,_engine_add_rectangle,_engine_update_geometry,_engine_update_z,_engine_remove_object,_engine_hit_test,_engine_visible_instance_count,_engine_render_frame,_engine_fit_view,_engine_snap_position,_engine_snap_guide,_engine_snap_clear,_engine_set_selection,_engine_set_band,_engine_set_zone_highlight,_engine_clear_zone_highlight,_engine_text_style,_engine_text_font_family,_engine_text_plan_atlas,_engine_text_max_texture_size,_engine_text_load_atlas,_engine_text_add_run,_engine_text_add_box_run,_engine_text_clear_runs,_engine_visible_glyph_count,_engine_text_bind_object,_engine_text_clear_bindings,_engine_text_required_height,_engine_last_error,_malloc,_free"
    "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,HEAPU8,HEAPU32,HEAPF32,HEAPF64"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=createAirEngine"
    "-sMIN_WEBGL_VERSION=2"
    "-sMAX_WEBGL_VERSION=2"
    "-sINITIAL_MEMORY=67108864"
  )
else()
  enable_testing()

  add_executable(engine_unit_tests test/engine_test.cpp)
  target_link_libraries(engine_unit_tests PRIVATE air_engine)
  add_test(NAME engine_unit_tests COMMAND engine_unit_tests)

  add_executable(engine_core_tests test/engine_core_test.cpp)
  target_link_libraries(engine_core_tests PRIVATE air_engine)
  add_test(NAME engine_core_tests COMMAND engine_core_tests)

  add_executable(engine_text_tests test/engine_text_test.cpp)
  target_link_libraries(engine_text_tests PRIVATE air_engine)
  add_test(NAME engine_text_tests COMMAND engine_text_tests)

  add_executable(engine_binding_tests test/engine_binding_test.cpp)
  target_link_libraries(engine_binding_tests PRIVATE air_engine)
  add_test(NAME engine_binding_tests COMMAND engine_binding_tests)

  add_executable(engine_zone_tests test/engine_zone_test.cpp)
  target_include_directories(engine_zone_tests PRIVATE include)
  add_test(NAME engine_zone_tests COMMAND engine_zone_tests)

  add_executable(engine_snap_tests test/engine_snap_test.cpp)
  target_link_libraries(engine_snap_tests PRIVATE air_engine)
  add_test(NAME engine_snap_tests COMMAND engine_snap_tests)
endif()
