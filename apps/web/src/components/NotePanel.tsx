// P6-07 (L04, L06, L09): the note panel overlay with the own editor.
//
// Layout/state are the L04 overlay (400 px, 12 px gap, 180 ms translate/opacity),
// L06 empty-note focus and placeholder and L09 title field. All persistence goes
// through the SDK's one autosave path: one save = one operation batch, exactly
// one `updateNoteBody` with its inverse and one `updateNote` for the title. The
// panel keeps no storage of its own (the camera pan lives in the board page).

import { useEffect, useRef, useState } from "react";

import { createAutosave, installFlushTriggers, type Autosave, type AutosaveEvent } from "../../../../packages/sdk/src/index.ts";
import {
  bodiesEqual,
  createEditor,
  type EditorController,
  type NoteBody,
} from "../../../../packages/editor/src/index.ts";
import type { Note } from "../../../../packages/contracts/generated/types.ts";
import { Button } from "./Button.tsx";
import type { Translate } from "../i18n/i18n.ts";
import { noteBodyOrEmpty, normalizeNoteTitle, shouldFocusNoteEditor, validateNoteTitle } from "../board/note.ts";
import { buildNoteSaveOperations, describeSaveError, parseSavePayload, serialiseSavePayload } from "../board/note-save.ts";
import { PANEL_MOTION_MS, type PanelPhase } from "../board/panel.ts";

export interface NotePanelProps {
  readonly t: Translate;
  readonly boardId: string;
  readonly actorId: string;
  readonly noteId: string;
  /** The referenced note or `null` when it is gone (missing state, AD-4). */
  readonly note: Note | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onClosed: () => void;
  /**
   * Sends one note save and resolves only on the server ack (L05); rejects when
   * the batch is rejected or the connection is lost before the confirmation.
   */
  readonly sendOperations: (operations: readonly Record<string, unknown>[]) => Promise<void>;
  /** L05: the board's bottom status region consumes the one autosave's events. */
  readonly onAutosaveEvent?: ((event: AutosaveEvent) => void) | undefined;
  /** L05: registers the retry control behind "Not saved – retry". */
  readonly onAutosaveReady?: ((control: { retry: () => void } | null) => void) | undefined;
}

