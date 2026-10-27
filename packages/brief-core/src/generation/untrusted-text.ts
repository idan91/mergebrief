import { stripKnownFences, stripKnownProseFences } from "./fences";
import { HIDDEN_CHARS } from "./hidden-chars";
import { redactDiffSecrets, redactProseSecrets } from "./redaction";

/** Up to the block a construct sits in, nested: block-quote markers, list markers, indent. */
const CONTAINER_PREFIX = String.raw`(?:[ \t>]|[-+*][ \t]|\d{1,9}[.)][ \t])*`;

/** A line break that does not end the paragraph; `$` would also match before U+2028. */
const PARAGRAPH_LINE = String.raw`\n(?![ \t]*(?:\n|(?![\s\S])))[^\n]*`;

/**
 * Markdown GitHub renders as nothing: link reference definitions through the
 * end of their paragraph, plus any indented block after it, which an
 * unreferenced footnote keeps, and every form its HTML
 * parser turns into a comment. Each comment opener counts as raw HTML, so an
 * unclosed one hides the rest: telling raw HTML from text, like telling a
 * real code block apart, takes a full Markdown parse, and this errs toward
 * removing visible text.
 */
const HIDING_MARKUP = new RegExp(
  String.raw`^${CONTAINER_PREFIX}\[(?:\\[^\n]|\\(?=\n)|[^\]\\\n]|\n(?![ \t]*\n)){1,999}\]:[^\n]*(?:${PARAGRAPH_LINE})*(?:\n(?:[ \t>]*\n)+[ \t>]*(?: {4}| {0,3}\t)[^\n]*(?:${PARAGRAPH_LINE})*)*|(?<opener><!--|<!\[CDATA\[|<!|<\/(?![A-Za-z>])|<\?)`,
  "gmu",
);

/** What ends each opener; the search starts inside it, so `<!-->` and `<?>` close themselves. */
const COMMENT_CLOSERS: ReadonlyMap<string, string> = new Map([
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
  ["<!", ">"],
  ["</", ">"],
  ["<?", ">"],
]);

/** One forward scan; each closer search starts past the last, and the first miss ends it. */
function removeHiddenMarkup(text: string): string {
  const kept: string[] = [];
  let cursor = 0;
  HIDING_MARKUP.lastIndex = 0;

  for (
    let match = HIDING_MARKUP.exec(text);
    match !== null;
    match = HIDING_MARKUP.exec(text)
  ) {
    const opener = match.groups?.["opener"];
    kept.push(text.slice(cursor, match.index));
    if (opener === undefined) {
      cursor = HIDING_MARKUP.lastIndex;
      continue;
    }

    const closer = COMMENT_CLOSERS.get(opener) ?? ">";
    const close = text.indexOf(closer, match.index + (opener === "<?" ? 1 : 2));
    if (close === -1) {
      cursor = text.length;
      break;
    }
    cursor = close + closer.length;
    HIDING_MARKUP.lastIndex = cursor;
  }

  kept.push(text.slice(cursor));
  return kept.join("");
}

function formatCodePoint(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  return `[U+${code.toString(16).toUpperCase().padStart(4, "0")}]`;
}

export function removeHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARS, "");
}

function escapeHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARS, formatCodePoint);
}

/** For prose, the prompt and the quote corpus alike. */
export function sanitizeUntrustedText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n");
  const visible = removeHiddenMarkup(lines);
  const redacted = redactProseSecrets(visible, removeHiddenCharacters);
  return stripKnownProseFences(redacted.text);
}

/** For a diff: escapes and redaction markers stay on their line so ranges hold; HTML comments are code here. */
export function sanitizeUntrustedDiff(diff: string): string {
  const redacted = redactDiffSecrets(diff, escapeHiddenCharacters);
  return stripKnownFences(redacted.text);
}

/**
 * The model copies a path as the prompt spelled it, which differs from the raw
 * path when sanitizing changed it. Maps it back; a spelling two raw paths share
 * stays as written.
 */
export function restoreRawPaths<FileChunk extends { readonly file: string }>(
  chunks: readonly FileChunk[],
  rawPaths: readonly string[],
): FileChunk[] {
  const raw = new Set(rawPaths);
  const shown = new Map<string, string | undefined>();
  for (const path of raw) {
    for (const spelling of [
      sanitizeUntrustedText(path),
      sanitizeUntrustedDiff(path),
    ]) {
      const claimed = shown.has(spelling) && shown.get(spelling) !== path;
      if (spelling !== path) {
        shown.set(spelling, claimed ? undefined : path);
      }
    }
  }

  return chunks.map((chunk) => {
    const restored = raw.has(chunk.file) ? undefined : shown.get(chunk.file);
    return restored === undefined ? chunk : { ...chunk, file: restored };
  });
}
