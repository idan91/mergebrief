// GitHub→chunk anchor mapping: the pure inverse of submit.ts's outbound
// old→LEFT / new→RIGHT map, over the same `DiffLine {oldLine?, newLine?}`
// rows `createCommentAnchor` reads.
//
// Placement is a pure function of (thread anchor revision, viewed revision):
// fresh threads land inline at their chunk row; outdated threads are
// digest-only — their coordinates describe the ANCHOR-TIME diff, so no row
// match is ever attempted. Unanchored threads render only in the digest.
import type { BriefChunk } from "../../brief/types";
import { rowId } from "../../review/utils/comments";
import type { ConversationThread, ThreadSide } from "../types";

export type UnanchoredReason =
  | "outdated"
  | "file-not-in-brief"
  | "line-outside-chunks";

export type ThreadPlacement =
  | { readonly kind: "chunk"; readonly chunkId: string; readonly rowId: string }
  | { readonly kind: "unanchored"; readonly reason: UnanchoredReason };

/** LEFT reads old-side numbering, RIGHT new-side — the submit map, inverted. */
function lineOfRow(
  row: { oldLine?: number; newLine?: number },
  side: ThreadSide,
): number | undefined {
  return side === "LEFT" ? row.oldLine : row.newLine;
}

/**
 * Place one thread against the Brief's chunks (reading order — first match
 * wins). Multi-line threads place by their END line, mirroring
 * `mapAnchorToWire` which anchors on `endLine`.
 */
export function placeThread(
  thread: ConversationThread,
  chunks: readonly BriefChunk[],
): ThreadPlacement {
  if (thread.isOutdated) {
    return { kind: "unanchored", reason: "outdated" };
  }
  const fileChunks = chunks.filter((chunk) => chunk.file === thread.path);
  if (fileChunks.length === 0) {
    return { kind: "unanchored", reason: "file-not-in-brief" };
  }
  // File-level threads (and any thread without a line) have no row to match.
  if (thread.line === undefined) {
    return { kind: "unanchored", reason: "line-outside-chunks" };
  }
  // GitHub omits `side` on some historical comments; new-side is its default.
  const side: ThreadSide = thread.side ?? "RIGHT";
  for (const chunk of fileChunks) {
    const rows = chunk.diff ?? [];
    for (const [index, row] of rows.entries()) {
      if (row.kind === "hunk" || row.kind === "note") {
        continue;
      }
      if (lineOfRow(row, side) === thread.line) {
        return {
          kind: "chunk",
          chunkId: chunk.id,
          rowId: rowId(chunk.id, index),
        };
      }
    }
  }
  return { kind: "unanchored", reason: "line-outside-chunks" };
}
