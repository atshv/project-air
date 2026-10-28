# P5-03: sync service — WebSocket protocol, auth and durable update log

`services/sync` implements contract 0.3.0 sync over its own minimal RFC 6455
WebSocket server on `node:http`: hello/version/session validation, platform-
authorized joinBoard with welcome+snapshot, durable operationBatch (encoded
update appended with the next per-board serverSeq in one transaction committed
before the ack), post-ack broadcast, resyncRequest catch-up from `fromServerSeq`,
leaveBoard and a presence stub. `infra/migrations/0006_sync_log.sql` adds
`sync_updates`, `sync_snapshots` and catch-up indexes; `serverSeq` is read from
the DB. Tests cover the codec (handshake vector, masking, fragmentation,
ping/pong/close, bounded size) and the protocol with injected authorizer/store/
document (hello-first, version/session rejections, authorization, join seq,
append-before-ack, failed append, catch-up, leave). Logs are structured and
secret-free; the service has typed slot config, `/health`, graceful shutdown and
pinned `pg` only.
