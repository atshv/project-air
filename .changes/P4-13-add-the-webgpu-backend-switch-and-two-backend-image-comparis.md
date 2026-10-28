area: engine
kind: minor

Add the WebGPU backend switch and two-backend image comparison: ?backend=webgl2|webgpu with HUD/getState backend, adapter and fallback reason, fail-closed invalid values; WebGPU parity passes (dot grid, chrome and glyph/atlas) behind the same command buffer and text core; the visual gate captures every scene at both viewports for both backends with per-backend reference sets, fail-closed WebGPU adapter identification and a recorded cross-backend comparison (≤3% antialiasing-boundary pixels, zero interior differences), with 28 new reviewed WebGPU baselines and the 28 WebGL2 images unchanged.
