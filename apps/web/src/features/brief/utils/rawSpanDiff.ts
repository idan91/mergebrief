// Pure assembly of the raw span diff: the live whole-PR diff text for a
// compare baseline → selected head, turned into one read-only chunk per file
// so the EXISTING pipeline renders it. No I/O, no framework imports, the
// toggle component owns the fetch and the render.
import type { DiffLine } from "@web/utils/diffTokens/types";
import { parseUnifiedDiffPatch, splitUnifiedDiffByFile } from "./diffSlicing";
import type { BriefChunk } from "../types";
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
    .map((content): DiffLine => ({ kind: "note", content }));
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
      : [{ kind: "note", content: t("brief.diff.noContentChanges") }];
  }
  return [
    ...metadataNoteRows(lines.slice(0, hunkStart)),
    ...parseUnifiedDiffPatch(lines.slice(hunkStart).join("\n")),
  ];
}

/**
 * Split a whole-PR unified diff into one synthetic `BriefChunk` per file, each
 * carrying that file's parsed display rows. Rendering ONLY: they claim no
 * added or removed ranges, so comment anchoring and comparison overlays are
 * inert here. `id` is stable per file so it keys React lists and row ids.
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
      if (row.kind === "add") added += 1;
      else if (row.kind === "del") deleted += 1;
    }
    chunks.push({
      id: `raw:${file}`,
      changeGroupId: "raw-span",
      file,
      concern: "implementation",
      role: "core",
      loc: { added, deleted },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: rows,
    });
  }
  return chunks;
}
