import { DiffLineKinds } from "types/diff-lines";
import { DIFF_FILE_HEADER_LEAD, HUNK_HEADER } from "../consts";
import type { DiffHeaderPaths, ParsedDiffLine } from "../types";
import { parseDiffHeaderPaths, parsePatchPaths } from "./header-paths";

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
const NEXT_FILE_HEADER = `\n${DIFF_FILE_HEADER_LEAD}`;

interface OpenFile {
  start: number;
  post: string;
}

/**
 * Split a multi-file unified diff into per-file patch bodies, keyed by the
 * POST-change path (chunks reference files by their new name), the key
 * `splitDiffByFile` gives the same file. Only a line that matches the full
 * header starts a file; a lookalike stays in its file.
 */
export function splitUnifiedDiffByFile(
  diff: string,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  let open: OpenFile | undefined;
  let lineStart = diff.startsWith(DIFF_FILE_HEADER_LEAD)
    ? 0
    : findNextHeaderLine(diff, 0);

  while (lineStart !== -1) {
    const header = matchFileHeader(diff, lineStart);
    if (header !== undefined) {
      if (open !== undefined) {
        storeFile(files, open, diff.slice(open.start, lineStart - 1));
      }
      open = { start: lineStart, post: header.post };
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
): DiffHeaderPaths | undefined {
  const lineEnd = diff.indexOf("\n", lineStart);
  const line = diff.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  return parseDiffHeaderPaths(line);
}

/** A deleted file's header names it on both sides, so its post path is its path too. */
function storeFile(
  files: Map<string, string>,
  open: OpenFile,
  patch: string,
): void {
  files.set((parsePatchPaths(patch) ?? open).post, patch);
}
