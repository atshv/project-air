area: engine
kind: minor

Add the L14 resize gesture: eight 8 px accent handles on the selected object in the chrome pass with resize cursors and an 8 px screen hit area; anchored corner/edge drags snap the size to the 16 px grid (Shift free), clamp at the per-type minima plus the zone member-extent minimum, preview through the bridge geometry update and commit exactly one resize operation (or a group with the anchoring move for west/north handles) through the P4-05 seam; Escape/pointercancel/lost capture restore with no operation. Tests cover handle hit, anchor math, snap/Shift, minima, one-operation inverse and snapshot round trip; capture evidence at 1440x900 and 390x844.
