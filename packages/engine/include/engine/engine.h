#pragma once

// Project air engine: the C++20 canvas engine compiled to WebAssembly.
//
// The exported surface is a narrow C ABI so the TypeScript bridge can load the
// module without a binding generator. The engine spike starts with the version
// call; later tasks add the command buffer and the renderer.

extern "C" {

/// Version of the engine build as a static string (`"0.1.0"` in the spike).
const char* air_engine_version();

}  // extern "C"
