import {
  GrammarNames,
  Preludes,
  type DerivedPrelude,
  type GrammarName,
} from "./types";

const JSX_GRAMMARS = new Set<GrammarName>([GrammarNames.TSX, GrammarNames.JSX]);
const BLOCK_COMMENT_GRAMMARS = new Set<GrammarName>([
  GrammarNames.TYPESCRIPT,
  GrammarNames.TSX,
  GrammarNames.JAVASCRIPT,
  GrammarNames.JSX,
  GrammarNames.CSS,
  GrammarNames.SCSS,
  GrammarNames.VUE,
  GrammarNames.ASTRO,
  GrammarNames.SQL,
  GrammarNames.GRAPHQL,
]);
const CLOSER_AT_LINE_END = /\*\/(?=\s|$)/;
const ATTRIBUTE_LINE = /^\s*[A-Za-z][\w-]*=(\{|"|')/;
const TAG_CLOSE_LINE = /^\s*\/?>\s*$/;
const NOT_FOUND = -1;

/**
 * The grammar state a hunk side was cut out of, expressed as code the
 * tokenizer receives as grammar context, never prepended to the side text.
 * A side that begins inside a template literal is deliberately absent. Parsed
 * from a cold start a template's closing backtick reads as an opener, so the
 * side's own text cannot tell a side that opens one from a side that closes
 * one; deciding it needs the file's prefix. Such a side renders as code.
 */
export function derivePrelude(
  text: string,
  grammar: GrammarName,
): DerivedPrelude {
  if (startsInsideBlockComment(text, grammar)) return Preludes.BLOCK_COMMENT;
  if (opensMidTag(text, grammar)) return Preludes.OPEN_TAG;

  return undefined;
}

function startsInsideBlockComment(text: string, grammar: GrammarName): boolean {
  if (!BLOCK_COMMENT_GRAMMARS.has(grammar)) return false;

  const close = text.search(CLOSER_AT_LINE_END);
  if (close === NOT_FOUND) return false;

  const open = text.indexOf("/*");

  return open === NOT_FOUND || close < open;
}

function opensMidTag(text: string, grammar: GrammarName): boolean {
  if (!JSX_GRAMMARS.has(grammar)) return false;

  const first = findFirstContentLine(text);
  if (first === undefined) return false;

  return ATTRIBUTE_LINE.test(first) || TAG_CLOSE_LINE.test(first);
}

function findFirstContentLine(text: string): string | undefined {
  return text.split("\n").find((line) => line.trim() !== "");
}
