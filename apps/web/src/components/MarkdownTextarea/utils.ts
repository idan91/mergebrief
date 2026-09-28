import type { TFunction } from "i18next";

export interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function applyMarkdownWrap(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
): TextEdit {
  const selected = text.slice(selectionStart, selectionEnd);
  const nextText = `${text.slice(0, selectionStart)}${marker}${selected}${marker}${text.slice(selectionEnd)}`;
  return {
    text: nextText,
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionEnd + marker.length,
  };
}

/**
 * No selection: the marker lands at the current line's start and the caret
 * stays in the text, ready to type, never a placeholder the user must
 * delete, never a selection typing would overwrite. With a selection: every
 * selected line is prefixed and the caret collapses to the end.
 */
export function applyLinePrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
): TextEdit {
  if (selectionStart === selectionEnd) {
    const lineStart = lineStartAt(text, selectionStart);
    const caret = selectionStart + prefix.length;
    return {
      text: `${text.slice(0, lineStart)}${prefix}${text.slice(lineStart)}`,
      selectionStart: caret,
      selectionEnd: caret,
    };
  }
  const selected = text.slice(selectionStart, selectionEnd);
  const replacement = selected
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
  const caret = selectionStart + replacement.length;
  return {
    text: `${text.slice(0, selectionStart)}${replacement}${text.slice(selectionEnd)}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

export function applyLinkTemplate(
  t: TFunction,
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEdit {
  const selected =
    text.slice(selectionStart, selectionEnd) ||
    t("shell.markdownToolbar.linkPlaceholder");
  const replacement = `[${selected}](https://example.com)`;
  return {
    text: `${text.slice(0, selectionStart)}${replacement}${text.slice(selectionEnd)}`,
    selectionStart: selectionStart + 1,
    selectionEnd: selectionStart + 1 + selected.length,
  };
}

interface ListItemLine {
  indent: string;
  /** The literal marker: `-`, `*`, `+`, or `3.`. */
  marker: string;
  /** `[ ]` / `[x]` when the item is a task checkbox. */
  task: boolean;
  content: string;
}

const LIST_ITEM_PATTERN = /^(\s*)([-*+]|\d+\.)( \[[ xX]\])? (.*)$/;

function parseListItemLine(line: string): ListItemLine | null {
  const match = LIST_ITEM_PATTERN.exec(line);
  if (!match) return null;
  return {
    indent: match[1] ?? "",
    marker: match[2] ?? "-",
    task: match[3] !== undefined,
    content: match[4] ?? "",
  };
}

function lineStartAt(text: string, position: number): number {
  return text.lastIndexOf("\n", position - 1) + 1;
}

function lineEndAt(text: string, position: number): number {
  const end = text.indexOf("\n", position);
  return end === -1 ? text.length : end;
}

function nextMarker(item: ListItemLine): string {
  const numbered = /^(\d+)\.$/.exec(item.marker);
  const marker = numbered ? `${Number(numbered[1]) + 1}.` : item.marker;
  return `${item.indent}${marker}${item.task ? " [ ]" : ""} `;
}

/**
 * Enter inside a list item continues the list, GitHub behavior: the new line
 * repeats the marker, incremented when numbered and unchecked when a task, and
 * text after the caret becomes the new item. Enter on an EMPTY item deletes the
 * marker. Null when the caret is not in a list item or the selection is ranged.
 */
export function continueListOnEnter(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = lineStartAt(text, selectionStart);
  const lineEnd = lineEndAt(text, selectionStart);
  const line = text.slice(lineStart, lineEnd);
  const item = parseListItemLine(line);
  if (item === null) return null;
  const prefixLength = line.length - item.content.length;
  // Caret inside the marker itself: not an intent to continue the list.
  if (selectionStart < lineStart + prefixLength) return null;
  if (item.content === "") {
    // Empty item: terminate the list, the marker line becomes empty.
    return {
      text: `${text.slice(0, lineStart)}${text.slice(selectionStart)}`,
      selectionStart: lineStart,
      selectionEnd: lineStart,
    };
  }
  const inserted = `\n${nextMarker(item)}`;
  return {
    text: `${text.slice(0, selectionStart)}${inserted}${text.slice(selectionEnd)}`,
    selectionStart: selectionStart + inserted.length,
    selectionEnd: selectionStart + inserted.length,
  };
}

const LIST_INDENT = "  ";

/**
 * Tab/Shift+Tab inside a list: indent or outdent every selected line that
 * is a list item. Returns null when the caret line is not a list item, so
 * Tab keeps its default focus-move behavior outside lists.
 */
export function indentListSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "indent" | "outdent",
): TextEdit | null {
  const firstLineStart = lineStartAt(text, selectionStart);
  // A non-collapsed selection ending at column 0 does not visibly include
  // that line, exclude it (standard editor convention).
  const effectiveEnd =
    selectionEnd > selectionStart &&
    selectionEnd === lineStartAt(text, selectionEnd)
      ? selectionEnd - 1
      : selectionEnd;
  const lastLineEnd = lineEndAt(text, effectiveEnd);
  const block = text.slice(firstLineStart, lastLineEnd);
  const lines = block.split("\n");
  if (lines.every((line) => parseListItemLine(line) === null)) return null;
  let firstLineDelta = 0;
  let totalDelta = 0;
  const nextLines = lines.map((line, index) => {
    if (parseListItemLine(line) === null) return line;
    let next = line;
    if (direction === "indent") next = `${LIST_INDENT}${line}`;
    else if (line.startsWith(LIST_INDENT))
      next = line.slice(LIST_INDENT.length);
    else next = line.replace(/^\s/, "");
    const delta = next.length - line.length;
    if (index === 0) firstLineDelta = delta;
    totalDelta += delta;
    return next;
  });
  // Outdent at the margin changes nothing: decline so the caller doesn't
  // consume the keystroke (or mark the value dirty) for a no-op.
  if (totalDelta === 0) return null;
  return {
    text: `${text.slice(0, firstLineStart)}${nextLines.join("\n")}${text.slice(lastLineEnd)}`,
    selectionStart: Math.max(firstLineStart, selectionStart + firstLineDelta),
    selectionEnd: Math.max(firstLineStart, selectionEnd + totalDelta),
  };
}

/**
 * Numbered-list insert with contextual numbering: continues from a numbered
 * item on the line above the selection (same indent) instead of restarting
 * at 1, and numbers a multi-line selection sequentially.
 */
export function applyOrderedListPrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEdit {
  const firstLineStart = lineStartAt(text, selectionStart);
  let start = 1;
  if (firstLineStart > 0) {
    const previousLine = text.slice(
      lineStartAt(text, firstLineStart - 1),
      firstLineStart - 1,
    );
    const previous = parseListItemLine(previousLine);
    const numbered = previous ? /^(\d+)\.$/.exec(previous.marker) : null;
    if (numbered && previous?.indent === "") {
      start = Number(numbered[1]) + 1;
    }
  }
  // Same no-placeholder contract as applyLinePrefix: collapsed → marker at
  // line start, caret in the text; selection → numbered, caret at the end.
  if (selectionStart === selectionEnd) {
    const lineStart = lineStartAt(text, selectionStart);
    const prefix = `${start}. `;
    const caret = selectionStart + prefix.length;
    return {
      text: `${text.slice(0, lineStart)}${prefix}${text.slice(lineStart)}`,
      selectionStart: caret,
      selectionEnd: caret,
    };
  }
  const selected = text.slice(selectionStart, selectionEnd);
  const replacement = selected
    .split("\n")
    .map((line, index) => `${start + index}. ${line}`)
    .join("\n");
  const caret = selectionStart + replacement.length;
  return {
    text: `${text.slice(0, selectionStart)}${replacement}${text.slice(selectionEnd)}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

export interface MentionQuery {
  /** Index of the `@` character. */
  start: number;
  /** Text typed after the `@` so far (may be empty). */
  query: string;
}

const MENTION_PATTERN = /(?:^|[\s([{])@([a-zA-Z0-9-]*)$/;

/**
 * The mention being typed at the caret, or null when the caret is not in
 * one, including inside a code fence, where `@` is code, not a mention.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): MentionQuery | null {
  const before = text.slice(0, caret);
  // An odd number of fence delimiters before the caret = inside a fence.
  const fences = before.match(/^(?:```|~~~)/gm);
  if (fences !== null && fences.length % 2 === 1) return null;
  const match = MENTION_PATTERN.exec(before);
  if (match === null) return null;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
}

