/**
 * Split a unified diff (as produced by `gh pr diff`) into one patch per file.
 * Chunks in the brief reference a `file`; pairing that with these per-file
 * patches lets a UI render the actual diff for any chunk.
 */
export interface FileDiff {
  file: string;
  patch: string;
}

const GIT_HEADER = /^diff --git a\/(.+) b\/(.+)$/;

/** Best-effort path from a `diff --git a/… b/…` line (prefers the new-side path). */
function headerPath(line: string): string {
  const match = GIT_HEADER.exec(line);
  if (match?.[2]) return match[2];
  return line.replace(/^diff --git /, "").trim();
}

export function splitDiffByFile(diff: string): FileDiff[] {
  const segments: FileDiff[] = [];
  let current: { file: string; lines: string[] } | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) {
        segments.push({ file: current.file, patch: current.lines.join("\n") });
      }
      current = { file: headerPath(line), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
    // lines before the first `diff --git` header (if any) are not part of a
    // file patch and are dropped.
  }
  if (current) {
    segments.push({ file: current.file, patch: current.lines.join("\n") });
  }
  return segments;
}
