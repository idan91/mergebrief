import {
  GrammarNames,
  Preludes,
  SideStarts,
  type GrammarName,
  type Prelude,
  type SideStart,
} from "./types";

const MARKUP_GRAMMARS = new Set<GrammarName>([
  GrammarNames.ASTRO,
  GrammarNames.HTML,
  GrammarNames.VUE,
]);
// A closing tag counts only where a formatter puts it, at the start of its
// line. Inside a string it is code, and `style-guide` is another element.
const REGION_MARKER =
  /^[ \t]*<\/(?:script|style)\s*>|<(?:script|style)(?![\w-])/im;
const ASTRO_REGION_MARKER =
  /^---[ \t\r]*$|^[ \t]*<\/(?:script|style)\s*>|<(?:script|style)(?![\w-])/im;
const FRONTMATTER_FENCE = "---";
const SCRIPT_CLOSER = "</script";
const STYLE_CLOSER = "</style";
const NOT_FOUND = -1;

interface ClosedRegion {
  region: Prelude;
  openingTag: Prelude;
}

const SCRIPT_REGION: ClosedRegion = {
  region: Preludes.OPEN_SCRIPT,
  openingTag: Preludes.OPEN_SCRIPT_TAG,
};
const STYLE_REGION: ClosedRegion = {
  region: Preludes.OPEN_STYLE,
  openingTag: Preludes.OPEN_STYLE_TAG,
};
// A wrapped opening tag holds one attribute a line, and its `>` hugs the
// last attribute or sits on a line of its own. Code also ends lines in `>`,
// after a space, and closes a wrapped type list on a lone `>`, so the tag is
// believed only with a valued attribute in it, or from the bracket itself.
const ATTRIBUTE_LINE =
  /^\s*[:@#]?[A-Za-z][\w.:-]*(?:=(?:"[^"]*"|'[^']*'|\{.*\}))?\s*$/;
const VALUED_ATTRIBUTE_LINE =
  /^\s*[:@#]?[A-Za-z][\w.:-]*=(?:"[^"]*"|'[^']*'|\{.*\})>?\s*$/;
const TAG_END_LINE =
  /^\s*(?:[:@#]?[A-Za-z][\w.:-]*(?:=(?:"[^"]*"|'[^']*'|\{.*\}))?)?>\s*$/;
const LONE_BRACKET_LINE = /^\s*>\s*$/;
const COMMENTED_REGIONS: Partial<Record<Prelude, Prelude>> = {
  [Preludes.OPEN_FRONTMATTER]: Preludes.OPEN_FRONTMATTER_COMMENT,
  [Preludes.OPEN_SCRIPT]: Preludes.OPEN_SCRIPT_COMMENT,
  [Preludes.OPEN_STYLE]: Preludes.OPEN_STYLE_COMMENT,
};
// An opening `<` that follows an identifier, a call or an index is a generic
// or a comparison, never a tag. A `//` comment may name a tag and stay code.
// A line that starts on `name="` is an attribute of a tag opened above, and
// one that starts on `{name`, `{{` or `{#` is a template expression or block.
const MARKUP_LINE_SIGNALS = [
  /^(?!\s*\/\/).*?(?:<\/[A-Za-z]|(?<![\w$.)\]])<[A-Za-z!]|\/>)/,
  /^\s*[:@#]?[A-Za-z][\w.:-]*=["'{]/,
  /^\s*\{[\w$!({#:/@]/,
];
// Each is anchored to the line's start, so the body of a comment and a
// sentence that only mentions the syntax never match. Beyond a statement
// start: a block arrow, an assignment to a name, a member call, an optional
// member, a typed member. A line that only ends in `;` or `{` is no evidence,
// since a declaration and a selector end that way.
const CODE_LINE_SIGNALS = [
  /^\s*import\s.*["']/,
  /^\s*export\s+(?:async|class|const|default|function|interface|let|type|var)\b/,
  /^\s*(?:const|let|var)\s+[^=;]+=/,
  /^\s*(?:interface\s+\w+|type\s+\w+[^=]*=)/,
  /^\s*(?:async\s+)?function\b.*\(/,
  /^\s*(?:for|if|switch|while)\s*\(/,
  /^\s*(?:abstract\s+)?class\s+[\w$]+/,
  /^\s*\$:\s/,
  /^(?!\s*(?:\*|\/\/))[^"'`]*(?:\)\s*=>|=>\s*[({[])/,
  /^\s*[\w$#]+(?:\??\.[\w$#]+|\[[^\]]*\])*\s+(?:[-+*/%]|\|\||&&|\?\?)?=(?![=>])\s/,
  /^\s*(?:await\s+|return\s+|void\s+)?[\w$]+(?:\??\.[\w$]+)+\(/,
  /^\s*(?:readonly\s+)?[a-z_$][\w$]*\?\s*:/,
  /^\s*(?:readonly\s+)?[a-z_$][\w$]*\s*:\s*(?:(?:any|bigint|boolean|never|null|number|object|string|symbol|undefined|unknown|void)\b|[^"'`;]*(?:\[\]|\||<[\w$]))[^;]*[;,]\s*$/,
];
// A selector's tail takes `=` only inside an attribute selector, so a field
// initializer, an arrow and a generic call are never read as one. An at-rule
// is never followed by `(` directly, which a decorator is, and the flow rules
// a template language shares (`@if`, `@for`) are left out. A `$name:` that
// ends in a comma is an object entry, and a hyphenated name is a property
// only when its value ends in `;` or starts on the next line.
const STYLE_LINE_SIGNALS = [
  /^\s*[.#][\w-]+(?![\w(-])(?:\[[^\]]*\]|[^;<=[])*\{\s*$/,
  /^\s*&(?:[:.[_-]|\s*[>+~])(?:\[[^\]]*\]|[^;<=[])*\{\s*$/,
  /^\s*::?[a-z-]+(?:\[[^\]]*\]|[^;<=[])*\{\s*$/,
  /^\s*@(?:apply|container|extend|font-face|forward|import|include|keyframes|layer|media|mixin|page|property|scope|starting-style|supports|tailwind|theme|use|utility|variant)\b(?!\()/,
  /^\s*\$[\w-]+\s*:(?!.*,\s*$)/,
  /^\s*(?:--[\w-]+|-?[a-z]+(?:-[a-z0-9]+)+)\s*:(?:\s+\S.*;)?\s*$/,
  /^\s*[a-z-]+\s*:[^"'`;{}]*(?:\d(?:px|rem|em|vh|vw|ms|fr|deg|%)|(?<=[\s:,(])#[0-9a-f]{3,8}\b|var\(--)[^"'`]*;\s*$/i,
];
// A side that holds one backtick of a pair starts or ends inside a template
// string. Read as code, the string it opens runs past the fence or tag that
// ends the region, and everything below takes its colour.
const UNESCAPED_BACKTICK = /(?<!\\)`/g;
const PAIR = 2;
// A longer line is minified or generated, and says nothing about the region.
const SHAPE_LINE_CEILING = 400;

/**
 * The region of a markup file a hunk side was cut out of, when the side does
 * not open it itself. A closing fence or tag proves the region. A side that
 * shows neither is read by shape: no markup line, and lines that only a
 * stylesheet or only code can hold. A side holding both, or neither, is left
 * as it is.
 */
export function deriveRegionPrelude(
  text: string,
  grammar: GrammarName,
  sideStart: SideStart = SideStarts.UNKNOWN,
): Prelude | undefined {
  if (!MARKUP_GRAMMARS.has(grammar)) {
    return undefined;
  }

  const pattern =
    grammar === GrammarNames.ASTRO ? ASTRO_REGION_MARKER : REGION_MARKER;
  const marker = pattern.exec(text);
  if (marker === null) {
    return deriveShapedRegion(text, grammar);
  }

  const textBefore = text.slice(0, marker.index);
  if (marker[0].startsWith(FRONTMATTER_FENCE)) {
    return deriveFencedRegion(textBefore, sideStart);
  }

  return deriveTaggedRegion(textBefore, marker[0]);
}

/**
 * The region of a side that opens inside a block comment, read from the text
 * after that comment. A bare comment prelude would leave a markup grammar in
 * markup, where `/*` is text. A closer that follows a statement closes no
 * comment, it ends a regex or a glob, so that side takes the region alone.
 */
export function deriveCommentedRegionPrelude(
  commentText: string,
  textAfterComment: string,
  grammar: GrammarName,
): Prelude | undefined {
  const region = deriveRegionPrelude(
    textAfterComment,
    grammar,
    SideStarts.MID_FILE,
  );
  if (region === undefined) {
    return undefined;
  }

  const followsStatement = listShapeLines(commentText).some(isCodeLine);

  return followsStatement ? region : COMMENTED_REGIONS[region];
}

/**
 * A fence under a line of code closes the frontmatter that code sits in. A
 * fence that leads the side closes one only when the side is known to start
 * below the file's first line. Otherwise it may be the opening fence, which
 * the grammar reads correctly with no prelude. A fence under anything else,
 * prose included, proves nothing.
 */
function deriveFencedRegion(
  textBefore: string,
  sideStart: SideStart,
): Prelude | undefined {
  const unreadable = holdsMarkupLine(textBefore) || splitsTemplate(textBefore);
  if (unreadable) {
    return undefined;
  }

  const leadsSide = textBefore.trim() === "";
  if (leadsSide) {
    return sideStart === SideStarts.MID_FILE
      ? Preludes.OPEN_FRONTMATTER
      : undefined;
  }

  return listShapeLines(textBefore).some(isCodeLine)
    ? Preludes.OPEN_FRONTMATTER
    : undefined;
}

/**
 * The text above a closing tag says where the side starts: on the attribute
 * lines of that tag's own wrapped opener, inside the region, or somewhere a
 * line of markup or a lone `>` leaves unclear. An opening tag as the first
 * marker means the side starts outside the region.
 */
function deriveTaggedRegion(
  textBefore: string,
  marker: string,
): Prelude | undefined {
  const closed = resolveClosedRegion(marker);
  if (closed === undefined) {
    return undefined;
  }

  const lines = textBefore.split("\n").filter(holdsText);
  if (startsInsideOpeningTag(lines)) {
    return closed.openingTag;
  }

  const unreadable = lines.some(isUnclearLine) || splitsTemplate(textBefore);

  return unreadable ? undefined : closed.region;
}

function resolveClosedRegion(marker: string): ClosedRegion | undefined {
  const tag = marker.trim().toLowerCase();
  if (tag.startsWith(SCRIPT_CLOSER)) {
    return SCRIPT_REGION;
  }

  return tag.startsWith(STYLE_CLOSER) ? STYLE_REGION : undefined;
}

function startsInsideOpeningTag(lines: string[]): boolean {
  const tagEnd = lines.findIndex((line) => TAG_END_LINE.test(line));
  if (tagEnd === NOT_FOUND) {
    return false;
  }

  const attributeLines = lines.slice(0, tagEnd);
  if (!attributeLines.every((line) => ATTRIBUTE_LINE.test(line))) {
    return false;
  }

  const tagLines = lines.slice(0, tagEnd + 1);
  const startsOnBracket = LONE_BRACKET_LINE.test(lines[0] ?? "");

  return startsOnBracket || tagLines.some(isValuedAttributeLine);
}

function isValuedAttributeLine(line: string): boolean {
  return VALUED_ATTRIBUTE_LINE.test(line);
}

function isUnclearLine(line: string): boolean {
  return LONE_BRACKET_LINE.test(line) || isMarkupLine(line);
}

function holdsText(line: string): boolean {
  return line.trim() !== "";
}

function deriveShapedRegion(
  text: string,
  grammar: GrammarName,
): Prelude | undefined {
  if (holdsMarkupLine(text)) {
    return undefined;
  }

  const lines = listShapeLines(text);
  const holdsCode = lines.some(isCodeLine);
  if (lines.some(isStyleLine)) {
    return holdsCode ? undefined : Preludes.OPEN_STYLE;
  }
  const unreadable = !holdsCode || splitsTemplate(text);
  if (unreadable) {
    return undefined;
  }

  return grammar === GrammarNames.ASTRO
    ? Preludes.OPEN_FRONTMATTER
    : Preludes.OPEN_SCRIPT;
}

function splitsTemplate(text: string): boolean {
  const backticks = text.match(UNESCAPED_BACKTICK) ?? [];

  return backticks.length % PAIR !== 0;
}

function holdsMarkupLine(text: string): boolean {
  return text.split("\n").some(isMarkupLine);
}

function isMarkupLine(line: string): boolean {
  return MARKUP_LINE_SIGNALS.some((signal) => signal.test(line));
}

function listShapeLines(text: string): string[] {
  return text.split("\n").filter(isShapeLine);
}

function isShapeLine(line: string): boolean {
  return line.length <= SHAPE_LINE_CEILING;
}

function isStyleLine(line: string): boolean {
  return STYLE_LINE_SIGNALS.some((signal) => signal.test(line));
}

function isCodeLine(line: string): boolean {
  return CODE_LINE_SIGNALS.some((signal) => signal.test(line));
}
