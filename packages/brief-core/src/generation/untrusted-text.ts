import { stripKnownFences, stripKnownProseFences } from "./fences";
import { escapeHiddenCharacters, HIDDEN_CHARS } from "../hidden-chars";
import { redactDiffSecrets, redactProseSecrets } from "./redaction";
import type {
  ChangeGroup,
  IntentCheckGeneration,
  ReadingOrderStep,
} from "../types";

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

export function removeHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARS, "");
}

/** Line breaks as Markdown reads them, so a line pattern sees every one. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** For prose, the prompt and the quote corpus alike. */
export function sanitizeUntrustedText(text: string): string {
  const visible = removeHiddenMarkup(normalizeLineBreaks(text));
  const redacted = redactProseSecrets(visible, removeHiddenCharacters);
  return stripKnownProseFences(redacted.text);
}

/** Unicode's mandatory line breaks; a `\r` is already `\n` after `normalizeLineBreaks`. */
const LINE_BREAK = /[\n\v\f\u0085\u2028\u2029]/g;

/** For a field the prompt shows on one line, an id, a title or a path: a line break in it becomes a space, so it never starts a line. */
export function sanitizeUntrustedLine(text: string): string {
  return sanitizeUntrustedText(text).replace(LINE_BREAK, " ");
}

/** The one heading the summary rule allows, as the page's `splitBriefSummary` reads it: depth two, any case, an optional closing sequence. */
const CHANGELOG_HEADING_LINE = /^ {0,3}##[ \t]+changelog(?:[ \t]+#+)?[ \t]*$/i;

/** A Markdown ATX heading line, at any indent and inside any block quote or list item: one to six `#`, then a space, a tab or the line's end. */
const HEADING_LINE = new RegExp(
  String.raw`^(${CONTAINER_PREFIX})(#{1,6}(?:[ \t][^\n]*)?)$`,
);

/** A setext underline in the same places, which turns the text line above it into a heading. */
const SETEXT_UNDERLINE = new RegExp(
  String.raw`^(${CONTAINER_PREFIX})((?:=+|-+)[ \t]*)$`,
);

function escapeHeadingLine(
  line: string,
  prefix: string,
  heading: string,
): string {
  if (CHANGELOG_HEADING_LINE.test(line)) {
    return line;
  }
  return `${prefix}\\${heading}`;
}

/** A summary's prose-sanitized text, every line break a `\n`. */
function splitSummaryLines(text: string): string[] {
  return sanitizeUntrustedText(text).replace(LINE_BREAK, "\n").split("\n");
}

/** One summary line with the heading it would open escaped; `previousLine` decides a setext underline. */
function escapeSummaryLine(
  line: string,
  previousLine: string | undefined,
): string {
  const followsText = (previousLine ?? "").trim() !== "";
  if (followsText && SETEXT_UNDERLINE.test(line)) {
    return line.replace(SETEXT_UNDERLINE, "$1\\$2");
  }
  return line.replace(HEADING_LINE, escapeHeadingLine);
}

/** Each line of `lines` as the prompt shows it. */
function escapeSummaryLines(lines: readonly string[]): string[] {
  return lines.map((line, index) => escapeSummaryLine(line, lines[index - 1]));
}

/** For a PR summary sharing a fence with other sections: every heading but the allowed one is escaped, so none starts a section. */
export function sanitizeUntrustedSummary(text: string): string {
  return escapeSummaryLines(splitSummaryLines(text)).join("\n");
}

/**
 * The model copies a summary line as the prompt spelled it, backslash
 * included where `sanitizeUntrustedSummary` escaped a heading of
 * `shownSummary`. Maps each such line back to its heading; a spelling the
 * shown summary also held unescaped stays as written.
 */
export function restoreEscapedHeadings(
  summary: string,
  shownSummary: string,
): string {
  const plainLines = splitSummaryLines(shownSummary);
  const plain = new Set(plainLines);
  const headings = new Map<string, string>();
  escapeSummaryLines(plainLines).forEach((escaped, index) => {
    const line = plainLines[index];
    if (line !== undefined && escaped !== line && !plain.has(escaped)) {
      headings.set(escaped, line);
    }
  });
  if (headings.size === 0) {
    return summary;
  }

  const lines = summary.split("\n");
  return lines.map((line) => headings.get(line) ?? line).join("\n");
}

