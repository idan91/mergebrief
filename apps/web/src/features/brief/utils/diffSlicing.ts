// Pure unified-diff parsing + per-chunk slicing, on the client for both the
// local sidecar patches and the live proxied diff. No I/O, no framework
// imports; keep it that way.
import type { LineRange } from "brief-core/types";
import { type DiffLine, DiffRowOrigins } from "@web/utils/diffTokens/types";
import type { Brief, BriefChunk } from "../types";
import type { FileRowsCache } from "./fileRows";

/**
 * Slice a file's parsed diff down to the rows a chunk claims: changed rows
 * inside the chunk's added/removed ranges, each with ±2 rows of surrounding
 * context and its governing hunk header. Rows outside every range are
 * dropped; an empty result means the chunk's ranges matched nothing.
 */
export function sliceChunkDiff(
  rows: DiffLine[],
  chunk: Pick<BriefChunk, "addedRanges" | "removedRanges">,
): DiffLine[] {
  const changedRows = rows.filter((row) => {
    if (row.kind === "add") {
      return lineInRanges(row.newLine, chunk.addedRanges);
    }
    if (row.kind === "del") {
      return lineInRanges(row.oldLine, chunk.removedRanges);
    }
    return false;
  });
  if (changedRows.length === 0) {
    return [];
  }

  const selected = new Set<DiffLine>();
  for (const changedRow of changedRows) {
    const index = rows.indexOf(changedRow);
    let hunkIndex = index;
    while (hunkIndex >= 0 && rows[hunkIndex]?.kind !== "hunk") {
      hunkIndex -= 1;
    }
    if (hunkIndex >= 0) {
      const hunk = rows[hunkIndex];
      if (hunk) {
        selected.add(hunk);
      }
    }
    for (let offset = -2; offset <= 2; offset += 1) {
      const row = rows[index + offset];
      if (
        row &&
        (row.kind === "ctx" ||
          row.kind === "add" ||
          row.kind === "del" ||
          row.kind === "note")
      ) {
        selected.add(row);
      }
    }
  }

  return rows.filter((row) => selected.has(row));
}

/**
 * The brief with each chunk's rows sliced from its file. Pure: a brief whose
 * files the cache does not hold comes back as the same object.
 */
export function attachSlicedDiffs(
  brief: Brief,
  fileRows: FileRowsCache,
): Brief {
  if (fileRows.isEmpty) {
    return brief;
  }

  const withDiffs: Brief = {
    ...brief,
    chunks: brief.chunks.map((chunk) => {
      const rows = fileRows.getFileRows(chunk.file);
      if (rows === undefined) {
        return chunk;
      }
      return { ...chunk, diff: sliceChunkDiff(rows, chunk) };
    }),
  };

  if (brief.unattributed !== undefined) {
    withDiffs.unattributed = brief.unattributed.map((entry) => {
      const rows = fileRows.getFileRows(entry.file);
      if (rows === undefined) {
        return entry;
      }
      return { ...entry, diff: sliceChunkDiff(rows, entry) };
    });
  }

  return withDiffs;
}

/**
 * The delta with every chunk's and remainder entry's rows sliced from the
 * span diff, baseline to head, and tagged as guest rows: a guest row's new
 * line is head's and its old line is the baseline's, so a del row has no
 * line at head and the guest resolver refuses a comment on it. Pure: a
 * delta whose files the cache does not hold comes back as the same object.
 */
export function attachSpanDiffs(delta: Brief, spanRows: FileRowsCache): Brief {
  const attached = attachSlicedDiffs(delta, spanRows);
  if (attached === delta) {
    return delta;
  }

  const asGuest: Brief = {
    ...attached,
    chunks: attached.chunks.map(tagGuestRows),
  };
  if (attached.unattributed !== undefined) {
    asGuest.unattributed = attached.unattributed.map(tagGuestRows);
  }

  return asGuest;
}

function tagGuestRows<Entry extends { diff?: DiffLine[] }>(
  entry: Entry,
): Entry {
  if (entry.diff === undefined) {
    return entry;
  }

  return { ...entry, diff: entry.diff.map(toGuestRow) };
}

function toGuestRow(row: DiffLine): DiffLine {
  return { ...row, origin: DiffRowOrigins.GUEST };
}

function lineInRanges(line: number | undefined, ranges: LineRange[]): boolean {
  return (
    typeof line === "number" &&
    ranges.some((range) => line >= range.start && line <= range.end)
  );
}

/**
 * Parse a unified-diff patch body into display rows with old/new line
 * numbers. File-level headers are dropped; hunk headers, adds, dels, context
 * and `\ No newline` notes are kept.
 */
export function parseUnifiedDiffPatch(patch: string): DiffLine[] {
  const rows: DiffLine[] = [];
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
      rows.push({ kind: "hunk", content: line });
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      rows.push({ kind: "note", content: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", content: line.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", content: line.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    rows.push({
      kind: "ctx",
      content: line.startsWith(" ") ? line.slice(1) : line,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return rows;
}

function parseHunkLine(line: string): { oldStart: number; newStart: number } {
  const match =
    /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/.exec(line);
  return {
    oldStart: Number(match?.groups?.["oldStart"] ?? 0),
    newStart: Number(match?.groups?.["newStart"] ?? 0),
  };
}

const DIFF_HEADER = /^diff --git a\/(?<pre>.+?) b\/(?<post>.+)$/;

/**
 * Split a multi-file unified diff into per-file patch bodies, keyed by the
 * POST-change path (chunks reference files by their new name); a deleted
 * file (post side `/dev/null`) keys by its pre-change path. Pure; a sibling
 * of `parseUnifiedDiffPatch`: the two together turn a whole-PR diff into
 * per-file display rows.
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
    const header = DIFF_HEADER.exec(line);
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
