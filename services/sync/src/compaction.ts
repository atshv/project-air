// P5-06: snapshot compaction policy. Compaction is threshold-based (documented):
// at least COMPACTION_MIN_UPDATES pending updates after the current snapshot, so
// compaction runs rarely and bounded DB growth is maintained. The snapshot is
// written at the current board serverSeq under the per-board advisory lock and
// only updates <= that sequence are pruned. Compaction does not touch the live
// session path (it runs against the DB outside a client connection), so it
// cannot block operation batches.

import type { BoardContent } from "./types.ts";
import type { BoardDocumentFactory, SyncStore } from "./protocol.ts";

export const COMPACTION_MIN_UPDATES = 32;

export interface CompactionResult {
  readonly boardId: string;
  readonly skipped: boolean;
  readonly updatesBefore: number;
  readonly snapshotSeq: number;
  readonly pruned: number;
}

export async function compactBoard(input: {
  boardId: string;
  store: SyncStore & { writeCompactedSnapshot?: (entry: { boardId: string; boardContent: BoardContent; snapshotSeq: number; docState?: string | null }) => Promise<{ snapshotSeq: number; pruned: number }> };
  documents: BoardDocumentFactory;
  minUpdates?: number;
}): Promise<CompactionResult> {
  const threshold = input.minUpdates ?? COMPACTION_MIN_UPDATES;
  const state = await input.store.loadBoard(input.boardId);
  const baseSeq = state?.snapshotSeq ?? 1;
  const updates = await input.store.updatesAfter(input.boardId, baseSeq);
  if (updates.length < threshold || input.store.writeCompactedSnapshot === undefined) {
    return { boardId: input.boardId, skipped: true, updatesBefore: updates.length, snapshotSeq: state?.serverSeq ?? 1, pruned: 0 };
  }
  const boardOnly = { ...state!.boardContent, zones: [], blocks: [], cards: [], notes: [], edges: [] };
  const document = state!.docState != null
    ? input.documents.fromContent(boardOnly)
    : input.documents.fromContent(state!.boardContent);
  if (state!.docState != null) document.applyUpdate(state!.docState);
  for (const update of updates) document.applyUpdate(update.update);
  const written = await input.store.writeCompactedSnapshot({
    boardId: input.boardId, boardContent: document.snapshot(), snapshotSeq: state!.serverSeq, docState: document.encodeUpdate(),
  });
  return { boardId: input.boardId, skipped: false, updatesBefore: updates.length, snapshotSeq: written.snapshotSeq, pruned: written.pruned };
}
