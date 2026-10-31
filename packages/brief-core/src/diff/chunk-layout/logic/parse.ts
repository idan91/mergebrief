import { DiffLineKinds } from "types/diff-lines";
import { DIFF_FILE_HEADER, HUNK_HEADER } from "../consts";
import type { ParsedDiffLine } from "../types";

interface HunkStarts {
  oldStart: number;
  newStart: number;
}

/**
 * Parse a unified-diff patch body into display rows with old/new line
 * numbers. File-level headers are dropped; hunk headers, adds, dels, context
 * and `\ No newline` notes are kept.
 */
export function parseUnifiedDiffPatch(patch: string): ParsedDiffLine[] {
  const rows: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  // A patch ends with a newline, so the split leaves one empty string behind
  // the last row; read as a line it would become a context row past the hunk.
  const lines = patch.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  // Git writes any number of header lines before a file's first hunk
  // (rename, mode, similarity, binary); none of them is content.
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      const parsedHunk = parseHunkLine(line);
      oldLine = parsedHunk.oldStart;
      newLine = parsedHunk.newStart;
      rows.push({ kind: DiffLineKinds.HUNK, content: line });
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      rows.push({ kind: DiffLineKinds.NOTE, content: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: DiffLineKinds.ADD, content: line.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: DiffLineKinds.DEL, content: line.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    rows.push({
      kind: DiffLineKinds.CTX,
      content: line.startsWith(" ") ? line.slice(1) : line,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return rows;
}

function parseHunkLine(line: string): HunkStarts {
  const match = HUNK_HEADER.exec(line);
  return {
    oldStart: Number(match?.groups?.["oldStart"] ?? 0),
    newStart: Number(match?.groups?.["newStart"] ?? 0),
  };
}

/** Where a file header can start: a line start, so every later one follows a newline. */
const FILE_HEADER_START = "diff --git ";
const NEXT_FILE_HEADER = `\n${FILE_HEADER_START}`;
const DELETED_POST_LINE = "\n+++ /dev/null";

interface OpenFile {
  start: number;
  pre: string;
  post: string;
}

/**
 * Split a multi-file unified diff into per-file patch bodies, keyed by the
 * POST-change path (chunks reference files by their new name); a deleted
 * file (post side `/dev/null`) keys by its pre-change path. Only a line that
 * matches the full header starts a file; a lookalike stays in its file.
 */
export function splitUnifiedDiffByFile(
  diff: string,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  let open: OpenFile | undefined;
  let lineStart = diff.startsWith(FILE_HEADER_START)
    ? 0
    : findNextHeaderLine(diff, 0);

  while (lineStart !== -1) {
    const header = matchFileHeader(diff, lineStart);
    if (header !== undefined) {
      if (open !== undefined) {
        storeFile(files, open, diff.slice(open.start, lineStart - 1));
      }
      open = { start: lineStart, pre: header.pre, post: header.post };
    }
    lineStart = findNextHeaderLine(diff, lineStart);
  }

  if (open !== undefined) {
    storeFile(files, open, diff.slice(open.start));
  }
  return files;
}

function findNextHeaderLine(diff: string, from: number): number {
  const newline = diff.indexOf(NEXT_FILE_HEADER, from);
  return newline === -1 ? -1 : newline + 1;
}

function matchFileHeader(
  diff: string,
  lineStart: number,
): { pre: string; post: string } | undefined {
  const lineEnd = diff.indexOf("\n", lineStart);
  const line = diff.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const groups = DIFF_FILE_HEADER.exec(line)?.groups;
  const pre = groups?.["pre"];
  const post = groups?.["post"];
  if (pre === undefined || post === undefined) {
    return undefined;
  }
  return { pre, post };
}

/** Deleted file: the header's post path equals the pre path, but `+++ /dev/null` marks it. */
function storeFile(
  files: Map<string, string>,
  open: OpenFile,
  patch: string,
): void {
  const key = patch.includes(DELETED_POST_LINE) ? open.pre : open.post;
  files.set(key, patch);
}
