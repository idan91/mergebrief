/** `> `-prefixes every line of the quoted text (GitHub quote-reply shape). */
export function buildQuoteBlock(text: string): string {
  return text
    .trimEnd()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Appends a quote block to a draft: the block always ends with a blank
 * line (the caret lands ready to type the reply), and a non-empty draft
 * keeps one blank line between its text and the quote.
 */
export function appendQuote(existing: string, quoteBlock: string): string {
  const block = `${quoteBlock}\n\n`;
  return existing.trim() === "" ? block : `${existing.trimEnd()}\n\n${block}`;
}