/**
 * Replaces the typed `@query` with `@login ` and parks the caret after.
 * A mid-token accept (caret inside `@albert` after `@al`) consumes the
 * rest of the token too, `@alice bert` residue is never right.
 */
export function insertMention(
  text: string,
  mentionStart: number,
  caret: number,
  login: string,
): TextEdit {
  const tail = /^[a-zA-Z0-9-]*/.exec(text.slice(caret))?.[0] ?? "";
  const inserted = `@${login} `;
  const position = mentionStart + inserted.length;
  return {
    text: `${text.slice(0, mentionStart)}${inserted}${text.slice(caret + tail.length)}`,
    selectionStart: position,
    selectionEnd: position,
  };
}

export function replaceSelectionWithSuggestion(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  replacement: string,
): TextEdit {
  const block = `\`\`\`suggestion\n${replacement}\n\`\`\``;
  const nextText = `${text.slice(0, selectionStart)}${block}${text.slice(selectionEnd)}`;
  return {
    text: nextText,
    selectionStart: selectionStart + "```suggestion\n".length,
    selectionEnd:
      selectionStart + "```suggestion\n".length + replacement.length,
  };
}

const PLACEHOLDER_ELLIPSIS = "…";
const PLACEHOLDER_FALLBACK_NAME = "image";
// oxlint-disable-next-line no-control-regex -- the control range is the thing stripped
const PLACEHOLDER_UNSAFE_CHARACTERS = /[[\]\u0000-\u001f\u007f]/g;

