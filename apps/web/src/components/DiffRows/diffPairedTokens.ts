import type { RowTokenMap } from "@web/utils/diffTokens/types";
import {
  INTRA_LINE_CHARACTER_CAP,
  INTRA_LINE_EMPHASIS_SHARE,
  INTRA_LINE_TOKEN_CAP,
  LCS_CELL_CAP,
  NO_EMPHASIS,
} from "./consts";
import type {
  CharRange,
  EmphasisByRow,
  PairedEmphasis,
  SplitRow,
  TokenSide,
} from "./types";

/**
 * The characters that changed between a deleted line and the added line it
 * pairs with. Tokens are the unit; a lone changed token on each side narrows
 * to its differing characters. Nothing is emphasised when a side is past the
 * character or token cap, when the middles are too many to compare, or when
 * the change covers most of the line.
 */
export function diffPairedTokens(
  left: TokenSide,
  right: TokenSide,
): PairedEmphasis {
  if (left.text.length > INTRA_LINE_CHARACTER_CAP) return NO_EMPHASIS;
  if (right.text.length > INTRA_LINE_CHARACTER_CAP) return NO_EMPHASIS;
  // A side the worker left plain compares by characters on both sides.
  const plain = left.tokens === undefined || right.tokens === undefined;
  const leftTokens = plain ? [left.text] : readTokens(left);
  const rightTokens = plain ? [right.text] : readTokens(right);
  if (leftTokens.length > INTRA_LINE_TOKEN_CAP) return NO_EMPHASIS;
  if (rightTokens.length > INTRA_LINE_TOKEN_CAP) return NO_EMPHASIS;

  const emphasis = compareTokenRuns(leftTokens, rightTokens);
  if (isMostOfLine(emphasis.left, left.text)) return NO_EMPHASIS;
  if (isMostOfLine(emphasis.right, right.text)) return NO_EMPHASIS;

  return emphasis;
}

/**
 * Emphasis for every paired changed row of a chunk, keyed by unified row
 * index. Rows the worker left untokenized compare by characters; a chunk
 * with no tokens at all gets nothing, so the plain pass renders as before.
 */
export function computeIntraLineEmphasis(
  pairs: readonly SplitRow[],
  tokensByRow: RowTokenMap | undefined,
): EmphasisByRow {
  const emphasis = new Map<number, readonly CharRange[]>();
  if (tokensByRow === undefined) return emphasis;

  for (const pair of pairs) {
    const { left, right } = pair;
    if (left === undefined || right === undefined || left === right) continue;
    const leftTokens = tokensByRow.get(left.index);
    const rightTokens = tokensByRow.get(right.index);
    if (leftTokens === undefined && rightTokens === undefined) continue;

    const result = diffPairedTokens(
      { text: left.line.content, tokens: leftTokens },
      { text: right.line.content, tokens: rightTokens },
    );
    if (result.left.length > 0) emphasis.set(left.index, result.left);
    if (result.right.length > 0) emphasis.set(right.index, result.right);
  }

  return emphasis;
}

function readTokens(side: TokenSide): readonly string[] {
  return (side.tokens ?? []).map((token) => token.text);
}

function compareTokenRuns(
  left: readonly string[],
  right: readonly string[],
): PairedEmphasis {
  const prefix = countCommonPrefix(left, right);
  const suffix = countCommonSuffix(left, right, prefix);
  const leftMiddle = left.slice(prefix, left.length - suffix);
  const rightMiddle = right.slice(prefix, right.length - suffix);
  if (leftMiddle.length === 0 && rightMiddle.length === 0) return NO_EMPHASIS;

  const leftStart = measure(left.slice(0, prefix));
  const rightStart = measure(right.slice(0, prefix));
  if (leftMiddle.length <= 1 && rightMiddle.length <= 1) {
    return compareCharacters(
      leftMiddle.join(""),
      rightMiddle.join(""),
      leftStart,
      rightStart,
    );
  }

  const shared = findSharedTokens(leftMiddle, rightMiddle);
  if (shared === undefined) return NO_EMPHASIS;

  return {
    left: collectChangedRanges(leftMiddle, shared.left, leftStart),
    right: collectChangedRanges(rightMiddle, shared.right, rightStart),
  };
}

