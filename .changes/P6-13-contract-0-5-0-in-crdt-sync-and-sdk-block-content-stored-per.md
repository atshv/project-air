area: sync
kind: minor

Contract 0.5.0 in crdt, sync and sdk: block content stored per entry (checklist points, lanes, lane entries, table columns, rows, cells) with fractional positions; updateBlockContent writes only the delta between the embedded previous content and the new one so concurrent edits of different entries merge; updateZone renames; kind mismatch, missing block/zone and invalid content are rejected; sync and SDK negotiate 0.5.0 and stored 0.4.0 snapshots load as 0.5.0; the SDK undo embeds the contract inverse shape so undo batches validate; tests use fileURLToPath so they run in paths with spaces.
