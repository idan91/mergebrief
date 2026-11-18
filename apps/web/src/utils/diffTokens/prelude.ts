import {
  deriveCommentedRegionPrelude,
  deriveRegionPrelude,
} from "./markup-region";
import {
  GrammarNames,
  Preludes,
  SideStarts,
  type DerivedPrelude,
  type GrammarName,
  type Prelude,
  type SideStart,
  type StyleRegionPrelude,
} from "./types";

const STATEMENT_ENDS = ["{", ";", "}"] as const;
type StatementEndCharacter = (typeof STATEMENT_ENDS)[number];

interface StatementEnd {
  character: StatementEndCharacter;
  index: number;
}

interface Bracket {
  open: "(" | "{";
  close: ")" | "}";
}

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
  GrammarNames.HTML,
  GrammarNames.SQL,
  GrammarNames.GRAPHQL,
  GrammarNames.C,
  GrammarNames.CPP,
  GrammarNames.CSHARP,
  GrammarNames.GO,
  GrammarNames.JAVA,
  GrammarNames.KOTLIN,
  GrammarNames.PHP,
  GrammarNames.RUST,
  GrammarNames.SWIFT,
  GrammarNames.DART,
  GrammarNames.HCL,
  GrammarNames.SCALA,
  GrammarNames.SVELTE,
  GrammarNames.TERRAFORM,
]);
const RULE_GRAMMARS = new Set<GrammarName>([
  GrammarNames.CSS,
  GrammarNames.SCSS,
]);
const CSS_NOISE =
  /\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const SCSS_NOISE =
  /url\([^)"'\n]*\)|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\/[^\n]*/gi;
const UNQUOTED_URL_START = "url(";
const SCSS_INTERPOLATION = /#\{[^}]*\}/g;
const INTERPOLATION_STAND_IN = "x";
const STRING_STAND_IN = '""';
const COMMENT_START = "/";
const COMMENT_CONTINUATION_LINE = /^\s*\*(?:\s|$)/;
const CODE_LINE_END = /[{;]\s*$/;
const UNIVERSAL_SELECTOR_START = /^\s*\*\s*(?:\{(?!@)|[>+~,])/;
const PARENS: Bracket = { open: "(", close: ")" };
const BRACES: Bracket = { open: "{", close: "}" };
const AT_RULE_START = /^\s*@/;
const SCSS_VARIABLE_START = /^\s*\$[\w-]+\s*:/;
const INDENTED_LINE = /^\s/;
const DECLARATION_START = /^\s*[\w-]+\s*:/;
const SPACED_DECLARATION_START = /^\s*[\w-]+\s*:(?:\s|$)/;
const PARENT_REFERENCE = "&";
const KEYFRAME_SELECTOR =
  /^\s*(?:from|to|[\d.]+%)(?:\s*,\s*(?:from|to|[\d.]+%))*\s*$/;
const BLOCK_COMMENT_CLOSER = "*/";
const CLOSER_AT_LINE_END = /\*\/(?=\s|$)/;
const ATTRIBUTE_LINE = /^\s*[A-Za-z][\w-]*=(\{|"|')/;
const TAG_CLOSE_LINE = /^\s*\/?>\s*$/;
const STYLE_CLOSER_LINE = /^[ \t]*<\/style\s*>/im;
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
  sideStart: SideStart = SideStarts.UNKNOWN,
): DerivedPrelude {
  if (startsInsideBlockComment(text, grammar)) {
    return deriveCommentPrelude(text, grammar);
  }
  if (continuesBlockComment(text, grammar)) {
    return Preludes.BLOCK_COMMENT;
  }
  if (opensMidTag(text, grammar)) {
    return Preludes.OPEN_TAG;
  }

  const region = deriveRegionPrelude(text, grammar, sideStart);
  if (region === Preludes.OPEN_STYLE) {
    return deriveStyleRegionPrelude(text);
  }

  return region ?? deriveRulePrelude(text, grammar);
}

function startsInsideBlockComment(text: string, grammar: GrammarName): boolean {
  if (!BLOCK_COMMENT_GRAMMARS.has(grammar)) {
    return false;
  }

  const close = text.search(CLOSER_AT_LINE_END);
  if (close === NOT_FOUND) {
    return false;
  }

  const open = text.indexOf("/*");

  return open === NOT_FOUND || close < open;
}

function deriveCommentPrelude(
  text: string,
  grammar: GrammarName,
): Prelude | StyleRegionPrelude {
  const commentEnd = findCommentEnd(text);
  const commentedRegion = deriveCommentedRegionPrelude(
    text.slice(0, commentEnd),
    text.slice(commentEnd),
    grammar,
  );
  if (commentedRegion === Preludes.OPEN_STYLE_COMMENT) {
    return deriveStyleRegionPrelude(text);
  }

  return commentedRegion ?? deriveStylesheetCommentPrelude(text, grammar);
}

function deriveStylesheetCommentPrelude(
  text: string,
  grammar: GrammarName,
): Prelude {
  const textAfterComment = text.slice(findCommentEnd(text));
  const afterComment = deriveRulePrelude(textAfterComment, grammar);
  if (afterComment === undefined) {
    return Preludes.BLOCK_COMMENT;
  }
  if (afterComment === Preludes.OPEN_KEYFRAMES) {
    return Preludes.OPEN_KEYFRAMES_COMMENT;
  }

  return Preludes.OPEN_RULE_COMMENT;
}

function findCommentEnd(text: string): number {
  return text.search(CLOSER_AT_LINE_END) + BLOCK_COMMENT_CLOSER.length;
}

/**
 * A style region is a stylesheet, so a side there may also start inside a
 * rule or a comment, and its prelude carries that state. Read from the top
 * level, a side that closes a rule it never opened keeps the grammar from
 * seeing the closing tag, and everything below it takes stylesheet colours.
 */
function deriveStyleRegionPrelude(text: string): Prelude | StyleRegionPrelude {
  const closer = STYLE_CLOSER_LINE.exec(text);
  const body = closer === null ? text : text.slice(0, closer.index);
  const stylesheetState = deriveStylesheetState(body);
  if (stylesheetState === undefined) {
    return Preludes.OPEN_STYLE;
  }

  return `${Preludes.OPEN_STYLE}\n${stylesheetState}`;
}

/** Read with the nesting rules, which hold for a nested stylesheet of any dialect. */
function deriveStylesheetState(body: string): Prelude | undefined {
  if (startsInsideBlockComment(body, GrammarNames.SCSS)) {
    return deriveStylesheetCommentPrelude(body, GrammarNames.SCSS);
  }

  return deriveRulePrelude(body, GrammarNames.SCSS);
}

/**
 * A side made only of ` * ` lines sits in a block comment. A line ending in
 * `{` or `;`, or a `*` followed by a brace or a combinator, is code, as
 * `* {`, `* { margin: 0; }` and `* + * {` are; `{@link}` and a trailing `}`
 * stay comment text.
 */
function continuesBlockComment(text: string, grammar: GrammarName): boolean {
  const holdsCommentMarker = text.includes("/*") || text.includes("*/");
  if (!RULE_GRAMMARS.has(grammar) || holdsCommentMarker) {
    return false;
  }

  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return false;
  }

  return lines.every(isCommentContinuationLine);
}

function isCommentContinuationLine(line: string): boolean {
  if (!COMMENT_CONTINUATION_LINE.test(line)) {
    return false;
  }

  const readsAsCode =
    CODE_LINE_END.test(line) || UNIVERSAL_SELECTOR_START.test(line);

  return !readsAsCode;
}

function opensMidTag(text: string, grammar: GrammarName): boolean {
  if (!JSX_GRAMMARS.has(grammar)) {
    return false;
  }

  const first = findFirstContentLine(text);
  if (first === undefined) {
    return false;
  }

  return ATTRIBUTE_LINE.test(first) || TAG_CLOSE_LINE.test(first);
}

/**
 * What a stylesheet side reaches first outside any parens tells where it was
 * cut: a `}` puts it in a block, a `;` ends the statement it started in, and
 * a `{` opens the selector, keyframe or at-rule it started on. A `)` it never
 * opened before a `;` or `}` puts it in a function's arguments; before a `{`
 * or with no end in sight it may close a selector's `:is(` list instead.
 * Comments and strings are read past.
 */
function deriveRulePrelude(
  text: string,
  grammar: GrammarName,
): Prelude | undefined {
  if (!RULE_GRAMMARS.has(grammar)) {
    return undefined;
  }

  const code = stripRuleNoise(text, grammar);
  const end = findFirstStatementEnd(code);
  if (end === undefined) {
    return deriveUnendedPrelude(code);
  }

  const head = code.slice(0, end.index);
  const insideArguments = end.character !== "{" && closesUnopenedParen(head);
  if (insideArguments) {
    return Preludes.OPEN_ARGUMENTS;
  }
  if (end.character === "}") {
    return Preludes.OPEN_RULE;
  }
  if (end.character === ";") {
    return deriveStatementPrelude(head, grammar);
  }
  if (KEYFRAME_SELECTOR.test(head)) {
    return Preludes.OPEN_KEYFRAMES;
  }

  return opensRuleAroundSelector(code, head, grammar)
    ? Preludes.OPEN_RULE
    : undefined;
}

/** One left-to-right pass, so a quote inside a comment or a `//` inside a string is never read as the other. */
function stripRuleNoise(text: string, grammar: GrammarName): string {
  if (grammar !== GrammarNames.SCSS) {
    return text.replace(CSS_NOISE, shapeNoiseStandIn);
  }

  return text
    .replace(SCSS_NOISE, shapeNoiseStandIn)
    .replace(SCSS_INTERPOLATION, INTERPOLATION_STAND_IN);
}

/** An unquoted `url(...)` is matched only so a `//` inside it is not taken for a comment; it stays as written. */
function shapeNoiseStandIn(noise: string): string {
  if (noise.startsWith(UNQUOTED_URL_START)) {
    return noise;
  }

  return noise.startsWith(COMMENT_START) ? "" : STRING_STAND_IN;
}

/** A paren the side never opened counts as depth 0, so a statement end after it still counts. */
function findFirstStatementEnd(code: string): StatementEnd | undefined {
  let parenDepth = 0;
  for (let index = 0; index < code.length; index += 1) {
    const character = code.charAt(index);
    parenDepth += readDepthStep(character, PARENS);
    const endsStatement = parenDepth <= 0 && isStatementEnd(character);
    if (endsStatement) {
      return { character, index };
    }
  }

  return undefined;
}

function isStatementEnd(character: string): character is StatementEndCharacter {
  return STATEMENT_ENDS.some((end) => end === character);
}

function closesUnopenedParen(code: string): boolean {
  return readsBelowZero(code, PARENS);
}

function closesBeforeOpening(code: string): boolean {
  return readsBelowZero(code, BRACES);
}

function readsBelowZero(code: string, bracket: Bracket): boolean {
  let depth = 0;
  for (const character of code) {
    depth += readDepthStep(character, bracket);
    if (depth < 0) {
      return true;
    }
  }

  return false;
}

function readDepthStep(character: string, bracket: Bracket): number {
  if (character === bracket.open) {
    return 1;
  }
  if (character === bracket.close) {
    return -1;
  }

  return 0;
}

/** Without a `;` a `prop:` start needs the space after its colon, or `a:hover,` would match. */
function deriveUnendedPrelude(code: string): Prelude | undefined {
  const first = findFirstContentLine(code) ?? "";

  return SPACED_DECLARATION_START.test(first) ? Preludes.OPEN_RULE : undefined;
}

/** Top-level SCSS takes an unindented `$x:` or `@use`, so only an indented one sits in a rule. */
function deriveStatementPrelude(
  statement: string,
  grammar: GrammarName,
): Prelude | undefined {
  const first = findFirstContentLine(statement) ?? "";
  const opensStatement =
    AT_RULE_START.test(first) || SCSS_VARIABLE_START.test(first);
  if (opensStatement) {
    const sitsInRule =
      grammar === GrammarNames.SCSS && INDENTED_LINE.test(first);

    return sitsInRule ? Preludes.OPEN_RULE : undefined;
  }
  if (DECLARATION_START.test(first)) {
    return Preludes.OPEN_RULE;
  }

  return Preludes.OPEN_VALUE;
}

/**
 * Plain CSS nests no rule inside a rule. An SCSS selector sits in one when it
 * names its parent, is an at-rule that closes its parent, or reaches a
 * declaration before that `}`. A plain selector that only closes its parent
 * may sit in an at-rule, where a rule context misreads `:global(...)`.
 */
function opensRuleAroundSelector(
  code: string,
  head: string,
  grammar: GrammarName,
): boolean {
  if (grammar !== GrammarNames.SCSS) {
    return false;
  }

  const namesParent = head.includes(PARENT_REFERENCE);
  const nestedAtRule = AT_RULE_START.test(head) && closesBeforeOpening(code);
  if (namesParent || nestedAtRule) {
    return true;
  }

  return reachesParentDeclaration(code);
}

function reachesParentDeclaration(code: string): boolean {
  let braceDepth = 0;
  let parenDepth = 0;
  for (const character of code) {
    braceDepth += readDepthStep(character, BRACES);
    parenDepth += readDepthStep(character, PARENS);
    if (braceDepth < 0) {
      return false;
    }
    const atParentLevel = braceDepth === 0 && parenDepth <= 0;
    if (character === ";" && atParentLevel) {
      return true;
    }
  }

  return false;
}

function findFirstContentLine(text: string): string | undefined {
  return text.split("\n").find((line) => line.trim() !== "");
}
