import {
  createLabelCloseFinder,
  type TextRange,
} from "../../generation/untrusted-text";
import {
  FENCE_OPENER,
  IMAGE_START,
  DESTINATION_START,
  ASCII_PUNCTUATION,
  URL_STOP,
  DELIMITER_ROW,
  HYPHEN_RULE,
  DELIMITER_CELL,
  NOT_FOUND,
  REFERENCE_LABEL_START,
} from "./consts";
import {
  isSpace,
  findLineEnd,
  createParagraphEndFinder,
  skipContainerPrefix,
} from "./utils";

/** An image shows neither its alt text nor its source; everything from `![` to its paragraph's end goes. */
export function collectImageRanges(text: string): TextRange[] {
  const findParagraphEnd = createParagraphEndFinder(text);
  const starts = new RegExp(IMAGE_START.source, "g");
  const ranges: TextRange[] = [];

  for (
    let start = starts.exec(text);
    start !== null;
    start = starts.exec(text)
  ) {
    const end = findParagraphEnd(start.index);
    ranges.push({ start: start.index, end });
    starts.lastIndex = end;
  }
  return ranges;
}

/** Space characters with at most one line break, the gaps a link destination allows. */
function skipLinkSpace(text: string, from: number): number {
  let index = from;
  let lineBreaks = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      lineBreaks += 1;
    }
    if (!isSpace(char) || lineBreaks > 1) {
      break;
    }
    index += 1;
  }
  return index;
}

/** A backslash escapes only ASCII punctuation; before anything else it is a backslash. */
function isEscape(text: string, index: number): boolean {
  const escapes =
    text[index] === "\\" && ASCII_PUNCTUATION.test(text[index + 1] ?? "");
  return escapes;
}

/** A bare destination stops at its first whitespace or at the `)` that balances none of its own. */
function findBareDestinationEnd(text: string, from: number): number {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (isSpace(char)) {
      return index;
    }
    if (isEscape(text, index)) {
      index += 1;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }
  return text.length;
}

function findDestinationEnd(text: string, from: number): number {
  if (text[from] !== "<") {
    return findBareDestinationEnd(text, from);
  }
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index];
    if (isEscape(text, index)) {
      index += 1;
    } else if (char === ">") {
      const destinationEnd = index + 1;
      return destinationEnd;
    } else if (char === "\n" || char === "<") {
      return index;
    }
  }
  return text.length;
}

/** A destination keeps its leading URL; the rest a reader never sees as a link start. */
function findDestinationTail(
  text: string,
  start: number,
  end: number,
): TextRange | undefined {
  const first = text[start] === "<" ? start + 1 : start;
  for (let index = first; index < end; index += 1) {
    if (URL_STOP.test(text[index] ?? "")) {
      return { start: index, end };
    }
  }
  return undefined;
}

/**
 * A link's title shows only as a tooltip. Whitespace after the destination
 * is where a title would start, so everything from it to the paragraph's end
 * goes. The destination's leading URL stays, since a link target counts as
 * shown.
 */
export function collectTitleRanges(text: string): TextRange[] {
  const findParagraphEnd = createParagraphEndFinder(text);
  const starts = new RegExp(DESTINATION_START.source, "g");
  const ranges: TextRange[] = [];

  for (
    let start = starts.exec(text);
    start !== null;
    start = starts.exec(text)
  ) {
    const from = starts.lastIndex;
    const destinationStart = skipLinkSpace(text, from);
    const destinationEnd = findDestinationEnd(text, destinationStart);
    const tail = findDestinationTail(text, destinationStart, destinationEnd);
    if (tail !== undefined) {
      ranges.push(tail);
    }
    if (!isSpace(text[destinationEnd])) {
      starts.lastIndex = Math.max(destinationEnd, from);
      continue;
    }
    const end = findParagraphEnd(destinationEnd);
    ranges.push({ start: destinationEnd, end });
    starts.lastIndex = end;
  }
  return ranges;
}

/** Where a row's cells pass the table's columns: the pipe that ends the last column, else not found. */
function findExcessCells(
  text: string,
  rowStart: number,
  rowEnd: number,
  columns: number,
): number {
  let index = skipContainerPrefix(text, rowStart);
  while (text[index] === " " || text[index] === "\t") {
    index += 1;
  }
  if (text[index] === "|") {
    index += 1;
  }

  let pipes = 0;
  for (; index < rowEnd; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === "|") {
      pipes += 1;
      if (pipes === columns) {
        return index;
      }
    }
  }
  return NOT_FOUND;
}

/**
 * GitHub drops a body row's cells past the delimiter row's count. Within a
 * paragraph the narrowest delimiter row counts for every later line, since
 * telling where a table ends takes a full parse.
 */
export function collectExcessCellRanges(text: string): TextRange[] {
  const findParagraphEnd = createParagraphEndFinder(text);
  const ranges: TextRange[] = [];
  let columns = Infinity;
  let paragraphEnd = NOT_FOUND;
  let lineStart = 0;

  while (lineStart < text.length) {
    const lineEnd = findLineEnd(text, lineStart);
    if (lineStart > paragraphEnd) {
      columns = Infinity;
      paragraphEnd = findParagraphEnd(lineStart);
    }
    const row = text.slice(skipContainerPrefix(text, lineStart), lineEnd);
    const delimiter = DELIMITER_ROW.test(row) && !HYPHEN_RULE.test(row);
    if (delimiter) {
      columns = Math.min(columns, row.match(DELIMITER_CELL)?.length ?? 0);
    }
    const excess = delimiter
      ? NOT_FOUND
      : findExcessCells(text, lineStart, lineEnd, columns);
    if (excess !== NOT_FOUND) {
      ranges.push({ start: excess, end: lineEnd });
    }
    lineStart = lineEnd + 1;
  }
  return ranges;
}

/** A fence line keeps its run; whatever follows it is an info string, which never renders. */
export function collectFenceInfoRanges(text: string): TextRange[] {
  const opener = new RegExp(FENCE_OPENER.source, "y");
  const ranges: TextRange[] = [];

  for (
    let lineStart = 0;
    lineStart < text.length;
    lineStart = findLineEnd(text, lineStart) + 1
  ) {
    opener.lastIndex = lineStart;
    if (opener.exec(text) !== null) {
      ranges.push({
        start: opener.lastIndex,
        end: findLineEnd(text, lineStart),
      });
    }
  }
  return ranges;
}

/** A full reference link `[text][label]` shows its text only; its label never renders. */
export function collectReferenceLabelRanges(text: string): TextRange[] {
  const findLabelClose = createLabelCloseFinder(text);
  const ranges: TextRange[] = [];

  for (const start of text.matchAll(REFERENCE_LABEL_START)) {
    const close = findLabelClose(start.index + 2);
    if (close !== NOT_FOUND) {
      ranges.push({ start: start.index + 1, end: close + 1 });
    }
  }
  return ranges;
}
