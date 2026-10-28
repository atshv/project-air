// Contract 0.4.0: deterministic derivation of a note's search text from its
// structured body. The schema validates the body shape; this function is the
// semantic source of truth for note.body <-> note.plainText consistency.
// Rule: blocks in order, inline text joined with a single space, blocks joined
// with "\n"; list blocks prefix each non-empty block text with "- " unless
// ordered, then "N. "; leading/trailing whitespace is trimmed and inner runs of
// whitespace collapse to one space.
export function derivePlainText(body) {
  if (body === null || typeof body !== "object" || !Array.isArray(body.blocks)) return "";
  const lines = [];
  for (const block of body.blocks) {
    if (block === null || typeof block !== "object" || typeof block.text !== "string") continue;
    const text = block.text.replace(/\s+/g, " ").trim();
    if (block.type === "list") lines.push(`${block.ordered === true ? "1." : "-"} ${text}`.trim());
    else lines.push(text);
  }
  return lines.filter((line) => line.length > 0).join("\n");
}
export function plainTextMatches(body, plainText) {
  if (body === null || typeof body !== "object" || !Array.isArray(body.blocks)) return false;
  return typeof plainText === "string" && derivePlainText(body) === plainText;
}
