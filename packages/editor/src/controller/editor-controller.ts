// P6-07 (L06/L09): the own contenteditable editor controller.
//
// Framework-agnostic DOM controller over the contract 0.4.0 note body. The DOM is
// only re-rendered for structural changes (Enter, Tab, marks, paste, external
// setBody), never per keystroke, so the caret and native undo behaviour stay
// inside the editor. IME composition defers change notifications until
// `compositionend`; selection is captured/restored whenever the surface is
// rebuilt and external content changes preserve the caret by block and offset.

import {
  clampHeadingLevel,
  createBlock,
  deserialiseBody,
  editableBody,
} from "../model/document.ts";
import { applyEnter, applyMark, applyTab, insertBlocks, type EditResult } from "../model/editing.ts";
import { validateHref, notePlainText } from "../model/limits.ts";
import { applyLink, removeLink as removeBlockLink } from "../model/marks.ts";
import { pastedBlocks } from "../model/paste.ts";
import { clampCaret, placeholderVisible } from "../model/selection.ts";
import type { EditorBlock, EditorCaret, EditorChange, NoteBody, NoteMark } from "../model/types.ts";

export interface EditorOptions {
  /** Accessible name of the textbox, from the host app's message catalog. */
  readonly ariaLabel: string;
  /** Placeholder shown only while the note is empty; never part of the content. */
  readonly placeholder?: string;
  readonly initialBody?: NoteBody;
  readonly onChange?: (change: EditorChange) => void;
  /** Called after an IME composition ends so the host can flush the autosave. */
  readonly onCompositionEnd?: () => void;
}

export interface SetBodyOptions {
  /** Keep the caret by block index and offset across an external content change. */
  readonly preserveSelection?: boolean;
}

export interface EditorController {
  readonly element: HTMLElement;
  mount(host: HTMLElement): void;
  unmount(): void;
  focus(): void;
  isEmpty(): boolean;
  getBlocks(): readonly EditorBlock[];
  getBody(): NoteBody;
  getPlainText(): string;
  setBody(body: NoteBody, options?: SetBodyOptions): void;
  setPlaceholder(text: string): void;
  setAriaLabel(label: string): void;
  getCaret(): EditorCaret | null;
  setCaret(caret: EditorCaret): void;
  toggleMark(mark: NoteMark): void;
  setLink(href: string): boolean;
  removeLink(): void;
  isComposing(): boolean;
}

const TEXT_NODE = 3;
const SHOW_TEXT = 4;