/** A single changed token per side narrows to the run that differs. */
function compareCharacters(
  left: string,
  right: string,
  leftStart: number,
  rightStart: number,
): PairedEmphasis {
  // Code points, not UTF-16 units: a boundary inside a surrogate pair would
  // put each half in its own text node and paint two replacement glyphs.
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const prefix = countCommonPrefix(leftPoints, rightPoints);
  const suffix = countCommonSuffix(leftPoints, rightPoints, prefix);
  const prefixUnits = measureUnits(leftPoints, 0, prefix);
  const leftRun = {
    from: leftStart + prefixUnits,
    to:
      leftStart +
      left.length -
      measureUnits(leftPoints, leftPoints.length - suffix, leftPoints.length),
  };
  const rightRun = {
    from: rightStart + prefixUnits,
    to:
      rightStart +
      right.length -
      measureUnits(
        rightPoints,
        rightPoints.length - suffix,
        rightPoints.length,
      ),
  };

  return {
    left: leftRun.to > leftRun.from ? [leftRun] : [],
    right: rightRun.to > rightRun.from ? [rightRun] : [],
  };
}

/** UTF-16 length of the code points in [from, to). */
function measureUnits(
  points: readonly string[],
  from: number,
  to: number,
): number {
  let units = 0;
  for (let at = from; at < to; at += 1) units += points[at]?.length ?? 0;
  return units;
}

interface SharedTokens {
  left: Set<number>;
  right: Set<number>;
}

/**
 * Positions of tokens common to both middles, by longest common subsequence;
 * undefined past the cell cap, where the comparison is given up rather than
 * every middle token called changed.
 */
function findSharedTokens(
  left: readonly string[],
  right: readonly string[],
): SharedTokens | undefined {
  if (left.length * right.length > LCS_CELL_CAP) return undefined;
  const shared: SharedTokens = { left: new Set(), right: new Set() };

  const width = right.length + 1;
  const table = new Uint16Array((left.length + 1) * width);
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      const at = row * width + column;
      const matched = left[row] === right[column];
      const diagonal = table[at + width + 1] ?? 0;
      const down = table[at + width] ?? 0;
      const across = table[at + 1] ?? 0;
      table[at] = matched ? diagonal + 1 : Math.max(down, across);
    }
  }

  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      shared.left.add(row);
      shared.right.add(column);
      row += 1;
      column += 1;
      continue;
    }
    const down = table[(row + 1) * width + column] ?? 0;
    const across = table[row * width + column + 1] ?? 0;
    if (down >= across) row += 1;
    else column += 1;
  }

  return shared;
}

/** Adjacent changed tokens fold into one range. */
function collectChangedRanges(
  tokens: readonly string[],
  shared: ReadonlySet<number>,
  start: number,
): CharRange[] {
  const ranges: CharRange[] = [];
  let offset = start;

  tokens.forEach((token, position) => {
    const end = offset + token.length;
    const open = ranges.at(-1);
    if (!shared.has(position) && token.length > 0) {
      if (open !== undefined && open.to === offset) open.to = end;
      else ranges.push({ from: offset, to: end });
    }
    offset = end;
  });

  return ranges;
}

function isMostOfLine(ranges: readonly CharRange[], text: string): boolean {
  if (ranges.length === 0 || text.length === 0) return false;
  const covered = ranges.reduce((sum, range) => sum + range.to - range.from, 0);

  return covered / text.length > INTRA_LINE_EMPHASIS_SHARE;
}

function countCommonPrefix(
  left: readonly string[],
  right: readonly string[],
): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[count] === right[count]) count += 1;

  return count;
}

function countCommonSuffix(
  left: readonly string[],
  right: readonly string[],
  prefix: number,
): number {
  const limit = Math.min(left.length, right.length) - prefix;
  let count = 0;
  while (
    count < limit &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count += 1;
  }

  return count;
}

function measure(tokens: readonly string[]): number {
  return tokens.reduce((sum, token) => sum + token.length, 0);
}
