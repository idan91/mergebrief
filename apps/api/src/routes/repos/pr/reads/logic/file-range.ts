// Pure line slicing for the file-range read. The SPLIT blob stays in the
// per-session cache; only the window built here reaches the wire.
import type { FileRangeView } from "contract";
import { RepoFileKinds, type RepoFileResult } from "github";
import type { FileRangeFailure } from "../types";

/** A NUL byte is the git heuristic for a blob no expander can render. */
const NUL_BYTE = "\u0000";

/**
 * Split a decoded blob into lines, ONCE per blob: the cache holds the result,
 * so a second range of the same file never re-splits it. A trailing newline
 * TERMINATES the last line rather than starting an empty one, which is how
 * git counts lines and what the diff's line numbers are anchored to. The
 * split eats `\r`, so a CRLF file renders no stray carriage return.
 */
export function splitFileLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

export interface FileRangeRequest {
  readonly path: string;
  readonly ref: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Slice `[from, to]`, 1-based inclusive, clamping BOTH ends to the file so
 * `lines.length` is always `to - from + 1`. A window starting past the end
 * serves none, reported as the empty range `from = totalLines + 1`,
 * `to = totalLines`, rather than failing: the caller asked for a window a
 * shorter file simply does not have.
 */
export function sliceFileRange(
  lines: readonly string[],
  request: FileRangeRequest,
): FileRangeView {
  const totalLines = lines.length;
  const from = Math.min(request.from, totalLines + 1);
  const to = Math.min(request.to, totalLines);

  return {
    path: request.path,
    ref: request.ref,
    from,
    to,
    lines: lines.slice(from - 1, to),
    totalLines,
  };
}

/**
 * The failure a fetched blob is, or `undefined` when it is servable text. A
 * NUL byte is valid UTF-8, so `getRepoFile`'s strict decode hands it through.
 */
export function classifyRepoFile(
  file: RepoFileResult,
): FileRangeFailure | undefined {
  if (file.kind === RepoFileKinds.ABSENT) {
    return { kind: "file-absent" };
  }
  if (file.kind === RepoFileKinds.TOO_LARGE) {
    return { kind: "file-too-large" };
  }
  if (file.content.includes(NUL_BYTE)) {
    return { kind: "file-not-text" };
  }
  return undefined;
}
