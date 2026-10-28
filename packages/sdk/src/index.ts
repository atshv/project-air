export { createClient, type ClientOptions, type ContractClient } from "./client.ts";
export { ApiError, type ApiErrorCode } from "./errors.ts";
export { createRequestId } from "./uuid.ts";
export type { SessionCredentials } from "./transport.ts";
export type { FetchLike, FetchRequest, FetchResponse } from "./fetch.ts";
export type {
  Board,
  BoardChanges,
  BoardInput,
  BoardVisibility,
  Card,
  CardChanges,
  CardInput,
  DeleteResult,
  ListQuery,
  ListResult,
  Note,
  NoteChanges,
  NoteInput,
  Workspace,
  WorkspaceChanges,
} from "./types.ts";

export {
  AUTOSAVE_DEBOUNCE_MS,
  createAutosave,
  createBoardSyncClient,
  installFlushTriggers,
  realTimers,
  SYNC_CONTRACT_VERSION,
} from "./realtime/index.ts";
export type {
  Autosave,
  AutosaveEvent,
  AutosaveOptions,
  AutosaveStatus,
  BoardSyncClient,
  BoardSyncClientOptions,
  BoardSyncEvent,
  BoardSyncStatus,
  CreateSocket,
  FlushEventTarget,
  SyncSocket,
  Timers,
} from "./realtime/index.ts";
