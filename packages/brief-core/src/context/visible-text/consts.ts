import { CONTAINER_PREFIX } from "../../generation/untrusted-text";

/** Inline Markdown passes a tag through only under a CommonMark tag name. */
export const INLINE_TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/y;

/** Inside an HTML block GitHub's HTML parser reads the tag, so any name counts. */
export const BLOCK_TAG = /<(\/?)([A-Za-z][^\s/>]*)/y;

/**
 * A line that opens an HTML block under any container prefix, by tag or by
 * comment, processing instruction, declaration or CDATA: wider than
 * CommonMark's start conditions, never narrower.
 */
export const HTML_BLOCK_OPENER = new RegExp(
  String.raw`^${CONTAINER_PREFIX}<(?:\/?(?<name>[A-Za-z][A-Za-z0-9-]*)(?:[\s/>]|$)|(?<markup>!--|\?|!\[CDATA\[|![A-Za-z]))`,
);

/** What ends a markup block's last line; a declaration ends at `>`. */
export const MARKUP_BLOCK_ENDS: ReadonlyMap<string, string> = new Map([
  ["!--", "-->"],
  ["?", "?>"],
  ["![CDATA[", "]]>"],
]);

/** A paragraph never runs past a blank line, read before hidden characters go, as GitHub's parser reads it. */
export const PARAGRAPH_END = /\n[ \t]*(?=\n|$)/g;
/** A blank line under any quote nesting, `>` markers and indent only: what ends a quoted paragraph. */
export const QUOTED_PARAGRAPH_END = /\n[ \t>]*(?=\n|$)/g;

/** Any of these ends a raw-text block, whichever tag opened it. */
export const RAW_TEXT_CLOSE = /<\/(?:pre|script|style|textarea)>/gi;

/** A fence's run of backticks or tildes; its info string never renders. */
export const FENCE_OPENER = new RegExp(
  `${CONTAINER_PREFIX}(?:\`{3,}|~{3,})`,
  "y",
);

/** HTML blocks that run to their closing tag instead of a blank line. */
export const RAW_TEXT_BLOCKS: ReadonlySet<string> = new Set([
  "pre",
  "script",
  "style",
  "textarea",
]);

/** Elements an HTML sanitizer drops together with their content. */
export const CONTENT_DROPPING_ELEMENTS: ReadonlySet<string> = new Set([
  "iframe",
  "math",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "svg",
  "template",
  "xmp",
]);

export const IMAGE_START = /!\[/g;

export const DESTINATION_START = /\]\(/g;
/** Where a full reference link's label starts: `[text][label]`. */
export const REFERENCE_LABEL_START = /\]\[/g;

export const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/** Where a URL in text ends; past one, a destination's text could only be a second URL. */
export const URL_STOP = /[\s<>()[\]"']/;

/** Nothing but container markers and indent before an offset on its line. */
export const CONTAINER_PREFIX_ONLY = new RegExp(`^${CONTAINER_PREFIX}$`);

/** A table's delimiter row past its container prefix: cells of hyphens, a colon at either end, padded as cmark-gfm pads them. */
export const DELIMITER_ROW =
  /^\|?[ \t\v\f]*:?-+:?[ \t\v\f]*(?:\|[ \t\v\f]*:?-+:?[ \t\v\f]*)*(?:\|[ \t\v\f]*)?$/;

export const DELIMITER_CELL = /-+/g;

/** Past its container prefix, a setext underline or a thematic break, which cmark reads before a table's delimiter row; a `\v` or `\f` pad makes it neither. */
export const HYPHEN_RULE = /^-+[ \t]*$/;

/** cmark drops a byte order mark before the first line is parsed. */
export const LEADING_BOM = /^\uFEFF/;

/** A label of spaces, hard breaks, emphasis or quote marks, or entities renders nothing: its target is no more shown than a title. */
export const EMPTY_LABEL_LINK =
  /\[(?:\s|\\(?=\n)|[*_~>]|&[#A-Za-z0-9]{1,32};)*\]\(\s*<?[^\s<>()[\]"']*/g;

export const NOT_FOUND = -1;

/** cmark's space characters, a superset of the HTML tokenizer's. */
export const SPACE_CHARS: ReadonlySet<string> = new Set([
  " ",
  "\t",
  "\n",
  "\v",
  "\f",
  "\r",
]);
