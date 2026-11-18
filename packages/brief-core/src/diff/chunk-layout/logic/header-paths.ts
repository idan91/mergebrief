import {
  DIFF_FILE_HEADER_LEAD,
  FILE_LINE_TRAILER,
  GIT_CHAR_ESCAPES,
  GIT_ESCAPE,
  GIT_QUOTE,
  HUNK_LEAD,
  LINE_OR_DIRECTION_CONTROL,
  LINE_TERMINATOR,
  OCTAL_RADIX,
  POST_PATH_LINES,
  POST_SIDE_PREFIX,
  PRE_PATH_LINES,
  PRE_SIDE_PREFIX,
} from "../consts";
import type { DiffHeaderPaths, PatchPathLine } from "../types";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

interface HeaderTokens {
  pre: string;
  post: string;
  /** More than one ` b/` could end the pre path: only the patch's own path lines tell which. */
  splitsTwoWays?: true;
}

interface HeaderReading {
  paths: DiffHeaderPaths;
  splitsTwoWays: boolean;
}

function isQuotedToken(token: string): boolean {
  const longEnough = token.length >= GIT_QUOTE.length * 2;
  const isWrappedInQuotes =
    longEnough && token.startsWith(GIT_QUOTE) && token.endsWith(GIT_QUOTE);
  return isWrappedInQuotes;
}

function appendUtf8(bytes: number[], text: string): void {
  for (const byte of UTF8_ENCODER.encode(text)) {
    bytes.push(byte);
  }
}

function decodeUtf8(bytes: readonly number[]): string | undefined {
  try {
    return UTF8_DECODER.decode(new Uint8Array(bytes));
  } catch {
    return undefined;
  }
}

/**
 * The text a C-quoted token encodes: octal escapes are bytes, read as UTF-8
 * once collected. Nothing when the bytes are no UTF-8 or the text holds a
 * line or direction control.
 */
function unquoteGitToken(token: string): string | undefined {
  const quoted = token.slice(GIT_QUOTE.length, -GIT_QUOTE.length);
  const bytes: number[] = [];
  let copied = 0;
  for (const match of quoted.matchAll(GIT_ESCAPE)) {
    appendUtf8(bytes, quoted.slice(copied, match.index));
    const [escape, octal, char = ""] = match;
    if (octal === undefined) {
      appendUtf8(bytes, GIT_CHAR_ESCAPES[char] ?? char);
    } else {
      bytes.push(Number.parseInt(octal, OCTAL_RADIX));
    }
    copied = match.index + escape.length;
  }
  appendUtf8(bytes, quoted.slice(copied));

  const decoded = decodeUtf8(bytes);
  const decodesToPrintable =
    decoded !== undefined && !LINE_OR_DIRECTION_CONTROL.test(decoded);
  return decodesToPrintable ? decoded : undefined;
}

/**
 * The path a header line's token names past `side` (`a/`, `b/`, or none),
 * git's C-quoting decoded; nothing when it does not start with `side`. A
 * quoted token that does not decode to printable UTF-8, or decodes to a path
 * shaped like a quoted token, keeps its spelling whole: git quotes each name
 * one way, so no two files share a path.
 */
export function readGitPath(token: string, side: string): string | undefined {
  const decoded = isQuotedToken(token) ? unquoteGitToken(token) : token;
  if (decoded === undefined) {
    return token;
  }
  if (!decoded.startsWith(side)) {
    return undefined;
  }
  const path = decoded.slice(side.length);
  return isQuotedToken(path) ? token : path;
}

/** A path token with no side prefix (`rename from`, `rename to`), read as `readGitPath` reads one. */
export function decodeGitPath(token: string): string {
  return readGitPath(token, "") ?? token;
}

/** Index of the quote closing the token `text` opens, past every backslashed character. */
function findClosingQuote(text: string): number {
  for (let index = GIT_QUOTE.length; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === GIT_QUOTE) {
      return index;
    }
  }
  return -1;
}

/** Where two unquoted paths split: where both halves name the same path, else at the last ` b/`. */
function findUnquotedSplit(rest: string, separator: string): number {
  const middle = (rest.length - 1) / 2;
  const splitsAtMiddle = Number.isInteger(middle) && rest[middle] === " ";
  if (splitsAtMiddle) {
    const pre = rest.slice(0, middle);
    const post = rest.slice(middle + 1);
    const samePath =
      pre.slice(PRE_SIDE_PREFIX.length) === post.slice(POST_SIDE_PREFIX.length);
    const halvesNameOnePath = samePath && pre.startsWith(PRE_SIDE_PREFIX);
    if (halvesNameOnePath) {
      return middle;
    }
  }
  return rest.lastIndexOf(separator);
}

/**
 * Two unquoted paths. A line holding more than one ` b/` splits two ways
 * even where its halves match: a rename can read as an edit of another file.
 */
