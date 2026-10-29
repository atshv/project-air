// P6-07: plain-text paste/drop sanitising. HTML is never trusted: the editor
// prefers clipboard `text/plain`, and `text/html` is reduced to text by removing
// scripts/styles/tags and decoding a small entity set. Control characters and
// CRLF are normalised; the pasted text becomes ordinary paragraph blocks.

import { MAX_BLOCK_TEXT, MAX_BLOCKS } from "./limits.ts";
import { createBlock } from "./document.ts";
import type { EditorBlock } from "./types.ts";

const BLOCK_LEVEL_TAGS = /<\/(?:p|div|li|h[1-6]|blockquote|tr|section|article|header|footer|pre)>/gi;
const SAFE_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
});

/** Decode only the inert entities the editor can safely represent as text. */
export function decodePastedEntities(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/gi, (entity) => SAFE_ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/&#(\d{1,7});/g, (_entity, code: string) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_entity, code: string) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(code, 16))));
}

/** Reduce HTML to text: scripts and styles vanish, block endings become newlines. */
export function plainTextFromHtml(html: string): string {
  const withoutScripts = html
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_LEVEL_TAGS, "\n")
    .replace(/<li\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, "");
  return decodePastedEntities(withBreaks).replace(/^\n+/, "").replace(/\n+$/, "");
}

/** Normalise plain text: LF newlines, no control characters, no trailing spaces. */
export function sanitizePastedText(value: string): string {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

/** The sanitised plain text of one clipboard/drop payload; plain text wins over HTML. */
export function sanitizePastePayload(payload: { readonly plainText?: string; readonly html?: string }): string {
  const plain = payload.plainText ?? "";
  if (plain.trim().length > 0) return sanitizePastedText(plain);
  const html = payload.html ?? "";
  if (html.trim().length > 0) return sanitizePastedText(plainTextFromHtml(html));
  return "";
}

/** Split an over-long line into contract-sized chunks so pasting never truncates content. */
function chunkLine(line: string): string[] {
  if (line.length <= MAX_BLOCK_TEXT) return [line];
  const chunks: string[] = [];
  for (let offset = 0; offset < line.length; offset += MAX_BLOCK_TEXT) chunks.push(line.slice(offset, offset + MAX_BLOCK_TEXT));
  return chunks;
}

/** Sanitised text -> paragraph blocks (each pasted line is one paragraph). */
export function blocksFromPastedText(text: string): EditorBlock[] {
  const sanitized = sanitizePastedText(text);
  if (sanitized.length === 0) return [];
  const blocks: EditorBlock[] = [];
  for (const line of sanitized.split("\n")) {
    for (const chunk of chunkLine(line)) {
      if (blocks.length >= MAX_BLOCKS) return blocks;
      blocks.push(createBlock("paragraph", chunk));
    }
  }
  return blocks;
}

/** One clipboard/drop payload -> paragraph blocks, never HTML and never over the limits. */
export function pastedBlocks(payload: { readonly plainText?: string; readonly html?: string }): EditorBlock[] {
  return blocksFromPastedText(sanitizePastePayload(payload));
}
