import { parsePatchPaths } from "./chunk-layout/logic/header-paths";

/**
 * Split a unified diff (as produced by `gh pr diff`) into one patch per file.
 * Chunks in the brief reference a `file`; pairing that with these per-file
 * patches lets a UI render the actual diff for any chunk.
 */
export interface FileDiff {
  file: string;
  patch: string;
}

/** Best-effort path of a file's patch (prefers the new-side path), else its header line's text. */
function readPatchFile(patch: string, headerLine: string): string {
  const post = parsePatchPaths(patch)?.post;
  if (post) {
    return post;
  }
  return headerLine.replace(/^diff --git /, "").trim();
}

function buildFileDiff(lines: readonly string[]): FileDiff {
  const patch = lines.join("\n");
  return { file: readPatchFile(patch, lines[0] ?? ""), patch };
}

export function splitDiffByFile(diff: string): FileDiff[] {
  const segments: FileDiff[] = [];
  let current: string[] | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) {
        segments.push(buildFileDiff(current));
      }
      current = [line];
    } else if (current) {
      current.push(line);
    }
    // lines before the first `diff --git` header (if any) are not part of a
    // file patch and are dropped.
  }
  if (current) {
    segments.push(buildFileDiff(current));
  }
  return segments;
}
