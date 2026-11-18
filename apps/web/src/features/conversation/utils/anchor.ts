// GitHub→chunk anchor mapping: the pure inverse of submit.ts's outbound
// old→LEFT / new→RIGHT map, over the same `DiffLine {oldLine?, newLine?}`
// rows `createCommentAnchor` reads.
//
// Placement is a pure function of (thread anchor revision, viewed revision):
// fresh threads land inline at their chunk row; outdated threads are
// digest-only, their coordinates describe the ANCHOR-TIME diff, so no row
// match is ever attempted. Unanchored threads render only in the digest.
import {
  ReviewCommentSides,
  ThreadSubjectTypes,
  type ReviewCommentSide,
  type ThreadSubjectType,
  type ValueOf,
} from "types";

import { rowId } from "@web/features/review/utils";
import { UnknownValues } from "@web/utils/open-enum/types";
import type { BriefChunk } from "../../brief/model";
import type { ConversationThread } from "../types";

export const ThreadPlacementKinds = {
  CHUNK: "chunk",
  FILE_HEADER: "file-header",
  UNANCHORED: "unanchored",
} as const;

export const UnanchoredReasons = {
  OUTDATED: "outdated",
  FILE_NOT_IN_BRIEF: "file-not-in-brief",
  LINE_OUTSIDE_CHUNKS: "line-outside-chunks",
  /** A side or subject type this bundle predates: no row can be trusted. */
  UNKNOWN_ANCHOR: "unknown-anchor",
} as const;
export type UnanchoredReason = ValueOf<typeof UnanchoredReasons>;

export type ThreadPlacement =
  | {
      readonly kind: typeof ThreadPlacementKinds.CHUNK;
      readonly chunkId: string;
      readonly rowId: string;
    }
  | {
      readonly kind: typeof ThreadPlacementKinds.FILE_HEADER;
      readonly chunkId: string;
    }
  | {
      readonly kind: typeof ThreadPlacementKinds.UNANCHORED;
      readonly reason: UnanchoredReason;
    };

export type FileOrChunkPlacement = Extract<
  ThreadPlacement,
  {
    kind:
      | typeof ThreadPlacementKinds.CHUNK
      | typeof ThreadPlacementKinds.FILE_HEADER;
  }
>;

/** LEFT reads old-side numbering and RIGHT new-side: the submit map inverted. */
function lineOfRow(
  row: { oldLine?: number; newLine?: number },
  side: ReviewCommentSide,
): number | undefined {
  const line = side === ReviewCommentSides.LEFT ? row.oldLine : row.newLine;
  return line;
}

type KnownAnchorThread = ConversationThread & {
  readonly side?: ReviewCommentSide;
  readonly startSide?: ReviewCommentSide;
  readonly subjectType: ThreadSubjectType;
};

export function isKnownAnchor(
  thread: ConversationThread,
): thread is KnownAnchorThread {
  const fields = [thread.side, thread.startSide, thread.subjectType];
  return !fields.includes(UnknownValues.UNKNOWN);
}

/**
 * Place one thread against the Brief's chunks (reading order, first match
 * wins). Multi-line threads place by their END line, the line GitHub
 * anchors a range on. A FILE thread with the path
 * in the Brief sits on the file header, never an invented line.
 */
export function placeThread(
  thread: ConversationThread,
  chunks: readonly BriefChunk[],
): ThreadPlacement {
  if (thread.isOutdated) {
    return {
      kind: ThreadPlacementKinds.UNANCHORED,
      reason: UnanchoredReasons.OUTDATED,
    };
  }
  if (!isKnownAnchor(thread)) {
    return {
      kind: ThreadPlacementKinds.UNANCHORED,
      reason: UnanchoredReasons.UNKNOWN_ANCHOR,
    };
  }
  const fileChunks = chunks.filter((chunk) => chunk.file === thread.path);
  if (fileChunks.length === 0) {
    return {
      kind: ThreadPlacementKinds.UNANCHORED,
      reason: UnanchoredReasons.FILE_NOT_IN_BRIEF,
    };
  }
  if (thread.subjectType === ThreadSubjectTypes.FILE) {
    const first = fileChunks[0];
    if (first === undefined) {
      return {
        kind: ThreadPlacementKinds.UNANCHORED,
        reason: UnanchoredReasons.FILE_NOT_IN_BRIEF,
      };
    }
    return { kind: ThreadPlacementKinds.FILE_HEADER, chunkId: first.id };
  }
  if (thread.line === undefined) {
    return {
      kind: ThreadPlacementKinds.UNANCHORED,
      reason: UnanchoredReasons.LINE_OUTSIDE_CHUNKS,
    };
  }
  // GitHub omits `side` on some historical comments; new-side is its default.
  const side: ReviewCommentSide = thread.side ?? ReviewCommentSides.RIGHT;
  for (const chunk of fileChunks) {
    const rows = chunk.diff ?? [];
    for (const [index, row] of rows.entries()) {
      if (row.kind === "hunk" || row.kind === "note") {
        continue;
      }
      if (lineOfRow(row, side) === thread.line) {
        return {
          kind: ThreadPlacementKinds.CHUNK,
          chunkId: chunk.id,
          rowId: rowId(chunk.id, index),
        };
      }
    }
  }
  return {
    kind: ThreadPlacementKinds.UNANCHORED,
    reason: UnanchoredReasons.LINE_OUTSIDE_CHUNKS,
  };
}
