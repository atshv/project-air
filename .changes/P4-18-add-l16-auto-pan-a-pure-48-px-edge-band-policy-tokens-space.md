area: engine
kind: minor

Add L16 auto-pan: a pure 48 px edge-band policy (tokens::space_48) with a time-based linear ramp from 0 at the inner edge to a bounded maximum, pointer-driven direction and 0 without a drag; one request-animation-frame loop while a single/group drag runs pans the camera view-only, rebuilds the preview so the grabbed point stays under the pointer, stops on release/cancel/lost capture/blur and still commits exactly one move/group operation with inverse; tests cover the policy (outside band, ramp bounds, directions, no drag, delta scaling), loop lifecycle and one-operation release; capture evidence desktop/mobile.
