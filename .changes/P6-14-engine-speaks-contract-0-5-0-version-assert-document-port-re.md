area: engine
kind: minor

Engine speaks contract 0.5.0: version assert, document port rename/setContent, updateZone and updateBlockContent applied (kind checked, empty content removes the field), zone rename is one updateZone instead of the P4-30 group, a block-content gesture builds one updateBlockContent with the previous content as inverse, blockContentPreview and fitBlockToContent grow blocks to their content, and src/bridge/app.ts is the one bridge surface an app imports (docs: Using the engine from an app).
