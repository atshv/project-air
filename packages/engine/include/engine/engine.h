#pragma once

// Project air engine: the C++20 canvas engine compiled to WebAssembly.
//
// The exported surface is a narrow C ABI so the TypeScript bridge can load the
// module without a binding generator. The engine spike starts with the version
// call; the core modules (doc, camera, spatial, render) and the render command
// buffer live next to it, and P2-03 adds the WebGL2 renderer and C API.

extern "C" {

/// Version of the engine build as a static string (`"0.1.0"` in the spike).
const char* air_engine_version();

}  // extern "C"
