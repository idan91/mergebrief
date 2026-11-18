import { findCloser, type TextRange } from "../../generation/untrusted-text";
import {
  INLINE_TAG,
  BLOCK_TAG,
  HTML_BLOCK_OPENER,
  MARKUP_BLOCK_ENDS,
  RAW_TEXT_CLOSE,
  RAW_TEXT_BLOCKS,
  CONTENT_DROPPING_ELEMENTS,
  CONTAINER_PREFIX_ONLY,
  NOT_FOUND,
  QUOTED_PARAGRAPH_END,
} from "./consts";
import type { HtmlBlocks } from "./types";
import {
  isSpace,
  findLineEnd,
  createParagraphEndFinder,
  createRangeLookup,
  skipContainerPrefix,
} from "./utils";

/** The end of the line holding each marker's next match, searches and line ends cached for increasing offsets. */
function createMarkerLineEndFinder(
  text: string,
): (marker: string, from: number) => number {
  const closers = new Map<string, number>();
  const lineEnds = new Map<number, number>();
  return (marker, from) => {
    const close = findCloser(text, marker, from, closers);
    if (close === NOT_FOUND) {
      return text.length;
    }
    const lineEnd = lineEnds.get(close) ?? findLineEnd(text, close);
    lineEnds.set(close, lineEnd);
    return lineEnd;
  };
}

/** Where each block ends, its searches cached so checking every line stays linear. */
function createBlockEndFinder(
  text: string,
): (lineStart: number, opener: RegExpExecArray) => number {
  const findParagraphEnd = createParagraphEndFinder(text);
  const findMarkerLineEnd = createMarkerLineEndFinder(text);

  return (lineStart, opener) => {
    const name = opener.groups?.["name"]?.toLowerCase();
    const markup = opener.groups?.["markup"];
    if (markup !== undefined) {
      const marker = MARKUP_BLOCK_ENDS.get(markup) ?? ">";
      return findMarkerLineEnd(marker, lineStart + opener[0].length);
    }
    if (name !== undefined && RAW_TEXT_BLOCKS.has(name)) {
      return findMarkerLineEnd(`</${name}>`, lineStart);
    }
    return findParagraphEnd(lineStart);
  };
}

/** The first raw-text close tag at or past each offset, asked in increasing order. */
function createRawTextCloseFinder(text: string): (from: number) => number {
  const closes = new RegExp(RAW_TEXT_CLOSE.source, "gi");
  let known: number | undefined;
  return (from) => {
    if (known !== undefined && (known === NOT_FOUND || known >= from)) {
      return known;
    }
    closes.lastIndex = from;
    known = closes.exec(text)?.index ?? NOT_FOUND;
    return known;
  };
}

/**
 * The blocks that end on their marker's line instead of a blank line, each
 * at the earliest line any of its markers could end it, by marker. Past
 * one GitHub renders Markdown, where an escaped `-->` or `"` closes nothing.
 */
export function collectMarkerBlocks(text: string): Map<string, TextRange[]> {
  const findMarkerLineEnd = createMarkerLineEndFinder(text);
  const findRawTextClose = createRawTextCloseFinder(text);
  const blocks = new Map<string, TextRange[]>();

  for (
    let lineStart = 0;
    lineStart < text.length;
    lineStart = findLineEnd(text, lineStart) + 1
  ) {
    const lineEnd = findLineEnd(text, lineStart);
    const opener = HTML_BLOCK_OPENER.exec(text.slice(lineStart, lineEnd));
    const name = opener?.groups?.["name"]?.toLowerCase() ?? "";
    const markup = opener?.groups?.["markup"];
    let marker: string | undefined;
    let end = text.length;
    if (markup !== undefined) {
      marker = MARKUP_BLOCK_ENDS.get(markup) ?? ">";
      end = findMarkerLineEnd(marker, lineStart);
    } else if (RAW_TEXT_BLOCKS.has(name)) {
      marker = RAW_TEXT_CLOSE.source;
      const close = findRawTextClose(lineStart);
      end = close === NOT_FOUND ? end : findLineEnd(text, close);
    }
    if (marker !== undefined) {
      const ranges = blocks.get(marker) ?? [];
      ranges.push({ start: lineStart, end });
      blocks.set(marker, ranges);
    }
  }
  return blocks;
}

/** The earliest end among the marker blocks holding each offset, asked in increasing order; Infinity when none does. */
function createMarkerBlockEndLookup(
  blocks: ReadonlyMap<string, readonly TextRange[]>,
): (offset: number) => number {
  const cursors = [...blocks.values()].map((ranges) => ({ ranges, next: 0 }));
  return (offset) => {
    let earliest = Infinity;
    for (const cursor of cursors) {
      while ((cursor.ranges[cursor.next + 1]?.start ?? Infinity) <= offset) {
        cursor.next += 1;
      }
      const block = cursor.ranges[cursor.next];
      const holds =
        block !== undefined && block.start <= offset && block.end >= offset;
      earliest = holds ? Math.min(earliest, block.end) : earliest;
    }
    return earliest;
  };
}

/**
 * Every line is checked, inside a block too, and overlapping blocks merge:
 * a block that runs longer than GitHub's only widens where the HTML
 * grammar applies, which removes more.
 */
