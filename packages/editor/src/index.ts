// P6-07: public surface of the own note editor (contract 0.4.0 note body).
//
// The package is framework-agnostic: the host app mounts the controller into its
// panel and persists the emitted `updateNoteBody` operation through its one
// autosave path. Pure model/editing/paste helpers are exported for tests and for
// the host's operation builders; the DOM controller lives in ./controller.

export {
  NOTE_BLOCK_TYPES,
  NOTE_MARKS,
  type EditorBlock,
  type EditorCaret,
  type EditorChange,
  type NoteBlockType,
  type NoteBody,
  type NoteMark,
} from "./model/types.ts";

export {
  HREF_PATTERN,
  MAX_BLOCK_TEXT,
  MAX_BLOCKS,
  MAX_HREF,
  MAX_HEADING_LEVEL,
  MAX_PLAINTEXT,
  MIN_HEADING_LEVEL,
  NOTE_TITLE_MAX,
  NoteValidationError,
  assertBodyWithinLimits,
  isNoteBlockType,
  isNoteMark,
  notePlainText,
  plainTextConsistent,
  validateBody,
  validateHref,
  type NoteValidationCode,
} from "./model/limits.ts";

export {
  DEFAULT_HEADING_LEVEL,
  blocksPlainText,
  bodiesEqual,
  bodyPlainText,
  clampHeadingLevel,
  createBlock,
  deserialiseBody,
  editableBody,
  emptyBody,
  isEmptyBody,
  normalizeMarks,
  parseBlock,
  serialiseBlock,
  serialiseBody,
} from "./model/document.ts";

export {
  applyEnter,
  applyMark,
  applyTab,
  clampOffset,
  indentBlock,
  insertBlocks,
  outdentBlock,
  splitBlock,
  type EditResult,
} from "./model/editing.ts";

export { applyLink, hasMark, marksAreValid, removeLink, toggleMark } from "./model/marks.ts";

export {
  blocksFromPastedText,
  decodePastedEntities,
  pastedBlocks,
  plainTextFromHtml,
  sanitizePastePayload,
  sanitizePastedText,
} from "./model/paste.ts";

export {
  caretAtEnd,
  caretAtStart,
  caretsEqual,
  clampCaret,
  insertionCaret,
  placeholderVisible,
  restoreCaret,
  shouldFocusOnOpen,
} from "./model/selection.ts";

export { createEditor, type EditorController, type EditorOptions, type SetBodyOptions } from "./controller/editor-controller.ts";
