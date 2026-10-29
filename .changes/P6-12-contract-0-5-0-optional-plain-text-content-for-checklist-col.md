area: contracts
kind: minor

Contract 0.5.0: optional plain-text content for checklist, columns and table blocks (new block-content-payload.schema.json with a kind that must equal the block type; 200 points, 8 lanes x 50 entries, 8 columns x 100 rows; text 500/120/200 characters; UUIDv7 ids per entry), updateBlockContent and updateZone operations with inverses carrying the previous content/title (payloads in their own schema files update-block-content-payload and update-zone-payload), valid/invalid block-content, block and operation fixtures, board-content fixture with content, 0.5.0 bump of every schema id/contractVersion/board.contracts, regenerated TS+C++ codegen, contracts docs with contract_followups; the web empty-board document takes CONTRACT_VERSION from the generated types.