export function collectHtmlBlocks(text: string): TextRange[] {
  const findBlockEnd = createBlockEndFinder(text);
  const blocks: TextRange[] = [];

  for (
    let lineStart = 0;
    lineStart < text.length;
    lineStart = findLineEnd(text, lineStart) + 1
  ) {
    const lineEnd = findLineEnd(text, lineStart);
    const opener = HTML_BLOCK_OPENER.exec(text.slice(lineStart, lineEnd));
    if (opener === null) {
      continue;
    }
    const end = findBlockEnd(lineStart, opener);
    const last = blocks.at(-1);
    if (last !== undefined && last.end >= lineStart) {
      blocks[blocks.length - 1] = {
        start: last.start,
        end: Math.max(last.end, end),
      };
    } else {
      blocks.push({ start: lineStart, end });
    }
  }
  return blocks;
}

/** Whether the comment at `start` opens its line's own block: first on the line, in no block an earlier line opened. */
function isCommentBlockOpener(
  text: string,
  start: number,
  findHtmlBlock: (offset: number) => TextRange | undefined,
): boolean {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const firstOnLine = CONTAINER_PREFIX_ONLY.test(text.slice(lineStart, start));
  const opensBlock = firstOnLine && findHtmlBlock(start)?.start === lineStart;
  return opensBlock;
}

/**
 * A comment GitHub's HTML parser reads past a blank line, or past the end
 * of a block that ends on a marker, runs on through the rendered text,
 * where an escaped `-->` cannot close it, so it hides the rest; across a
 * blank line only a comment opening its own block stays raw to its `-->`.
 */
export function extendCrossingComments(
  text: string,
  hidden: readonly TextRange[],
  blocks: HtmlBlocks,
): TextRange[] {
  const findParagraphEnd = createParagraphEndFinder(text, QUOTED_PARAGRAPH_END);
  const findHtmlBlock = createRangeLookup(blocks.regions);
  const findMarkerBlockEnd = createMarkerBlockEndLookup(blocks.markerBlocks);
  const sorted = hidden.toSorted((left, right) => left.start - right.start);
  const extended: TextRange[] = [];

  for (const range of sorted) {
    if (!text.startsWith("<!--", range.start)) {
      extended.push(range);
      continue;
    }
    const leavesBlock = findMarkerBlockEnd(range.start) < range.end;
    const crossesBlank =
      findParagraphEnd(range.start) < range.end &&
      !isCommentBlockOpener(text, range.start, findHtmlBlock);
    if (leavesBlock || crossesBlank) {
      extended.push({ start: range.start, end: text.length });
      break;
    }
    extended.push(range);
  }
  return extended;
}

/**
 * Past the tag's `>`; a quote opens a value only after `=`, and a new
 * line's container markers are no `>` of the tag's. A tag that never closes
 * hides the rest, and so does a quoted value holding `<`, which may be
 * another tag's start the reading went past.
 */
function findTagEnd(text: string, from: number): number {
  let quote: string | undefined;
  let afterEquals = false;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote !== undefined) {
      if (char === "<") {
        return text.length;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "\n") {
      index = skipContainerPrefix(text, index + 1) - 1;
      continue;
    }
    if (char === ">") {
      const tagEnd = index + 1;
      return tagEnd;
    }
    if (afterEquals && (char === '"' || char === "'")) {
      quote = char;
    }
    afterEquals = char === "=" || (afterEquals && isSpace(char));
  }
  return text.length;
}

function findContentEnd(text: string, element: string, from: number): number {
  const closing = new RegExp(`</${element}(?=[\\s/>])`, "gi");
  closing.lastIndex = from;
  if (closing.exec(text) === null) {
    return text.length;
  }
  return findTagEnd(text, closing.lastIndex);
}

function findHiddenEnd(text: string, tag: RegExpExecArray): number {
  const [matched, slash, name = ""] = tag;
  const tagEnd = findTagEnd(text, tag.index + matched.length);
  const element = name.toLowerCase();
  const dropsContent = slash === "" && CONTENT_DROPPING_ELEMENTS.has(element);
  return dropsContent ? findContentEnd(text, element, tagEnd) : tagEnd;
}

/**
 * Every tag with its attributes, read by the grammar of the block it sits
 * in, hidden markup included: a false comment opener must not hide a real
 * tag's start. A tag spanning a blank line, or the end of a block that ends
 * on a marker, hides the rest: GitHub's HTML parser reads its attribute on
 * into the rendered text.
 */
export function collectTagRanges(
  text: string,
  blocks: HtmlBlocks,
): TextRange[] {
  const findHtmlBlock = createRangeLookup(blocks.regions);
  const findMarkerBlockEnd = createMarkerBlockEndLookup(blocks.markerBlocks);
  const findParagraphEnd = createParagraphEndFinder(text, QUOTED_PARAGRAPH_END);
  const inlineTag = new RegExp(INLINE_TAG.source, "y");
  const blockTag = new RegExp(BLOCK_TAG.source, "y");
  const ranges: TextRange[] = [];
  let start = text.indexOf("<");

  while (start !== NOT_FOUND) {
    const grammar = findHtmlBlock(start) === undefined ? inlineTag : blockTag;
    grammar.lastIndex = start;
    const tag = grammar.exec(text);
    let resumeAt = start + 1;
    if (tag !== null) {
      const end = findHiddenEnd(text, tag);
      const leavesRawHtml =
        findParagraphEnd(start) < end || findMarkerBlockEnd(start) < end;
      resumeAt = leavesRawHtml ? text.length : end;
      ranges.push({ start, end: resumeAt });
    }
    start = text.indexOf("<", resumeAt);
  }
  return ranges;
}
