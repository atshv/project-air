// P5-04: the SDK realtime boundary and the one autosave path of L05.

export { AUTOSAVE_DEBOUNCE_MS, createAutosave, installFlushTriggers } from "./autosave.ts";
export type { Autosave, AutosaveEvent, AutosaveOptions, AutosaveStatus, FlushEventTarget } from "./autosave.ts";
export { createBoardSyncClient, SYNC_CONTRACT_VERSION } from "./board-sync-client.ts";
export type { BoardSyncClient, BoardSyncClientOptions, BoardSyncEvent, BoardSyncStatus } from "./board-sync-client.ts";
export { realTimers } from "./timers.ts";
export type { Timers } from "./timers.ts";
export type { CreateSocket, SyncSocket } from "./connection.ts";
