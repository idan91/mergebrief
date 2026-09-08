// The path matcher two owners share: the server shapes repo context with it,
// apps/web presents the same repo configuration. Pure and browser-safe: no
// Node globals, no runtime imports.

import type { ValueOf } from "types";

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
    if (reachable[j] === true && filePath[j] === char) next[j + 1] = true;
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
    if (reachable[j] === true && filePath[j] !== "/") next[j + 1] = true;
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
    if (active) next[j] = true;
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
    if (seen) next[j] = true;
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
    if (reachable[j] === true) next[j] = true;
    if (seenBefore && j > 0 && filePath[j - 1] === "/") next[j] = true;
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
