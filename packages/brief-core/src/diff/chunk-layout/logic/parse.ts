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

/**
 * Split a multi-file unified diff into per-file patch bodies, keyed by the
 * POST-change path (chunks reference files by their new name); a deleted
 * file (post side `/dev/null`) keys by its pre-change path.
 */
export function splitUnifiedDiffByFile(
  diff: string,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  if (diff.length === 0) {
    return files;
  }

  let currentKey: string | undefined;
  let currentLines: string[] = [];
  let sawDevNullPost = false;
  let pendingPrePath: string | undefined;

  const flush = (): void => {
    if (currentKey !== undefined) {
      // Deleted file: the post path in the `diff --git` header is the same as
      // the pre path, but `+++ /dev/null` marks it; keep the pre path key.
      const key =
        sawDevNullPost && pendingPrePath !== undefined
          ? pendingPrePath
          : currentKey;
      files.set(key, currentLines.join("\n"));
    }
    currentLines = [];
    sawDevNullPost = false;
  };

  for (const line of diff.split("\n")) {
    const header = DIFF_FILE_HEADER.exec(line);
    if (header?.groups) {
      flush();
      currentKey = header.groups["post"];
      pendingPrePath = header.groups["pre"];
    }
    if (currentKey !== undefined) {
      if (line.startsWith("+++ /dev/null")) {
        sawDevNullPost = true;
      }
      currentLines.push(line);
    }
  }
  flush();
  return files;
}
