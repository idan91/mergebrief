// Client-side handling of the LIVE whole-PR diff (BRIEF-19 PR 3.2). The diff
// proxy returns ONE unified diff spanning every file (never persisted —
// ADR 0016 #10); the local path's sidecars were already per-file. Split the
// body on `diff --git` boundaries, then slice each chunk's rows with the
// shared diffSlicing module. A chunk whose file is absent keeps the legal
// no-`diff` shape (the renderer degrades).
import { parseUnifiedDiffPatch, sliceChunkDiff } from "../brief/diffSlicing";
import type { Brief } from "../brief/types";

const DIFF_HEADER = /^diff --git a\/(?<pre>.+?) b\/(?<post>.+)$/;

/**
 * Split a multi-file unified diff into per-file patch bodies, keyed by the
 * POST-change path (chunks reference files by their new name); a deleted
 * file (post side `/dev/null`) keys by its pre-change path.
 */
export function splitUnifiedDiffByFile(
  diff: string,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  if (diff.length === 0) return files;

  let currentKey: string | undefined;
  let currentLines: string[] = [];
  let sawDevNullPost = false;
  let pendingPrePath: string | undefined;

  const flush = (): void => {
    if (currentKey !== undefined) {
      // Deleted file: the post path in the `diff --git` header is the same as
      // the pre path, but `+++ /dev/null` marks it — keep the pre path key.
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
