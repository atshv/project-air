area: engine
kind: minor

Add WebGPU backend selection, capability probing and fallback: an injectable bounded-timeout navigator.gpu adapter/device probe with adapter identity and typed reasons, one selection decision point for auto/webgl2/webgpu with exactly one created renderer, auto preferring WebGPU with WebGL2 fallback (and clean strict failure for explicit webgpu), asynchronous readiness handling that abandons a failed WebGPU backend before fallback, active-backend/reason C ABI entries and bridge fields, native stubs, wasm smoke coverage, fake-branch unit tests and an optional real-browser selection smoke.
