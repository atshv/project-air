area: engine
kind: minor

Add the L15 wheel/trackpad normalisation in the input layer: plain two-finger wheel pans 1:1, Cmd/Ctrl+wheel zooms around the pointer with a 0.1..8 clamp (metaKey on macOS, ctrlKey elsewhere), two-pointer pinch zooms around the midpoint, suppressed fields/scrollables keep their wheel without preventDefault and an active object drag/resize consumes the wheel without moving the view; the playground wheel handler only normalises and forwards through the existing view-only host callbacks (no second camera path). Tests cover mapping, anchor stability at several zooms, clamp, platform modifiers, suppressed/drag none and pinch midpoint; deterministic in-page wheel/pinch capture because CDP wheel dispatch hangs in this headless Chrome (P4-23).
