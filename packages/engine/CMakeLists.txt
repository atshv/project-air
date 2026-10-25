# Project air — packages/engine.
#
# The toolchain is pinned in docs/versions.md: CMake 4.4.4 and Emscripten 6.0.13.
# Native builds produce the `air_engine` library and the CTest suite
# `engine_unit_tests`; `emcmake` builds the same sources into engine.js + engine.wasm.

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

# One translation unit feeds both the native library and the WASM artifact.
add_library(air_engine_objects OBJECT src/engine.cpp)
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
    "-sEXPORTED_FUNCTIONS=_air_engine_version"
    "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=createAirEngine"
  )
else()
  enable_testing()

  add_executable(engine_unit_tests test/engine_test.cpp)
  target_link_libraries(engine_unit_tests PRIVATE air_engine)
  add_test(NAME engine_unit_tests COMMAND engine_unit_tests)
endif()
