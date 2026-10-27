import {
  CONTAINER_PREFIX,
  type TextRange,
} from "../../generation/untrusted-text";
import { PARAGRAPH_END, NOT_FOUND, SPACE_CHARS } from "./consts";

export function isSpace(char: string | undefined): boolean {
  const space = char !== undefined && SPACE_CHARS.has(char);
  return space;
}

export function findLineEnd(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end === NOT_FOUND ? text.length : end;
}

/**
 * The offset of the line break that ends each paragraph, asked from offsets
 * in increasing order: one search serves every offset before its answer.
 */
export function createParagraphEndFinder(
  text: string,
  paragraphEnd: RegExp = PARAGRAPH_END,
): (from: number) => number {
  const ends = new RegExp(paragraphEnd.source, "g");
  let known = NOT_FOUND;
  return (from) => {
    if (known >= from) {
      return known;
    }
    ends.lastIndex = from;
    known = ends.exec(text)?.index ?? text.length;
    return known;
  };
}

/** The range holding each offset, asked in increasing order, so the walk over the ranges is one pass. */
export function createRangeLookup(
  ranges: readonly TextRange[],
): (offset: number) => TextRange | undefined {
  let next = 0;
  return (offset) => {
    while ((ranges[next]?.end ?? Infinity) <= offset) {
      next += 1;
    }
    const range = ranges[next];
    const holds = range !== undefined && range.start <= offset;
    return holds ? range : undefined;
  };
}

export function skipContainerPrefix(text: string, from: number): number {
  const prefix = new RegExp(CONTAINER_PREFIX, "y");
  prefix.lastIndex = from;
  prefix.exec(text);
  return prefix.lastIndex;
}