/** For a diff: escapes and redaction markers stay on their line so ranges hold; HTML comments are code here. */
export function sanitizeUntrustedDiff(diff: string): string {
  const redacted = redactDiffSecrets(diff, escapeHiddenCharacters);
  return stripKnownFences(redacted.text);
}

/** For a path a diff-derived title shows on one line: a line break in it becomes a space, so it never starts a line. */
export function sanitizeUntrustedDiffLine(text: string): string {
  const sanitized = sanitizeUntrustedDiff(normalizeLineBreaks(text));
  return sanitized.replace(LINE_BREAK, " ");
}

/**
 * The spellings under which the prompt showed each raw value, mapped back to
 * it; a spelling two raw values share maps to nothing. A raw value shown as
 * itself needs no entry.
 */
function indexShownSpellings(
  rawValues: readonly string[],
  sanitizers: readonly ((text: string) => string)[],
): Map<string, string | undefined> {
  const shown = new Map<string, string | undefined>();
  for (const raw of new Set(rawValues)) {
    for (const sanitize of sanitizers) {
      const spelling = sanitize(raw);
      const claimed = shown.has(spelling) && shown.get(spelling) !== raw;
      if (spelling !== raw) {
        shown.set(spelling, claimed ? undefined : raw);
      }
    }
  }
  return shown;
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
  const shown = indexShownSpellings(rawPaths, [
    sanitizeUntrustedText,
    sanitizeUntrustedDiff,
    sanitizeUntrustedLine,
    sanitizeUntrustedDiffLine,
  ]);

  return chunks.map((chunk) => {
    const restored = raw.has(chunk.file) ? undefined : shown.get(chunk.file);
    return restored === undefined ? chunk : { ...chunk, file: restored };
  });
}

/**
 * Reads a group id back: the one-line spelling a prompt showed maps to the
 * stored id, and a stored id, an unknown one or a spelling two stored ids
 * share stays as written.
 */
export function createGroupIdRestorer(
  rawGroupIds: readonly string[],
): (groupId: string) => string {
  const raw = new Set(rawGroupIds);
  const shown = indexShownSpellings(rawGroupIds, [sanitizeUntrustedLine]);

  return (groupId) => {
    if (raw.has(groupId)) {
      return groupId;
    }
    return shown.get(groupId) ?? groupId;
  };
}

/** The same for the group each chunk names. */
export function restoreRawGroupIds<
  GroupChunk extends { readonly changeGroupId: string },
>(chunks: readonly GroupChunk[], rawGroupIds: readonly string[]): GroupChunk[] {
  const restoreGroupId = createGroupIdRestorer(rawGroupIds);

  return chunks.map((chunk) => {
    const restored = restoreGroupId(chunk.changeGroupId);
    return restored === chunk.changeGroupId
      ? chunk
      : { ...chunk, changeGroupId: restored };
  });
}

/** The fields of a brief or grouping answer that name a group by id. */
export interface GroupReferences {
  changeGroups: ChangeGroup[];
  readingOrder?: ReadingOrderStep[] | undefined;
  intentCheck: IntentCheckGeneration;
}

/** The same for an answer's groups, reading order and intent items. */
export function restoreGroupReferences(
  answer: GroupReferences,
  rawGroupIds: readonly string[],
): GroupReferences {
  const restoreGroupId = createGroupIdRestorer(rawGroupIds);
  const items = answer.intentCheck.items.map((item) => ({
    ...item,
    groupIds: item.groupIds.map(restoreGroupId),
  }));

  const restored: GroupReferences = {
    changeGroups: answer.changeGroups.map((group) => ({
      ...group,
      id: restoreGroupId(group.id),
    })),
    intentCheck: { ...answer.intentCheck, items },
  };
  if (answer.readingOrder !== undefined) {
    restored.readingOrder = answer.readingOrder.map((step) => ({
      ...step,
      groupId: restoreGroupId(step.groupId),
    }));
  }
  return restored;
}
