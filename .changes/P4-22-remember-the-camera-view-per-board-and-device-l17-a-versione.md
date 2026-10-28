area: engine
kind: minor

Remember the camera view per board and device (L17): a versioned record {version, boardId, deviceKey, panX, panY, zoom} with guarded storage access (privacy/quota/throwing getters fall back to the L19 fit), coarse viewport-class + DPR device key, per-board keys so boards never leak entries, finite-number validation and a 0.1..8 zoom clamp; a valid record is restored before the first fitted frame, writes only follow user pan/zoom (debounced 300 ms, flushed on page hide) and programmatic restore/fit never writes. Tests with a fake storage cover restore, board/device separation, invalid JSON, version mismatch, throwing/quota storage, zoom clamp, no write on restore and fit fallback.
