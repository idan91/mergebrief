import type { IndexedFile, IndexedHunk } from "../diff/hunk-index/types";
import { sanitizeUntrustedDiff } from "./untrusted-text";

/** A file's patch lines in diff order: the header, then each text hunk's header and body. */
export function listPatchLines(file: IndexedFile): string[] {
  const hunkLines = file.hunks.flatMap((hunk) =>
    hunk.header === undefined ? [] : [hunk.header, ...hunk.lines],
  );
  return [...file.headerLines, ...hunkLines];
}

/** The marker text for a file with no text hunk (binary, pure rename, mode change). */
export function describePlaceholder(file: IndexedFile): string {
  if (file.binary) {
    return `(no text hunk: binary file, ${file.status})`;
  }
  return `(no text hunk: ${file.status}, no content change)`;
}

/**
 * The secret redactor reads a diff's own layout (fences on context lines,
 * tokens git cut at a hunk header, whole token lengths), so every file is
 * sanitized as its raw patch before any line is dropped, cut or prefixed.
 * The sanitizer keeps the line count, so the lines map back by position.
 * `headersOnly` drops the bodies first, for a file whose lines no prompt shows.
 */
export function redactIndexedFile(
  file: IndexedFile,
  headersOnly: boolean,
): IndexedFile {
  if (headersOnly) {
    const bare = file.hunks.map((hunk) => ({ ...hunk, lines: [] }));
    return redactIndexedFile({ ...file, hunks: bare }, false);
  }
  const patchLines = listPatchLines(file);
  const sanitized = sanitizeUntrustedDiff(patchLines.join("\n"));
  const lines = sanitized.split("\n");
  if (lines.length !== patchLines.length) {
    throw new Error(`sanitizing ${file.id} changed its line count`);
  }
  let next = file.headerLines.length;
  const hunks = file.hunks.map((hunk): IndexedHunk => {
    if (hunk.header === undefined) {
      return hunk;
    }
    const header = lines[next] ?? hunk.header;
    const body = lines.slice(next + 1, next + 1 + hunk.lines.length);
    next += 1 + hunk.lines.length;
    return { ...hunk, header, lines: body };
  });
  return {
    ...file,
    headerLines: lines.slice(0, file.headerLines.length),
    hunks,
  };
}
