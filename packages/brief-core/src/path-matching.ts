// The path matcher two owners share: the server shapes repo context with it,
// apps/web presents the same repo configuration. Pure and browser-safe: no
// Node globals, no runtime imports.

import type { ValueOf } from "types/utils";

const GlobTokenKinds = {
  LITERAL: "literal",
  STAR: "star",
  GLOBSTAR: "globstar",
  GLOBSTAR_SLASH: "globstar-slash",
  QMARK: "qmark",
} as const;

type GlobTokenKind = ValueOf<typeof GlobTokenKinds>;

// Only a literal carries a payload; the wildcards are the kind alone.
type WildcardToken = {
  readonly kind: Exclude<GlobTokenKind, typeof GlobTokenKinds.LITERAL>;
};

type GlobToken =
  | { readonly kind: typeof GlobTokenKinds.LITERAL; readonly char: string }
  | WildcardToken;

interface StarToken {
  readonly token: GlobToken;
  // Pattern characters the token spans: `*`, `**` or `**/`.
  readonly width: number;
}

/**
 * Which star token starts at `index`, and how many characters it spans:
 * `*` one segment, `**` any run, `**\/` any run of WHOLE segments. The width
 * is returned because the three spellings are 1, 2 and 3 characters long.
 */
function readStarToken(pattern: string, index: number): StarToken {
  if (pattern[index + 1] !== "*") {
    return { token: { kind: GlobTokenKinds.STAR }, width: 1 };
  }

  // `**/` = zero or more COMPLETE directory segments, it must stop at
  // a segment boundary, so `src/**/fixtures` never matches
  // `src/notfixtures`.
  if (pattern[index + 2] === "/") {
    return { token: { kind: GlobTokenKinds.GLOBSTAR_SLASH }, width: 3 };
  }
  return { token: { kind: GlobTokenKinds.GLOBSTAR }, width: 2 };
}

function tokenizeGlob(pattern: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "*") {
      const star = readStarToken(pattern, index);
      tokens.push(star.token);
      index += star.width;
      continue;
    }

    if (char === "?") {
      tokens.push({ kind: GlobTokenKinds.QMARK });
    } else if (char !== undefined) {
      tokens.push({ kind: GlobTokenKinds.LITERAL, char });
    }
    index++;
  }
  return tokens;
}

/** Positions reachable after `char` consumes one path character. */
function consumeLiteral(
  reachable: readonly boolean[],
  filePath: string,
  char: string,
): boolean[] {
  const next = Array.from({ length: filePath.length + 1 }, () => false);
  for (let j = 0; j < filePath.length; j++) {
    if (reachable[j] === true && filePath[j] === char) {
      next[j + 1] = true;
    }
  }
  return next;
}

/** Positions reachable after `?` consumes one non-separator character. */
function consumeQuestionMark(
  reachable: readonly boolean[],
  filePath: string,
): boolean[] {
  const next = Array.from({ length: filePath.length + 1 }, () => false);
  for (let j = 0; j < filePath.length; j++) {
    if (reachable[j] === true && filePath[j] !== "/") {
      next[j + 1] = true;
    }
  }
  return next;
}

/**
 * Positions reachable after `*` consumes any run (incl. empty) that stays
 * inside one segment. Linear recurrence: a run may end at j when one started
 * somewhere reachable and no separator intervened; a naive inner scan is
 * quadratic here.
 */
function consumeStar(
  reachable: readonly boolean[],
  filePath: string,
): boolean[] {
  const next = Array.from({ length: filePath.length + 1 }, () => false);
  let active = false;
  for (let j = 0; j <= filePath.length; j++) {
    active =
      (active && j > 0 && filePath[j - 1] !== "/") || reachable[j] === true;
    if (active) {
      next[j] = true;
    }
  }
  return next;
}

/** Positions reachable after `**` consumes anything, separators included. */
function consumeGlobstar(
  reachable: readonly boolean[],
  filePath: string,
): boolean[] {
  const next = Array.from({ length: filePath.length + 1 }, () => false);
  let seen = false;
  for (let j = 0; j <= filePath.length; j++) {
    seen = seen || reachable[j] === true;
    if (seen) {
      next[j] = true;
    }
  }
  return next;
}

