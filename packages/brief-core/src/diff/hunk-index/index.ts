import { splitDiffByFile } from "../file-diff";
import { HUNK_HEADER } from "../chunk-layout/consts";
import { decodeGitPath } from "../chunk-layout/logic/header-paths";
import {
  DiffFileStatuses,
  type DiffFileStatus,
  type FileId,
  type HunkId,
  type IndexedFile,
  type IndexedHunk,
} from "./types";

const RENAME_FROM = "rename from ";
const BINARY_MARKERS = ["Binary files ", "GIT binary patch"];

function readStatus(headerLines: readonly string[]): DiffFileStatus {
  if (headerLines.some((line) => line.startsWith("new file mode"))) {
    return DiffFileStatuses.ADDED;
  }
  if (headerLines.some((line) => line.startsWith("deleted file mode"))) {
    return DiffFileStatuses.DELETED;
  }
  if (headerLines.some((line) => line.startsWith(RENAME_FROM))) {
    return DiffFileStatuses.RENAMED;
  }
  return DiffFileStatuses.MODIFIED;
}

function isBinaryHeader(line: string): boolean {
  return BINARY_MARKERS.some((marker) => line.startsWith(marker));
}

function trimTrailingBlankLines(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}

function buildHunk(id: HunkId, header: string, body: string[]): IndexedHunk {
  const lines = trimTrailingBlankLines(body);
  const added = lines.filter((line) => line.startsWith("+")).length;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  return { id, header, lines, added, removed };
}

/** Hunk boundaries follow `HUNK_HEADER`, so hunk `h<m>` is `parsePatchRows`' hunk `m - 1`. */
function splitHunks(
  fileId: FileId,
  hunkLines: readonly string[],
): IndexedHunk[] {
  const hunks: IndexedHunk[] = [];
  let header: string | undefined;
  let body: string[] = [];

  for (const line of hunkLines) {
    if (!HUNK_HEADER.test(line)) {
      body.push(line);
      continue;
    }
    if (header !== undefined) {
      hunks.push(buildHunk(`${fileId}h${hunks.length + 1}`, header, body));
    }
    header = line;
    body = [];
  }
  if (header !== undefined) {
    hunks.push(buildHunk(`${fileId}h${hunks.length + 1}`, header, body));
  }

  if (hunks.length === 0) {
    return [{ id: `${fileId}h1`, lines: [], added: 0, removed: 0 }];
  }
  return hunks;
}

function indexFile(position: number, path: string, patch: string): IndexedFile {
  const id: FileId = `f${position + 1}`;
  const patchLines = patch.split("\n");
  const firstHunk = patchLines.findIndex((line) => HUNK_HEADER.test(line));
  const headerEnd = firstHunk === -1 ? patchLines.length : firstHunk;
  const headerLines = patchLines
    .slice(0, headerEnd)
    .filter((line) => line !== "");

  const hunks = splitHunks(id, patchLines.slice(headerEnd));
  const file: IndexedFile = {
    id,
    path,
    status: readStatus(headerLines),
    binary: headerLines.some(isBinaryHeader),
    headerLines,
    hunks,
    added: hunks.reduce((sum, hunk) => sum + hunk.added, 0),
    removed: hunks.reduce((sum, hunk) => sum + hunk.removed, 0),
  };

  const renameFrom = headerLines.find((line) => line.startsWith(RENAME_FROM));
  if (renameFrom !== undefined) {
    file.previousPath = decodeGitPath(renameFrom.slice(RENAME_FROM.length));
  }
  return file;
}

/**
 * Numbers every file of a unified diff in diff order (`f1`, `f2`, ...) and
 * every hunk within its file (`f1h1`, `f1h2`, ...). A file with no text hunk
 * keeps one placeholder hunk, so every file owns at least one hunk id.
 */
export function indexDiff(diff: string): IndexedFile[] {
  return splitDiffByFile(diff).map((fileDiff, position) =>
    indexFile(position, fileDiff.file, fileDiff.patch),
  );
}
