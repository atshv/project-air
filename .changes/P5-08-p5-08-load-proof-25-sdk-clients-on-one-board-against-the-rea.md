area: sync
kind: minor

P5-08 load proof: 25 SDK clients on one board against the real sync service and slot PostgreSQL (explicit seed-ack/quiescence barriers, 5 s warm-up, >=30 s / >=5,000 ops), p95 send->ack <=150 ms with 0 errors and exact client<->client and client<->fresh-join convergence in three repetitions; fixes found by the proof: PgSyncStore.updatesAfter ordered by an output alias lexicographically (now numeric), durable log is an operations log, replay paginated for join/resync/compaction, separate 64 MiB outbound WebSocket frame bound so >1 MiB snapshots are delivered; docs/gates/load.md, quality load row and docs/realtime stage report/handoff with open points.
