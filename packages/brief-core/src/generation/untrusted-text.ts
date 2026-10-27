import { stripKnownFences, stripKnownProseFences } from "./fences";
import { HIDDEN_CHARS } from "./hidden-chars";
import { redactDiffSecrets, redactProseSecrets } from "./redaction";

/** Up to the block a construct sits in, nested: block-quote markers, list markers, indent. */
export const CONTAINER_PREFIX = String.raw`(?:[ \t>]|[-+*][ \t]|\d{1,9}[.)][ \t])*`;

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
const LINK_DEFINITION = String.raw`^${CONTAINER_PREFIX}\[(?:\\[^\n]|\\(?=\n)|[^\]\\\n]|\n(?![ \t]*\n)){1,999}\]:[^\n]*(?:${PARAGRAPH_LINE})*(?:\n(?:[ \t>]*\n)+[ \t>]*(?: {4}| {0,3}\t)[^\n]*(?:${PARAGRAPH_LINE})*)*`;
const COMMENT_OPENER = String.raw`<!--|<!\[CDATA\[|<!|<\/(?![A-Za-z>])|<\?`;
const HIDING_MARKUP = new RegExp(
  `${LINK_DEFINITION}|(?<opener>${COMMENT_OPENER})`,
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

/** A span of text by offset, its end exclusive. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/** One forward scan; each closer search starts past the last, and the first miss ends it. */
export function findHiddenMarkup(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  HIDING_MARKUP.lastIndex = 0;

  for (
    let match = HIDING_MARKUP.exec(text);
    match !== null;
    match = HIDING_MARKUP.exec(text)
  ) {
    const opener = match.groups?.["opener"];
    if (opener === undefined) {
      ranges.push({ start: match.index, end: HIDING_MARKUP.lastIndex });
      continue;
    }

    const closer = COMMENT_CLOSERS.get(opener) ?? ">";
    const close = text.indexOf(closer, match.index + (opener === "<?" ? 1 : 2));
    if (close === -1) {
      ranges.push({ start: match.index, end: text.length });
      break;
    }
    ranges.push({ start: match.index, end: close + closer.length });
    HIDING_MARKUP.lastIndex = close + closer.length;
  }
  return ranges;
}

/** The first closer at or past `from`, asked from increasing offsets: one search per closer serves every opener before it. */
export function findCloser(
  text: string,
  closer: string,
  from: number,
  found: Map<string, number>,
): number {
  const known = found.get(closer);
  if (known !== undefined && (known === -1 || known >= from)) {
    return known;
  }
  const close = text.indexOf(closer, from);
  found.set(closer, close);
  return close;
}

/** A label holds at most 999 units of up to two characters each. */
const MAX_LABEL_CHARS = 1998;
/** A link label never spans a blank line. */
const LABEL_BREAK = /\n[ \t]*\n/g;

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  const escaped = backslashes % 2 === 1;
  return escaped;
}

/** The next unescaped `]` at or past `from`, asked from increasing offsets: one search serves every offset before it. */
export function createLabelCloseFinder(text: string): (from: number) => number {
  let known: number | undefined;
  return (from) => {
    if (known !== undefined && (known === -1 || known >= from)) {
      return known;
    }
    let close = text.indexOf("]", from);
    while (close !== -1 && isEscapedAt(text, close)) {
      close = text.indexOf("]", close + 1);
    }
    known = close;
    return close;
  };
}

function createLabelBreakFinder(text: string): (from: number) => number {
  const breaks = new RegExp(LABEL_BREAK.source, "g");
  let known: number | undefined;
  return (from) => {
    if (known !== undefined && (known === -1 || known >= from)) {
      return known;
    }
    breaks.lastIndex = from;
    known = breaks.exec(text)?.index ?? -1;
    return known;
  };
}

/**
 * The link reference definitions `LINK_DEFINITION` matches, run only where
 * a line's label closes in `]:` within bounds: the regex alone reads up to
 * 999 label units from every line start.
 */
function findLinkDefinitions(text: string): TextRange[] {
  const prefix = new RegExp(CONTAINER_PREFIX, "y");
  const definition = new RegExp(LINK_DEFINITION, "muy");
  const findLabelClose = createLabelCloseFinder(text);
  const findLabelBreak = createLabelBreakFinder(text);
  const ranges: TextRange[] = [];

  for (
    let lineStart = 0;
    lineStart < text.length;
    lineStart = text.indexOf("\n", lineStart) + 1 || text.length
  ) {
    prefix.lastIndex = lineStart;
    prefix.exec(text);
    const bracket = prefix.lastIndex;
    if (text[bracket] !== "[") {
      continue;
    }
    const close = findLabelClose(bracket + 1);
    const labelBreak = findLabelBreak(bracket);
    const labelChars = close - bracket - 1;
    const closesLabel =
      close !== -1 && labelChars >= 1 && labelChars <= MAX_LABEL_CHARS;
    const unbroken = labelBreak === -1 || labelBreak > close;
    if (!closesLabel || !unbroken || text[close + 1] !== ":") {
      continue;
    }
    definition.lastIndex = lineStart;
    if (definition.exec(text) !== null) {
      ranges.push({ start: lineStart, end: definition.lastIndex });
      lineStart = definition.lastIndex;
    }
  }
  return ranges;
}

/**
 * Every construct that may hide text, each opener read on its own, so a
 * false opener GitHub prints as text cannot swallow a real comment's start.
 * Wider than `findHiddenMarkup`: for extraction, never for the prompt.
 */
export function findPossiblyHiddenMarkup(text: string): TextRange[] {
  const ranges = findLinkDefinitions(text);

  const found = new Map<string, number>();
  for (const match of text.matchAll(new RegExp(COMMENT_OPENER, "gu"))) {
    const [opener] = match;
    const closer = COMMENT_CLOSERS.get(opener) ?? ">";
    const from = match.index + (opener === "<?" ? 1 : 2);
    const close = findCloser(text, closer, from, found);
    const end = close === -1 ? text.length : close + closer.length;
    ranges.push({ start: match.index, end });
  }
  return ranges;
}

function removeHiddenMarkup(text: string): string {
  const kept: string[] = [];
  let cursor = 0;
  for (const range of findHiddenMarkup(text)) {
    kept.push(text.slice(cursor, range.start));
    cursor = range.end;
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

/** Line breaks as Markdown reads them, so a line pattern sees every one. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function escapeHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARS, formatCodePoint);
}

/** For prose, the prompt and the quote corpus alike. */
export function sanitizeUntrustedText(text: string): string {
  const visible = removeHiddenMarkup(normalizeLineBreaks(text));
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
