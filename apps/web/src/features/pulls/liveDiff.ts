// Client-side handling of the LIVE whole-PR diff (BRIEF-19 PR 3.2). The diff
// proxy returns ONE unified diff spanning every file (never persisted —
// ADR 0016 #10); the local path's sidecars were already per-file. Split the
// body on `diff --git` boundaries, then slice each chunk's rows with the
// shared diffSlicing module. A chunk whose file is absent keeps the legal
// no-`diff` shape (the renderer degrades).
import {
  parseUnifiedDiffPatch,
  sliceChunkDiff,
  splitUnifiedDiffByFile,
} from "../brief/utils/diffSlicing";
import type { Brief } from "../brief/types";

// `splitUnifiedDiffByFile` now lives in the shared pure diff module alongside
// `parseUnifiedDiffPatch` — re-exported here so existing importers are
// unchanged.
export { splitUnifiedDiffByFile } from "../brief/utils/diffSlicing";

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
  return {
    ...brief,
    chunks: brief.chunks.map((chunk) => {
      const patch = files.get(chunk.file);
      if (patch === undefined) return chunk;
      let rows = parsedByFile.get(chunk.file);
      if (rows === undefined) {
        rows = parseUnifiedDiffPatch(patch);
        parsedByFile.set(chunk.file, rows);
      }
      return { ...chunk, diff: sliceChunkDiff(rows, chunk) };
    }),
  };
}
