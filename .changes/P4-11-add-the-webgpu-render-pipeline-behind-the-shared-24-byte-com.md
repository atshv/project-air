area: engine
kind: minor

Add the WebGPU render pipeline behind the shared 24-byte command buffer: one WGSL instanced draw with the WebGL2 tone palette/draw order and top-left screen space, a reused bounded-growth instance GPUBuffer, resize/DPR reconfigure, asynchronous readiness with clean failures, new engine_create_webgpu/engine_render_webgpu_frame/engine_webgpu_ready C entries and native stubs, extended wasm smoke/size coverage, and an optional real-adapter browser smoke with evidence.
