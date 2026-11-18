import {
  GIT_CHAR_ESCAPES,
  GIT_QUOTE,
  OCTAL_RADIX,
  POST_SIDE_PREFIX,
  PRE_SIDE_PREFIX,
} from "../../chunk-layout/consts";
import type { ModeChange } from "../types";

const DEV_NULL = "/dev/null";
const OCTAL_ESCAPE_DIGITS = 3;
const LAST_ASCII_CODE = 0x7f;
const FIRST_PRINTABLE_CODE = 0x20;

const ESCAPE_ENTRIES = Object.entries(GIT_CHAR_ESCAPES);

/** Characters git's C-quoting writes as a backslash and this letter. */
const LETTER_ESCAPES = new Map(
  ESCAPE_ENTRIES.map(([letter, char]) => [char, letter]),
);

const UTF8_ENCODER = new TextEncoder();

function needsQuoting(path: string): boolean {
  for (const char of path) {
    const code = char.codePointAt(0) ?? 0;
    const isControl = code < FIRST_PRINTABLE_CODE || code === LAST_ASCII_CODE;
    if (
      isControl ||
      code > LAST_ASCII_CODE ||
      char === GIT_QUOTE ||
      char === "\\"
    ) {
      return true;
    }
  }
  return false;
}

function escapeGitChar(char: string): string {
  const letter = LETTER_ESCAPES.get(char);
  if (letter !== undefined) {
    return `\\${letter}`;
  }
  if (char === GIT_QUOTE || char === "\\") {
    return `\\${char}`;
  }
  const code = char.codePointAt(0) ?? 0;
  const printable = code >= FIRST_PRINTABLE_CODE && code < LAST_ASCII_CODE;
  if (printable) {
    return char;
  }
  return Array.from(UTF8_ENCODER.encode(char), (byte) => {
    const octal = byte.toString(OCTAL_RADIX);
    return `\\${octal.padStart(OCTAL_ESCAPE_DIGITS, "0")}`;
  }).join("");
}

/** A path as git prints it after `side`: C-quoted when it holds a quote, backslash, control or non-ASCII character. */
export function formatGitPath(side: string, path: string): string {
  const spelled = `${side}${path}`;
  if (!needsQuoting(spelled)) {
    return spelled;
  }
  const escaped = Array.from(spelled, escapeGitChar).join("");
  return `${GIT_QUOTE}${escaped}${GIT_QUOTE}`;
}

/** A `---` or `+++` line's path, with git's TAB trailer when an unquoted path holds a space. */
function formatFileLinePath(side: string, path: string | undefined): string {
  if (path === undefined) {
    return DEV_NULL;
  }
  const spelled = formatGitPath(side, path);
  return spelled.includes(" ") ? `${spelled}\t` : spelled;
}

export interface BetweenHeadsHeader {
  readonly prevPath: string;
  readonly path: string;
  /** False when the file does not exist at that head. */
  readonly existsAtPrev: boolean;
  readonly existsAtNew: boolean;
  readonly modeChange?: ModeChange | undefined;
  /** Each head's mode, named when the file is created or deleted between heads. */
  readonly prevMode?: string | undefined;
  readonly newMode?: string | undefined;
}

function formatExistenceLines(file: BetweenHeadsHeader): string[] {
  if (!file.existsAtNew && file.prevMode !== undefined) {
    return [`deleted file mode ${file.prevMode}`];
  }
  if (!file.existsAtPrev && file.newMode !== undefined) {
    return [`new file mode ${file.newMode}`];
  }
  return [];
}

/** The path the `diff --git` line names on each side: a file one head lacks is created or deleted, not renamed. */
function readHeaderPaths(file: BetweenHeadsHeader): readonly [string, string] {
  if (!file.existsAtPrev) {
    return [file.path, file.path];
  }
  if (!file.existsAtNew) {
    return [file.prevPath, file.prevPath];
  }
  return [file.prevPath, file.path];
}

/** The `diff --git` line plus the mode, existence and rename lines the change needs, in git's order. */
export function formatDiffHeader(file: BetweenHeadsHeader): string[] {
  const [prePath, postPath] = readHeaderPaths(file);
  const preSide = formatGitPath(PRE_SIDE_PREFIX, prePath);
  const postSide = formatGitPath(POST_SIDE_PREFIX, postPath);
  const lines = [`diff --git ${preSide} ${postSide}`];
  if (file.modeChange !== undefined) {
    lines.push(
      `old mode ${file.modeChange.prevMode}`,
      `new mode ${file.modeChange.newMode}`,
    );
  }
  lines.push(...formatExistenceLines(file));
  if (prePath !== postPath) {
    lines.push(`rename from ${formatGitPath("", prePath)}`);
    lines.push(`rename to ${formatGitPath("", postPath)}`);
  }
  return lines;
}

/** The `---` and `+++` lines, `/dev/null` for a side the file is absent on. */
export function formatFileLines(file: BetweenHeadsHeader): string[] {
  const [prePath, postPath] = readHeaderPaths(file);
  const prevPath = file.existsAtPrev ? prePath : undefined;
  const newPath = file.existsAtNew ? postPath : undefined;
  return [
    `--- ${formatFileLinePath(PRE_SIDE_PREFIX, prevPath)}`,
    `+++ ${formatFileLinePath(POST_SIDE_PREFIX, newPath)}`,
  ];
}