// Positions reachable after `**/` consumes zero or more complete segments:
// land only where a segment starts, at the consumption start itself, or
// just past a separator.
function consumeGlobstarSlash(
  reachable: readonly boolean[],
  filePath: string,
): boolean[] {
  const next = Array.from({ length: filePath.length + 1 }, () => false);
  let seenBefore = false;
  for (let j = 0; j <= filePath.length; j++) {
    if (reachable[j] === true) {
      next[j] = true;
    }
    if (seenBefore && j > 0 && filePath[j - 1] === "/") {
      next[j] = true;
    }
    seenBefore = seenBefore || reachable[j] === true;
  }
  return next;
}

function consumeToken(
  token: GlobToken,
  reachable: readonly boolean[],
  filePath: string,
): boolean[] {
  switch (token.kind) {
    case GlobTokenKinds.LITERAL:
      return consumeLiteral(reachable, filePath, token.char);
    case GlobTokenKinds.QMARK:
      return consumeQuestionMark(reachable, filePath);
    case GlobTokenKinds.STAR:
      return consumeStar(reachable, filePath);
    case GlobTokenKinds.GLOBSTAR:
      return consumeGlobstar(reachable, filePath);
    case GlobTokenKinds.GLOBSTAR_SLASH:
      return consumeGlobstarSlash(reachable, filePath);
  }
}

/**
 * Minimal anchored glob matcher for custom-attribute path scopes: `**` spans
 * directories, `*` matches within one segment, `?` one non-separator character,
 * everything else literal. An iterative token by position sweep, worst case
 * O(pattern x path), never a backtracking RegExp: both inputs are untrusted.
 */
export function matchesGlob(pattern: string, filePath: string): boolean {
  const tokens = tokenizeGlob(pattern);
  // reachable[j] = the first `t` tokens can consume exactly j path chars.
  let reachable = Array.from({ length: filePath.length + 1 }, () => false);
  reachable[0] = true;

  for (const token of tokens) {
    reachable = consumeToken(token, reachable, filePath);
  }
  return reachable[filePath.length] === true;
}

/** A glob tokenized once for a scan, with the literal ends every path it matches carries. */
interface ScanGlob {
  readonly tokens: readonly GlobToken[];
  readonly prefix: string;
  readonly suffix: string;
}

/** Two reachability rows one scan reuses for every token of every path. */
interface ScanRows {
  reach: Uint8Array;
  next: Uint8Array;
}

/** What one scan carries from path to path: its rows and its steps left. */
interface ScanState {
  readonly rows: ScanRows;
  stepsLeft: number;
}

function readLiteralPrefix(tokens: readonly GlobToken[]): string {
  let prefix = "";
  for (const token of tokens) {
    if (token.kind !== GlobTokenKinds.LITERAL) {
      return prefix;
    }
    prefix += token.char;
  }
  return prefix;
}

function readLiteralSuffix(tokens: readonly GlobToken[]): string {
  let suffix = "";
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index];
    if (token?.kind !== GlobTokenKinds.LITERAL) {
      return suffix;
    }
    suffix = token.char + suffix;
  }
  return suffix;
}

function readScanGlob(pattern: string): ScanGlob {
  const tokens = tokenizeGlob(pattern);
  return {
    tokens,
    prefix: readLiteralPrefix(tokens),
    suffix: readLiteralSuffix(tokens),
  };
}

function fitsLiteralEnds(glob: ScanGlob, filePath: string): boolean {
  const fits =
    filePath.startsWith(glob.prefix) && filePath.endsWith(glob.suffix);
  return fits;
}

function stepLiteral(rows: ScanRows, filePath: string, code: number): boolean {
  const { reach, next } = rows;
  let reached = 0;
  next[0] = 0;
  for (let index = 0; index < filePath.length; index++) {
    const bit = filePath.charCodeAt(index) === code ? (reach[index] ?? 0) : 0;
    next[index + 1] = bit;
    reached |= bit;
  }
  return reached === 1;
}

function stepQuestionMark(rows: ScanRows, filePath: string): boolean {
  const { reach, next } = rows;
  let reached = 0;
  next[0] = 0;
  for (let index = 0; index < filePath.length; index++) {
    const bit = filePath[index] === "/" ? 0 : (reach[index] ?? 0);
    next[index + 1] = bit;
    reached |= bit;
  }
  return reached === 1;
}

