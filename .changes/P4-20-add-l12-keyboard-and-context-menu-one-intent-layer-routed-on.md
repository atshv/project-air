area: engine
kind: minor

Add L12 keyboard and context menu: one intent layer routed only outside fields (P4-14 suppression) with Cmd/Ctrl+D duplicate (+16/+16, one create operation, AD-4 same-note duplicate), Del/Backspace selection delete (one operation), arrow nudge series (16/160 px, preview without writing, one keyboard-nudge 300 ms after the last key), Esc priority (menu, overlay/field, selection) and menu open (right-click/Shift+F10/menu key); a tokens-only DOM context menu (200 px wide, 32 px rows, shortcuts right-aligned muted) with keyboard and pointer models that calls the same intents and closes on Esc/outside/blur/action; capture evidence desktop/mobile; tests for routing, suppression, Esc priority, nudge batching, menu model and the duplicate/nudge seam path.
