// Pure assembly of the span diff: the live diff text for a compare baseline
// to selected head, turned into one chunk per file whose rows are all guest
// rows. No I/O, no framework imports, the toggle component owns the fetch
// and the render.
import { Concerns, Roles } from "brief-core/types";
import { type DiffLine, DiffRowOrigins } from "@web/utils/diffTokens/types";
import {
  parseUnifiedDiffPatch,
  splitUnifiedDiffByFile,
} from "brief-core/chunk-layout";
import { type BriefChunk, GuestHostPrefixes } from "../types";
import type { TFunction } from "i18next";

/**
 * Patch header lines that carry no information beyond what the file panel
 * already shows, dropped from the metadata fallback below.
 */
const METADATA_NOISE = ["diff --git ", "index ", "--- ", "+++ "];

/**
 * The meaningful file-level metadata lines (mode change, rename, binary
 * marker, new/deleted file) as `note` rows, DiffTable paints those
 * full-width, no line numbers. `parseUnifiedDiffPatch` would otherwise
 * mislabel them as context rows with meaningless 0-based line numbers.
 */
function metadataNoteRows(lines: string[]): DiffLine[] {
  return lines
    .filter(
      (line) =>
        line.length > 0 &&
        !METADATA_NOISE.some((prefix) => line.startsWith(prefix)),
    )
    .map(
      (content): DiffLine => ({
        kind: "note",
        content,
        origin: DiffRowOrigins.GUEST,
      }),
    );
}

/**
 * Display rows for one file's patch: file-level metadata before the first hunk
 * header becomes `note` rows, and hunks parse through the shared parser.
 * Normalizing INDEPENDENT of hunk presence covers the metadata-only and
 * rename-with-edits shapes; a plain hunk patch has only noise up front.
 */
function patchDisplayRows(t: TFunction, patch: string): DiffLine[] {
  const lines = patch.split("\n");
  const hunkStart = lines.findIndex((line) => line.startsWith("@@"));
  if (hunkStart === -1) {
    const notes = metadataNoteRows(lines);
    // A patch of pure noise lines still changed the file, say so rather
    // than falling into DiffTable's "diff unavailable" copy (wrong here).
    return notes.length > 0
      ? notes
      : [
          {
            kind: "note",
            content: t("brief.diff.noContentChanges"),
            origin: DiffRowOrigins.GUEST,
          },
        ];
  }
  const hunkRows = parseUnifiedDiffPatch(lines.slice(hunkStart).join("\n"));
  return [
    ...metadataNoteRows(lines.slice(0, hunkStart)),
    ...hunkRows.map((row) => ({ ...row, origin: DiffRowOrigins.GUEST })),
  ];
}

/**
 * Split a span diff into one synthetic `BriefChunk` per file, each carrying
 * that file's rows as guest rows: a comment on one anchors to the full
 * brief's chunk that owns the line, never to this chunk, which claims no
 * ranges. `id` is stable per file so it keys React lists and row ids.
 */
export function buildRawSpanDiffChunks(
  t: TFunction,
  diff: string,
): BriefChunk[] {
  const chunks: BriefChunk[] = [];
  for (const [file, patch] of splitUnifiedDiffByFile(diff)) {
    const rows = patchDisplayRows(t, patch);
    let added = 0;
    let deleted = 0;
    for (const row of rows) {
      if (row.kind === "add") {
        added += 1;
      } else if (row.kind === "del") {
        deleted += 1;
      }
    }
    chunks.push({
      id: `${GuestHostPrefixes.RAW}${file}`,
      changeGroupId: "raw-span",
      file,
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
      loc: { added, deleted },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: rows,
    });
  }
  return chunks;
}
