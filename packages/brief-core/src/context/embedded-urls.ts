import type { TextRange } from "../generation/untrusted-text";
import { NOT_FOUND } from "./visible-text/consts";

const URL_SCHEME = String.raw`(?:https?:\/\/|ftp:\/\/|www\.)`;
/** A GFM autolink, from a scheme or `www.`, runs to ASCII whitespace or `<`; a URL that starts inside one is part of it. */
const URL_TOKEN = new RegExp(String.raw`${URL_SCHEME}[^ \t\n\v\f\r<]+`, "gi");
/** A URL's start inside one whitespace-free run, short of the run's end. */
const URL_START = new RegExp(`${URL_SCHEME}(?!$)`, "gi");
/** Where a link label hands over to its target. */
const LABEL_END = "](";
/** What a GFM autolink leaves off its end, plus the `;` an entity would end on. */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "*",
  "_",
  "~",
]);

/** Whether the `[` before an offset opens a link label, not escaped by an odd run of backslashes. */
function isAfterLabelOpener(text: string, offset: number): boolean {
  if (text[offset - 1] !== "[") {
    return false;
  }
  let backslashes = 0;
  while (text[offset - 2 - backslashes] === "\\") {
    backslashes += 1;
  }
  const opensLabel = backslashes % 2 === 0;
  return opensLabel;
}

/**
 * The tokens one whitespace-free run holds: a URL opening a link label ends
 * at `](`, and the next URL after it is a token of its own. Each step scans
 * forward from the last, so the run is read once.
 */
function splitRun(text: string, runStart: number, run: string): TextRange[] {
  const urlStart = new RegExp(URL_START.source, URL_START.flags);
  const tokens: TextRange[] = [];
  let tokenStart = 0;

  for (;;) {
    const opensLabel = isAfterLabelOpener(text, runStart + tokenStart);
    const labelEnd = opensLabel
      ? run.indexOf(LABEL_END, tokenStart)
      : NOT_FOUND;
    if (labelEnd === NOT_FOUND) {
      tokens.push({ start: runStart + tokenStart, end: runStart + run.length });
      return tokens;
    }
    tokens.push({ start: runStart + tokenStart, end: runStart + labelEnd });

    urlStart.lastIndex = labelEnd;
    const next = urlStart.exec(run);
    if (next === null) {
      return tokens;
    }
    tokenStart = next.index;
  }
}

function collectUrlTokens(text: string): TextRange[] {
  return [...text.matchAll(URL_TOKEN)].flatMap((match) =>
    splitRun(text, match.index, match[0]),
  );
}

/**
 * Whether a URL at an offset starts inside an earlier one, so the reader
 * sees it as part of another link; asked in increasing order, one pass.
 */
export function createEmbeddedUrlCheck(
  text: string,
): (offset: number) => boolean {
  const tokens = collectUrlTokens(text);

  let next = 0;
  return (offset) => {
    while ((tokens[next]?.end ?? Infinity) <= offset) {
      next += 1;
    }
    const token = tokens[next];
    const insideToken = token !== undefined && token.start < offset;
    return insideToken;
  };
}

/** A URL read out of text without the punctuation or emphasis delimiters that close the sentence around it. */
export function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(url.charAt(end - 1))) {
    end -= 1;
  }
  return url.slice(0, end);
}