function stepStar(rows: ScanRows, filePath: string): boolean {
  const { reach, next } = rows;
  let reached = false;
  let active = false;
  for (let index = 0; index <= filePath.length; index++) {
    const runGoesOn: boolean =
      active && index > 0 && filePath[index - 1] !== "/";
    active = runGoesOn || reach[index] === 1;
    next[index] = active ? 1 : 0;
    reached = reached || active;
  }
  return reached;
}

function stepGlobstar(rows: ScanRows, filePath: string): boolean {
  const { reach, next } = rows;
  let seen = false;
  for (let index = 0; index <= filePath.length; index++) {
    seen = seen || reach[index] === 1;
    next[index] = seen ? 1 : 0;
  }
  return seen;
}

function stepGlobstarSlash(rows: ScanRows, filePath: string): boolean {
  const { reach, next } = rows;
  let seenBefore = false;
  for (let index = 0; index <= filePath.length; index++) {
    const segmentStart = seenBefore && index > 0 && filePath[index - 1] === "/";
    const landed = reach[index] === 1 || segmentStart;
    next[index] = landed ? 1 : 0;
    seenBefore = seenBefore || reach[index] === 1;
  }
  return seenBefore;
}

/** Writes every position of `rows.next`; false when the token reached none. */
function stepToken(
  token: GlobToken,
  rows: ScanRows,
  filePath: string,
): boolean {
  switch (token.kind) {
    case GlobTokenKinds.LITERAL:
      return stepLiteral(rows, filePath, token.char.charCodeAt(0));
    case GlobTokenKinds.QMARK:
      return stepQuestionMark(rows, filePath);
    case GlobTokenKinds.STAR:
      return stepStar(rows, filePath);
    case GlobTokenKinds.GLOBSTAR:
      return stepGlobstar(rows, filePath);
    case GlobTokenKinds.GLOBSTAR_SLASH:
      return stepGlobstarSlash(rows, filePath);
  }
}

function fitRows(rows: ScanRows, size: number): void {
  if (rows.reach.length >= size) {
    return;
  }
  rows.reach = new Uint8Array(size);
  rows.next = new Uint8Array(size);
}

/** `matchesGlob`'s sweep over pre-read tokens and reused rows. */
function matchesScanGlob(
  glob: ScanGlob,
  filePath: string,
  rows: ScanRows,
): boolean {
  fitRows(rows, filePath.length + 1);
  rows.reach.fill(0, 0, filePath.length + 1);
  rows.reach[0] = 1;

  for (const token of glob.tokens) {
    if (!stepToken(token, rows, filePath)) {
      return false;
    }
    const { reach, next } = rows;
    rows.reach = next;
    rows.next = reach;
  }
  return rows.reach[filePath.length] === 1;
}

/** One list against every glob, or `undefined` once the steps run out. */
function matchesAnyInList(
  globs: readonly ScanGlob[],
  filePaths: readonly string[],
  state: ScanState,
): boolean | undefined {
  for (const glob of globs) {
    for (const filePath of filePaths) {
      if (!fitsLiteralEnds(glob, filePath)) {
        continue;
      }
      state.stepsLeft -= glob.tokens.length * (filePath.length + 1);
      if (state.stepsLeft < 0) {
        return undefined;
      }
      if (matchesScanGlob(glob, filePath, state.rows)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether any glob matches any path, as `matchesGlob` reads them, or
 * `undefined` once the scan would pass `maxSteps` (glob tokens x path
 * length). The lists go in order on one budget, every glob against a list
 * before the next list, the glob with the longest literal prefix first. A
 * path that lacks a glob's literal prefix or suffix costs no steps.
 */
export function matchesAnyGlob(
  patterns: readonly string[],
  pathLists: readonly (readonly string[])[],
  maxSteps: number,
): boolean | undefined {
  const globs = patterns
    .map(readScanGlob)
    .toSorted((left, right) => right.prefix.length - left.prefix.length);
  const state: ScanState = {
    rows: { reach: new Uint8Array(0), next: new Uint8Array(0) },
    stepsLeft: maxSteps,
  };

  for (const filePaths of pathLists) {
    const matched = matchesAnyInList(globs, filePaths, state);
    if (matched !== false) {
      return matched;
    }
  }
  return false;
}
