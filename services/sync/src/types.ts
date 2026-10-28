// P5-03: the structural board-content shape the sync service needs. The wire
// contract stays packages/contracts/generated/types.ts; this local alias keeps
// the service build independent of the contracts source tree (the contract
// package remains the source of truth for the schema, and P5-01 froze 0.3.0).
export interface BoardContent {
  readonly contractVersion: "0.3.0";
  readonly board: Record<string, unknown>;
  readonly zones: readonly Record<string, unknown>[];
  readonly blocks: readonly Record<string, unknown>[];
  readonly cards: readonly Record<string, unknown>[];
  readonly notes: readonly Record<string, unknown>[];
  readonly edges: readonly Record<string, unknown>[];
}
