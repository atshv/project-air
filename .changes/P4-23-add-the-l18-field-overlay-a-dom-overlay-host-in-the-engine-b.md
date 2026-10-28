area: engine
kind: minor

Add the L18 field overlay: a DOM overlay host in the engine bridge that anchors plain fields to world rectangles through the camera (pan/zoom/DPR, viewport hide), owns focus open/close/restore and stops field pointer events at the field while leaving wheel defaults alone; a pure inline keyboard policy (Enter inserts below and focuses, Tab/Shift+Tab wrap, Backspace removes only an empty entry and focuses the previous) that emits intents only; a 24 px token colour field; and a playground ?edit=inline demo with a deterministic capture at 1440x900 and 390x844.