export function NotePanel({ t, boardId, actorId, noteId, note, open, onClose, onClosed, sendOperations, onAutosaveEvent, onAutosaveReady }: NotePanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorController | null>(null);
  const autosaveRef = useRef<Autosave | null>(null);
  const titleRef = useRef(note?.title ?? "");
  const bodyRef = useRef<NoteBody>(noteBodyOrEmpty(note));
  const savedRef = useRef({ title: normalizeNoteTitle(note?.title ?? ""), body: noteBodyOrEmpty(note) });
  const externalBodyRef = useRef(JSON.stringify(noteBodyOrEmpty(note)));
  const externalTitleRef = useRef(note?.title ?? "");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const latest = useRef({ t, note, sendOperations, boardId, actorId, noteId, onClose, onClosed, onAutosaveEvent, onAutosaveReady });
  latest.current = { t, note, sendOperations, boardId, actorId, noteId, onClose, onClosed, onAutosaveEvent, onAutosaveReady };
  const [title, setTitle] = useState(note?.title ?? "");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PanelPhase>("closed");

  function pushAutosave(): void {
    const autosave = autosaveRef.current;
    if (autosave === null) return;
    const valid = validateNoteTitle(titleRef.current) === null;
    autosave.update(serialiseSavePayload({
      title: valid ? normalizeNoteTitle(titleRef.current) : savedRef.current.title,
      body: bodyRef.current,
    }));
  }

  // L04 show/hide: closed -> opening -> open -> closing -> closed.
  useEffect(() => {
    setPhase((current) => (open ? (current === "closed" || current === "closing" ? "opening" : current) : current === "open" || current === "opening" ? "closing" : current));
  }, [open]);
  useEffect(() => {
    if (phase === "opening") {
      const frame = window.requestAnimationFrame(() => setPhase("open"));
      return () => window.cancelAnimationFrame(frame);
    }
    if (phase === "closing") {
      const timer = window.setTimeout(() => setPhase("closed"), PANEL_MOTION_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase]);
  useEffect(() => {
    if (phase === "closed" && !open) latest.current.onClosed();
  }, [phase, open]);

  // L06/L09: one autosave path for title + body per open note.
  useEffect(() => {
    let confirmedSequence = 0;
    const autosave = createAutosave({
      // L05: "Saved" only after the server confirmation. The SDK's autosave
      // sequence numbers make a stale response harmless; the saved baseline
      // advances only for an acknowledged save, so a failed save is retried from
      // the last confirmed value instead of silently disappearing.
      save: async (value, sequence) => {
        const next = parseSavePayload(value);
        if (next === null) throw new Error("invalid autosave payload");
        const previous = savedRef.current;
        const id = latest.current;
        const result = buildNoteSaveOperations({ boardId: id.boardId, actorId: id.actorId, noteId: id.noteId, previous, next });
        if (result.operations.length === 0) return;
        await id.sendOperations(result.operations);
        // Only the newest acknowledged save advances the confirmed baseline; an
        // older ack that resolves later never rewinds it.
        if (sequence >= confirmedSequence) {
          confirmedSequence = sequence;
          savedRef.current = next;
        }
      },
      onChange: (event) => {
        if (event.type === "error") setSaveError(describeSaveError(event.error));
        else if (event.type === "saved") setSaveError(null);
        latest.current.onAutosaveEvent?.(event);
      },
    });
    autosaveRef.current = autosave;
    latest.current.onAutosaveReady?.({ retry: () => { void autosave.retry(); } });
    const uninstall = installFlushTriggers({
      autosave,
      windowTarget: window,
      documentTarget: document,
      isHidden: () => document.hidden,
    });
    return () => {
      // The retry control stays registered while the panel is closed but the
      // board page is alive: a failed flush on close must stay retryable. A
      // board switch clears it in the board page.
      uninstall();
      // Navigation/close still flushes the last value through the SDK autosave.
      void autosave.flush("unmount");
      autosave.detach();
      autosaveRef.current = null;
    };
  }, [noteId, boardId, actorId]);

  // L06/L09: (re)create the own editor for the current note; focus only when empty.
  useEffect(() => {
    const host = hostRef.current;
    const currentNote = latest.current.note;
    if (host === null || currentNote === null) return undefined;
    const initialTitle = currentNote.title;
    const initialBody = noteBodyOrEmpty(currentNote);
    titleRef.current = initialTitle;
    bodyRef.current = initialBody;
    savedRef.current = { title: normalizeNoteTitle(initialTitle), body: initialBody };
    externalBodyRef.current = JSON.stringify(initialBody);
    externalTitleRef.current = initialTitle;
    setTitle(initialTitle);
    setTitleError(null);
    setSaveError(null);
    const editor = createEditor({
      ariaLabel: latest.current.t("note.editorLabel"),
      placeholder: latest.current.t("note.placeholder"),
      initialBody,
      onChange: (change) => {
        bodyRef.current = change.body;
        pushAutosave();
      },
      onCompositionEnd: () => {
        void autosaveRef.current?.flush("composition");
      },
    });
    editorRef.current = editor;
    editor.mount(host);
    if (shouldFocusNoteEditor(currentNote)) editor.focus();
    return () => {
      editor.unmount();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [noteId, note?.id]);

  // External content changes (realtime) keep the caret by block and offset. Only
  // a real external body change applies: the document does not echo the panel's
  // own edits, so an unchanged stored body must never reset what is being typed.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || note === null) return;
    const external = noteBodyOrEmpty(note);
    const nextExternal = JSON.stringify(external);
    if (nextExternal === externalBodyRef.current) return;
    externalBodyRef.current = nextExternal;
    if (!bodiesEqual(external, editor.getBody())) editor.setBody(external, { preserveSelection: true });
  }, [note]);

  // External title changes (L05 realtime): a remote title edit appears in the
  // open panel unless the field is focused and holds an unsaved local edit.
  useEffect(() => {
    const external = note?.title;
    if (external === undefined || external === externalTitleRef.current) return;
    externalTitleRef.current = external;
    const focused = document.activeElement === titleInputRef.current;
    const localDirty = normalizeNoteTitle(titleRef.current) !== savedRef.current.title;
    if (focused && localDirty) return;
    titleRef.current = external;
    setTitle(external);
    setTitleError(validateNoteTitle(external));
  }, [note?.title]);

  // A language switch updates the accessible name and placeholder without a remount.
  useEffect(() => {
    editorRef.current?.setAriaLabel(t("note.editorLabel"));
    editorRef.current?.setPlaceholder(t("note.placeholder"));
  }, [t]);

  const requestClose = (): void => {
    void autosaveRef.current?.flush("panel-close");
    onClose();
  };

  const onTitleChange = (value: string): void => {
    titleRef.current = value;
    setTitle(value);
    setTitleError(validateNoteTitle(value));
    pushAutosave();
  };

  if (!open && phase === "closed") return null;

  return (
    <aside
      className="board-panel"
      role="complementary"
      aria-label={t("panel.label")}
      data-board-panel=""
      data-phase={phase}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          requestClose();
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (!event.currentTarget.contains(next)) void autosaveRef.current?.flush("blur");
      }}
    >
      <header className="board-panel-header">
        <p className="eyebrow">{t("panel.eyebrow")}</p>
        <Button variant="ghost" size="card" onClick={requestClose}>{t("panel.close")}</Button>
      </header>
      {note === null ? (
        <p className="board-panel-missing muted" role="status">{t("panel.missing")}</p>
      ) : (
        <>
          <input
            ref={titleInputRef}
            className="board-panel-title"
            type="text"
            value={title}
            aria-label={t("note.titleLabel")}
            aria-invalid={titleError !== null}
            onChange={(event) => onTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                editorRef.current?.focus();
              }
            }}
          />
          {titleError === null ? null : <p className="field-error" role="alert">{t(titleError)}</p>}
          <div className="board-panel-editor" ref={hostRef} />
          {saveError === null ? null : <p className="form-error" role="alert">{t(saveError)}</p>}
        </>
      )}
    </aside>
  );
}
