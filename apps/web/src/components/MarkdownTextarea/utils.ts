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

export function applyLinePrefix(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
): TextEdit {
  const selected = text.slice(selectionStart, selectionEnd) || "list item";
  const replacement = selected
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
  return {
    text: `${text.slice(0, selectionStart)}${replacement}${text.slice(selectionEnd)}`,
    selectionStart,
    selectionEnd: selectionStart + replacement.length,
  };
}

export function applyLinkTemplate(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): TextEdit {
  const selected = text.slice(selectionStart, selectionEnd) || "link text";
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
 * Enter inside a list item continues the list (GitHub behavior): the new
 * line gets the same marker (numbered: incremented; task: unchecked), and
 * text after the caret becomes the new item's content. Enter on an EMPTY
 * item terminates the list by deleting its marker. Returns null when the
 * caret is not in a list item (callers fall through to the default
 * newline) — including any non-collapsed selection.
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
    // Empty item: terminate the list — the marker line becomes empty.
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
  // that line — exclude it (standard editor convention).
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
  const selected = text.slice(selectionStart, selectionEnd) || "list item";
  const replacement = selected
    .split("\n")
    .map((line, index) => `${start + index}. ${line}`)
    .join("\n");
  return {
    text: `${text.slice(0, selectionStart)}${replacement}${text.slice(selectionEnd)}`,
    selectionStart,
    selectionEnd: selectionStart + replacement.length,
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
 * one — including inside a code fence, where `@` is code, not a mention.
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
 * rest of the token too — `@alice bert` residue is never right.
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