export function createEditor(options: EditorOptions): EditorController {
  const ownerDocument = globalThis.document;
  const root = ownerDocument.createElement("div");
  root.className = "air-editor";
  root.setAttribute("role", "textbox");
  root.setAttribute("aria-multiline", "true");
  root.setAttribute("aria-label", options.ariaLabel);
  root.setAttribute("contenteditable", "true");
  root.setAttribute("spellcheck", "true");
  root.dataset["placeholder"] = options.placeholder ?? "";

  let blocks: EditorBlock[] = deserialiseBody(options.initialBody ?? { version: "1", blocks: [] });
  let surface: HTMLElement[] = [];
  let composing = false;
  let mounted = false;

  const caretBlocks = (): EditorBlock[] => (blocks.length === 0 ? [createBlock("paragraph")] : [...blocks]);

  const updateEmptyState = (): void => {
    root.dataset["empty"] = placeholderVisible(blocks) ? "true" : "false";
  };

  const setContent = (element: HTMLElement, block: EditorBlock): void => {
    element.replaceChildren();
    if (block.text.length === 0) {
      element.append(ownerDocument.createElement("br"));
      return;
    }
    let node: Node = ownerDocument.createTextNode(block.text);
    const wrap = (tag: "strong" | "em" | "code" | "a"): void => {
      const wrapper = ownerDocument.createElement(tag);
      wrapper.append(node);
      node = wrapper;
    };
    if (block.marks.includes("code")) wrap("code");
    if (block.marks.includes("bold")) wrap("strong");
    if (block.marks.includes("italic")) wrap("em");
    if (block.marks.includes("link") && validateHref(block.href)) {
      const anchor = ownerDocument.createElement("a");
      anchor.href = block.href;
      anchor.rel = "noopener noreferrer";
      anchor.append(node);
      node = anchor;
    }
    element.append(node);
  };

  const render = (): void => {
    root.replaceChildren();
    surface = [];
    const display = blocks.length === 0 ? [createBlock("paragraph")] : blocks;
    let list: HTMLElement | null = null;
    let listOrdered: boolean | null = null;
    for (const [index, block] of display.entries()) {
      if (block.type === "list") {
        if (list === null || listOrdered !== block.ordered) {
          list = ownerDocument.createElement(block.ordered ? "ol" : "ul");
          list.className = "air-editor-list";
          listOrdered = block.ordered;
          root.append(list);
        }
        const item = ownerDocument.createElement("li");
        item.className = "air-editor-block";
        item.dataset["blockIndex"] = String(index);
        setContent(item, block);
        list.append(item);
        surface.push(item);
        continue;
      }
      list = null;
      listOrdered = null;
      const element = ownerDocument.createElement(block.type === "heading" ? `h${String(clampHeadingLevel(block.level))}` : "p");
      element.className = "air-editor-block";
      element.dataset["blockIndex"] = String(index);
      setContent(element, block);
      root.append(element);
      surface.push(element);
    }
    updateEmptyState();
  };

  const inferBlock = (element: HTMLElement): EditorBlock => {
    const tag = element.tagName.toUpperCase();
    if (tag === "LI") {
      const ordered = element.parentElement?.tagName.toUpperCase() === "OL";
      return { ...createBlock("list"), ordered };
    }
    if (/^H[1-6]$/.test(tag)) {
      return { ...createBlock("heading"), level: Number(tag.slice(1)) };
    }
    return createBlock("paragraph");
  };

  /** Read the surface text back into the block model; marks and block kinds stay. */
  const readDom = (): void => {
    const current = blocks.length === 0 ? [] : blocks;
    const next: EditorBlock[] = [];
    for (const [index, element] of surface.entries()) {
      const text = element.textContent ?? "";
      const previous = current[index];
      next.push(previous === undefined ? { ...inferBlock(element), text } : { ...previous, text });
    }
    blocks = next;
  };

  const emit = (): void => {
    const body = editableBody(blocks);
    options.onChange?.({ body, plainText: notePlainText(body), blocks: [...blocks] });
  };

  const locateTextPosition = (element: HTMLElement, rawOffset: number): { node: Node; offset: number } => {
    const walker = ownerDocument.createTreeWalker(element, SHOW_TEXT);
    let remaining = Math.max(0, rawOffset);
    let current = walker.nextNode();
    while (current !== null) {
      const length = current.textContent?.length ?? 0;
      if (remaining <= length) return { node: current, offset: remaining };
      remaining -= length;
      current = walker.nextNode();
    }
    return { node: element, offset: 0 };
  };

  const getCaret = (): EditorCaret | null => {
    const selection = ownerDocument.getSelection();
    if (selection === null || selection.rangeCount === 0 || selection.focusNode === null) return null;
    const focus = selection.focusNode;
    const startElement = focus.nodeType === TEXT_NODE ? focus.parentElement : focus instanceof Element ? focus : null;
    const blockElement = startElement?.closest("[data-block-index]");
    if (!(blockElement instanceof HTMLElement) || !root.contains(blockElement)) return null;
    const index = Number(blockElement.dataset["blockIndex"]);
    if (!Number.isInteger(index)) return null;
    const range = ownerDocument.createRange();
    try {
      range.setStart(blockElement, 0);
      range.setEnd(focus, selection.focusOffset);
    } catch {
      return null;
    }
    return clampCaret({ blockIndex: index, offset: range.toString().length }, caretBlocks());
  };

  const setCaret = (caret: EditorCaret): void => {
    const clamped = clampCaret(caret, caretBlocks());
    const element = surface[clamped.blockIndex];
    if (element === undefined) return;
    if (ownerDocument.activeElement !== root) root.focus();
    const selection = ownerDocument.getSelection();
    if (selection === null) return;
    const position = locateTextPosition(element, clamped.offset);
    const range = ownerDocument.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const applyEdit = (result: EditResult): void => {
    if (!result.changed) return;
    blocks = [...result.blocks];
    render();
    setCaret(result.caret);
    emit();
  };

  const handleInput = (): void => {
    readDom();
    updateEmptyState();
    if (composing) return;
    emit();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (composing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && !event.altKey) {
      const key = event.key.toLowerCase();
      const mark: NoteMark | null = key === "b" ? "bold" : key === "i" ? "italic" : key === "e" ? "code" : null;
      if (mark !== null) {
        event.preventDefault();
        const caret = getCaret() ?? { blockIndex: 0, offset: 0 };
        applyEdit(applyMark(caretBlocks(), caret, mark));
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      const caret = getCaret() ?? { blockIndex: 0, offset: 0 };
      applyEdit(applyEnter(caretBlocks(), caret));
      return;
    }
    if (event.key === "Tab" && !event.altKey) {
      event.preventDefault();
      const caret = getCaret() ?? { blockIndex: 0, offset: 0 };
      applyEdit(applyTab(caretBlocks(), caret, event.shiftKey));
    }
  };

  const insertPastedText = (payload: { readonly plainText?: string; readonly html?: string }): void => {
    const inserted = pastedBlocks(payload);
    if (inserted.length === 0) return;
    const caret = getCaret() ?? { blockIndex: 0, offset: 0 };
    applyEdit(insertBlocks(caretBlocks(), caret, inserted));
  };

  const handlePaste = (event: ClipboardEvent): void => {
    event.preventDefault();
    const data = event.clipboardData;
    if (data === null) return;
    insertPastedText({ plainText: data.getData("text/plain"), html: data.getData("text/html") });
  };

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    const data = event.dataTransfer;
    if (data === null) return;
    insertPastedText({ plainText: data.getData("text/plain"), html: data.getData("text/html") });
  };

  const handleCompositionStart = (): void => {
    composing = true;
  };

  const handleCompositionEnd = (): void => {
    composing = false;
    readDom();
    updateEmptyState();
    emit();
    options.onCompositionEnd?.();
  };

  render();

  return {
    element: root,
    mount(host: HTMLElement): void {
      if (mounted) return;
      host.append(root);
      root.addEventListener("input", handleInput);
      root.addEventListener("keydown", handleKeyDown);
      root.addEventListener("paste", handlePaste);
      root.addEventListener("drop", handleDrop);
      root.addEventListener("compositionstart", handleCompositionStart);
      root.addEventListener("compositionend", handleCompositionEnd);
      mounted = true;
    },
    unmount(): void {
      if (!mounted) return;
      root.removeEventListener("input", handleInput);
      root.removeEventListener("keydown", handleKeyDown);
      root.removeEventListener("paste", handlePaste);
      root.removeEventListener("drop", handleDrop);
      root.removeEventListener("compositionstart", handleCompositionStart);
      root.removeEventListener("compositionend", handleCompositionEnd);
      root.remove();
      mounted = false;
    },
    focus(): void {
      root.focus();
      if (getCaret() === null) setCaret({ blockIndex: 0, offset: 0 });
    },
    isEmpty(): boolean {
      return placeholderVisible(blocks);
    },
    getBlocks(): readonly EditorBlock[] {
      return blocks;
    },
    getBody(): NoteBody {
      return editableBody(blocks);
    },
    getPlainText(): string {
      return notePlainText(editableBody(blocks));
    },
    setBody(body: NoteBody, setOptions?: SetBodyOptions): void {
      const next = deserialiseBody(body);
      if (JSON.stringify(next) === JSON.stringify(blocks)) return;
      const previousCaret = setOptions?.preserveSelection === true ? getCaret() : null;
      blocks = next;
      render();
      if (previousCaret !== null) setCaret(clampCaret(previousCaret, caretBlocks()));
    },
    setPlaceholder(text: string): void {
      root.dataset["placeholder"] = text;
    },
    setAriaLabel(label: string): void {
      root.setAttribute("aria-label", label);
    },
    getCaret,
    setCaret,
    toggleMark(mark: NoteMark): void {
      const caret = getCaret() ?? { blockIndex: 0, offset: 0 };
      applyEdit(applyMark(caretBlocks(), caret, mark));
    },
    setLink(href: string): boolean {
      if (!validateHref(href)) return false;
      const caret = getCaret() ?? { blockIndex: 0, offset: 0 };
      const target = caretBlocks();
      const index = Math.min(target.length - 1, Math.max(0, caret.blockIndex));
      blocks = target.map((block, position) => (position === index ? applyLink(block, href) : block));
      render();
      setCaret(caret);
      emit();
      return true;
    },
    removeLink(): void {
      const caret = getCaret() ?? { blockIndex: 0, offset: 0 };
      const target = caretBlocks();
      const index = Math.min(target.length - 1, Math.max(0, caret.blockIndex));
      blocks = target.map((block, position) => (position === index ? removeBlockLink(block) : block));
      render();
      setCaret(caret);
      emit();
    },
    isComposing(): boolean {
      return composing;
    },
  };
}
