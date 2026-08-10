// Pure assembly of the raw span diff: the live whole-PR diff text for a
// compare baseline → selected head, turned into one read-only chunk per file
// so the EXISTING pipeline renders it. No I/O, no framework imports — the
// toggle component owns the fetch and the render.
import { parseUnifiedDiffPatch, splitUnifiedDiffByFile } from "./diffSlicing";
import type { BriefChunk, DiffLine } from "../types";

/**
 * Patch header lines that carry no information beyond what the file panel
 * already shows — dropped from the metadata fallback below.
 */
const METADATA_NOISE = ["diff --git ", "index ", "--- ", "+++ "];

/**
 * The meaningful file-level metadata lines (mode change, rename, binary
 * marker, new/deleted file) as `note` rows — DiffTable paints those
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
 * Display rows for one file's patch: file-level metadata (everything before
 * the first hunk header) becomes `note` rows, hunks parse through the shared
 * parser. Normalizing INDEPENDENT of hunk presence covers the metadata-only
 * patch (mode/rename/binary/empty file) and the mixed rename-with-edits shape;
 * a plain hunk patch has only noise up front and is unaffected.
 */
function patchDisplayRows(patch: string): DiffLine[] {
  const lines = patch.split("\n");
  const hunkStart = lines.findIndex((line) => line.startsWith("@@"));
  if (hunkStart === -1) {
    const notes = metadataNoteRows(lines);
    // A patch of pure noise lines still changed the file — say so rather
    // than falling into DiffTable's "diff unavailable" copy (wrong here).
    return notes.length > 0
      ? notes
      : [{ kind: "note", content: "File changed without content changes." }];
  }
  return [
    ...metadataNoteRows(lines.slice(0, hunkStart)),
    ...parseUnifiedDiffPatch(lines.slice(hunkStart).join("\n")),
  ];
}

/**
 * Split a whole-PR unified diff into one synthetic `BriefChunk` per file, each
 * carrying that file's parsed display rows. The chunks are for rendering ONLY
 * (read-only raw diff): they claim no added/removed ranges — comment anchoring
 * and comparison overlays are deliberately inert on this view (the Brief above
 * owns commenting). `id` is stable per file so it keys React lists and the
 * DiffTable row ids.
 */
export function buildRawSpanDiffChunks(diff: string): BriefChunk[] {
  const chunks: BriefChunk[] = [];
  for (const [file, patch] of splitUnifiedDiffByFile(diff)) {
    const rows = patchDisplayRows(patch);
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