/**
 * A name that can neither close the placeholder's brackets nor open a link:
 * a name with `]` would fail hasUploadPlaceholder and let a submit ship the
 * line, and `](url` would render as a live image before the upload settled.
 */
function sanitizePlaceholderName(fileName: string): string {
  const safe = fileName.replace(PLACEHOLDER_UNSAFE_CHARACTERS, "").trim();
  return safe === "" ? PLACEHOLDER_FALLBACK_NAME : safe;
}

/** The text an in-flight upload holds in the body, GitHub's own shape. */
export function buildUploadPlaceholder(fileName: string): string {
  return `![Uploading ${sanitizePlaceholderName(fileName)}${PLACEHOLDER_ELLIPSIS}]()`;
}

const UPLOAD_PLACEHOLDER_PATTERN = /!\[Uploading [^\]]*…\]\(\)/;

/** True while the text still holds an upload's placeholder line. */
export function hasUploadPlaceholder(text: string): boolean {
  return UPLOAD_PLACEHOLDER_PATTERN.test(text);
}

/**
 * One placeholder per file, unique against the text, the batch and every
 * upload still in flight: a repeated name (every clipboard image is
 * `image.png`) gets a position, so the settle of one upload can never land
 * on another's line, not even after the writer deleted the first line.
 */
export function buildUploadPlaceholders(
  files: readonly File[],
  text: string,
  inFlight: ReadonlySet<string>,
): string[] {
  const taken = new Set<string>(inFlight);
  return files.map((file) => {
    let placeholder = buildUploadPlaceholder(file.name);
    for (
      let suffix = 2;
      taken.has(placeholder) || text.includes(placeholder);
      suffix += 1
    ) {
      placeholder = buildUploadPlaceholder(`${file.name} (${suffix})`);
    }
    taken.add(placeholder);
    return placeholder;
  });
}

/** The image files of a paste or a drop; anything else stays the browser's. */
export function readImageFiles(transfer: DataTransfer | null): File[] {
  if (transfer === null) {
    return [];
  }
  return [...transfer.files].filter((file) => file.type.startsWith("image/"));
}

/** The branch url an upload receipt carries, or undefined for any other body. */
export function readUploadedUrl(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("url" in body)) {
    return undefined;
  }
  return typeof body.url === "string" ? body.url : undefined;
}

/** The markdown that shows an attached image. */
export function buildImageMarkdown(url: string): string {
  return `![Image](${url})`;
}

/**
 * The placeholder lands on its own line at the caret, replacing any
 * selection, and the caret parks after it so typing continues below.
 */
export function insertPlaceholder(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  placeholder: string,
): TextEdit {
  const before = text.slice(0, selectionStart);
  const after = text.slice(selectionEnd);
  const leadIn = before === "" || before.endsWith("\n") ? "" : "\n";
  const leadOut = after === "" || after.startsWith("\n") ? "" : "\n";
  const inserted = `${leadIn}${placeholder}${leadOut}`;
  const caret = selectionStart + leadIn.length + placeholder.length;
  return {
    text: `${before}${inserted}${after}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/**
 * Swaps the first occurrence of the placeholder for its replacement, an
 * empty string on failure, which takes the placeholder's line break with
 * it so a refused batch leaves no blank lines behind. A placeholder the
 * writer edited away is left alone: the edit declines rather than touching
 * text it does not own.
 */
export function replacePlaceholder(
  text: string,
  placeholder: string,
  replacement: string,
): TextEdit | null {
  const index = text.indexOf(placeholder);
  if (index === -1) {
    return null;
  }
  let end = index + placeholder.length;
  if (replacement === "" && text[end] === "\n") {
    end += 1;
  }
  const caret = index + replacement.length;
  return {
    text: `${text.slice(0, index)}${replacement}${text.slice(end)}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}
