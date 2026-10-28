area: engine
kind: minor

Wire the existing 20-step session history to Cmd/Ctrl+Z (undo) and Shift+Cmd/Ctrl+Z (redo) through the P4-20 keyboard layer, outside fields only: each press applies exactly one stored inverse/operation through the document port/seam, new operations clear redo, depth stays 20, empty history is a no-op; a tokens-only bottom-centre DOM hint shows 'Undo: <label>' for 3 s after a successful undo (hidden by default, no layout shift, no hint for empty history or redo). Tests cover the real history/port seam, key routing incl. field focus, and hint label/timing; capture evidence desktop/mobile.