function splitUnquotedTokens(rest: string): HeaderTokens | undefined {
  const separator = ` ${POST_SIDE_PREFIX}`;
  const split = findUnquotedSplit(rest, separator);
  if (split === -1) {
    return undefined;
  }
  const tokens: HeaderTokens = {
    pre: rest.slice(0, split),
    post: rest.slice(split + 1),
  };
  if (rest.indexOf(separator) !== rest.lastIndexOf(separator)) {
    tokens.splitsTwoWays = true;
  }
  return tokens;
}

/** git quotes each path on its own, so either token may be quoted; an unquoted one holds no quote. */
function splitHeaderTokens(rest: string): HeaderTokens | undefined {
  if (rest.startsWith(GIT_QUOTE)) {
    const close = findClosingQuote(rest);
    const closesBeforeSpace = close !== -1 && rest[close + 1] === " ";
    if (!closesBeforeSpace) {
      return undefined;
    }
    return { pre: rest.slice(0, close + 1), post: rest.slice(close + 2) };
  }
  if (rest.endsWith(GIT_QUOTE)) {
    const split = rest.indexOf(` ${GIT_QUOTE}`);
    if (split === -1) {
      return undefined;
    }
    return { pre: rest.slice(0, split), post: rest.slice(split + 1) };
  }
  return splitUnquotedTokens(rest);
}

function readHeaderLine(line: string): HeaderReading | undefined {
  const isHeader =
    line.startsWith(DIFF_FILE_HEADER_LEAD) && !LINE_TERMINATOR.test(line);
  if (!isHeader) {
    return undefined;
  }
  const tokens = splitHeaderTokens(line.slice(DIFF_FILE_HEADER_LEAD.length));
  if (tokens === undefined) {
    return undefined;
  }

  const pre = readGitPath(tokens.pre, PRE_SIDE_PREFIX);
  const post = readGitPath(tokens.post, POST_SIDE_PREFIX);
  if (pre === undefined || post === undefined) {
    return undefined;
  }
  return { paths: { pre, post }, splitsTwoWays: tokens.splitsTwoWays === true };
}

/** The pre and post paths of a `diff --git` line, or nothing when the line is no such header. */
export function parseDiffHeaderPaths(
  line: string,
): DiffHeaderPaths | undefined {
  return readHeaderLine(line)?.paths;
}

/** The path `line` names through one of `kinds`; `/dev/null` and any other line name none. */
export function readPathLine(
  line: string,
  kinds: readonly PatchPathLine[],
): string | undefined {
  const kind = kinds.find((candidate) => line.startsWith(candidate.lead));
  if (kind === undefined) {
    return undefined;
  }
  const token = line.slice(kind.lead.length);
  const trailed = token.endsWith(FILE_LINE_TRAILER);
  const path = trailed ? token.slice(0, -FILE_LINE_TRAILER.length) : token;
  return readGitPath(path, kind.side);
}

/** Every path the lines before the patch's first hunk name through `kinds`. */
export function listPatchPaths(
  patch: string,
  kinds: readonly PatchPathLine[],
): string[] {
  const paths: string[] = [];
  for (let lineStart = 0; lineStart < patch.length; ) {
    const newline = patch.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? patch.length : newline;
    const line = patch.slice(lineStart, lineEnd);
    if (line.startsWith(HUNK_LEAD)) {
      break;
    }
    const path = readPathLine(line, kinds);
    if (path !== undefined) {
      paths.push(path);
    }
    lineStart = lineEnd + 1;
  }
  return paths;
}

/** The first path the lines from `start` to the patch's first hunk name through `kinds`. */
function findPatchPath(
  patch: string,
  start: number,
  kinds: readonly PatchPathLine[],
): string | undefined {
  for (let lineStart = start; lineStart < patch.length; ) {
    const newline = patch.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? patch.length : newline;
    const line = patch.slice(lineStart, lineEnd);
    if (line.startsWith(HUNK_LEAD)) {
      return undefined;
    }
    const path = readPathLine(line, kinds);
    if (path !== undefined) {
      return path;
    }
    lineStart = lineEnd + 1;
  }
  return undefined;
}

/**
 * The pre and post paths of one file's patch, its `diff --git` line first. A
 * header whose unquoted paths split at more than one ` b/` takes each side
 * from the patch's own rename, copy, `---` or `+++` line, which git writes
 * whole; the header's split stands where no such line names that side.
 */
export function parsePatchPaths(patch: string): DiffHeaderPaths | undefined {
  const headerEnd = patch.indexOf("\n");
  const headerLine = headerEnd === -1 ? patch : patch.slice(0, headerEnd);
  const header = readHeaderLine(headerLine);
  const headerLineDecides =
    header === undefined || !header.splitsTwoWays || headerEnd === -1;
  if (headerLineDecides) {
    return header?.paths;
  }

  const bodyStart = headerEnd + 1;
  return {
    pre: findPatchPath(patch, bodyStart, PRE_PATH_LINES) ?? header.paths.pre,
    post: findPatchPath(patch, bodyStart, POST_PATH_LINES) ?? header.paths.post,
  };
}
