// Type declarations for plaintext.mjs (contract 0.4.0).
//
// `derivePlainText` and `plainTextMatches` are the semantic source of truth for
// the note.body <-> note.plainText consistency rule; they accept an untrusted
// value because stored content may not be a valid note body and the derivation
// then falls back to an empty string.

export function derivePlainText(body: unknown): string;

export function plainTextMatches(body: unknown, plainText: unknown): boolean;
