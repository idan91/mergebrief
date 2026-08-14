// Client-side handling of the LIVE whole-PR diff. The proxy returns ONE
// unified diff spanning every file (never persisted). Split the body on
// `diff --git` boundaries, then slice each chunk's rows with the shared
// diffSlicing module. A chunk whose file is absent keeps the legal no-`diff`
// shape (the renderer degrades).
import {
  parseUnifiedDiffPatch,
  sliceChunkDiff,
  splitUnifiedDiffByFile,
} from "../../brief/utils/diffSlicing";
import type { Brief } from "../../brief/types";

export { splitUnifiedDiffByFile } from "../../brief/utils/diffSlicing";

/**
 * Attach sliced per-chunk diff rows from the live whole-PR diff. Pure — the
 * input brief is never mutated; an empty diff returns it unchanged.
 */
export function attachLiveDiffs(brief: Brief, diff: string): Brief {
  const files = splitUnifiedDiffByFile(diff);
  if (files.size === 0) return brief;

  const parsedByFile = new Map<
    string,
    ReturnType<typeof parseUnifiedDiffPatch>
  >();
  const rowsFor = (file: string) => {
    const patch = files.get(file);
    if (patch === undefined) return undefined;
    let rows = parsedByFile.get(file);
    if (rows === undefined) {
      rows = parseUnifiedDiffPatch(patch);
      parsedByFile.set(file, rows);
    }
    return rows;
  };
  return {
    ...brief,
    chunks: brief.chunks.map((chunk) => {
      const rows = rowsFor(chunk.file);
      if (rows === undefined) return chunk;
      return { ...chunk, diff: sliceChunkDiff(rows, chunk) };
    }),
    ...(brief.unattributed === undefined
      ? {}
      : {
          unattributed: brief.unattributed.map((entry) => {
            const rows = rowsFor(entry.file);
            if (rows === undefined) return entry;
            return { ...entry, diff: sliceChunkDiff(rows, entry) };
          }),
        }),
  };
}
