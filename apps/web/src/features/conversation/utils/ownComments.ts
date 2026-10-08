// Own-comment reconciliation: server-backed wins, exact join on review id.
// Fetched threads whose ROOT comment carries a recorded submit id are the
// reviewer's own. Per-comment linkage joins on (path, line, side) with a body
// tiebreak, collision worst case is display-level only. A local DRAFT
// matching an own server thread is reported for flipping, so a missed
// sessionStorage flip can never re-ship posted comments.
import {
  ReviewCommentStatuses,
  isLineCommentAnchor,
  type ReviewComment,
} from "@web/features/review/utils";
import {
  ThreadSides,
  ThreadSubjectTypes,
  type ConversationThread,
  type ThreadSide,
} from "../types";
import { DiffSides, type DiffSide } from "types/comments";

export interface OwnCommentReconciliation {
  /** Root comment ids of threads created by this reviewer's recorded submits. */
  readonly ownThreadIds: ReadonlySet<number>;
  /** The recorded submit ids themselves, the per-comment "yours" join. */
  readonly ownReviewIds: ReadonlySet<number>;
  /**
   * Local comment id → own thread root id. The local record demotes to this
   * pointer after the first refetch: the server thread renders, the pointer
   * keeps disposition/evidence links working.
   */
  readonly pointers: ReadonlyMap<string, number>;
  /**
   * Local DRAFTS that matched an own server thread, posted on GitHub but
   * never flipped locally (navigate-away mid-submit). The caller flips them
   * to `submitted` so they never re-ship.
   */
  readonly resurrectedDraftIds: readonly string[];
}

const LOCAL_SIDE_TO_WIRE: Record<DiffSide, ThreadSide> = {
  [DiffSides.OLD]: ThreadSides.LEFT,
  [DiffSides.NEW]: ThreadSides.RIGHT,
};

function anchorMatchesThread(
  comment: ReviewComment,
  thread: ConversationThread,
): boolean {
  if (!isLineCommentAnchor(comment.anchor)) {
    return (
      comment.anchor.file === thread.path &&
      thread.subjectType === ThreadSubjectTypes.FILE &&
      thread.line === undefined
    );
  }
  return (
    comment.anchor.file === thread.path &&
    thread.subjectType === ThreadSubjectTypes.LINE &&
    thread.line !== undefined &&
    // The outbound map anchors on endLine; the thread's line IS that anchor.
    comment.anchor.endLine === thread.line &&
    // Exact side join, our submits always send side, so a side-less thread
    // never matches; defaulting here could false-flip a draft.
    thread.side !== undefined &&
    LOCAL_SIDE_TO_WIRE[comment.anchor.side] === thread.side
  );
}

/** Reconcile local session comments against the fetched conversation. */
export function reconcileOwnComments(
  localComments: readonly ReviewComment[],
  threads: readonly ConversationThread[],
  submittedReviewIds: readonly number[],
): OwnCommentReconciliation {
  const recorded = new Set(submittedReviewIds);
  const ownThreads = threads.filter((thread) => {
    const rootReview = thread.comments[0]?.reviewId;
    return rootReview !== undefined && recorded.has(rootReview);
  });
  const ownThreadIds = new Set(
    ownThreads.map((thread) => thread.rootCommentId),
  );

  const pointers = matchLocalsToOwnThreads(localComments, ownThreads);
  const resurrectedDraftIds = localComments
    .filter(
      (comment) =>
        comment.status === ReviewCommentStatuses.DRAFT &&
        pointers.has(comment.id),
    )
    .map((comment) => comment.id);

  return {
    ownThreadIds,
    ownReviewIds: recorded,
    pointers,
    resurrectedDraftIds,
  };
}

/**
 * The two-pass claim shared by reconciliation and display demotion.
 * PASS 1, exact (anchor AND body) matches claim first, globally: an earlier
 * local's anchor-only fallback must never steal a thread whose body exactly
 * matches a later local, or the stolen draft never flips and can re-ship.
 * PASS 2, anchor-only fallback over what remains.
 */
function matchLocalsToOwnThreads(
  localComments: readonly ReviewComment[],
  ownThreads: readonly ConversationThread[],
): Map<string, number> {
  const pointers = new Map<string, number>();
  const claimedThreads = new Set<number>();

  for (const comment of localComments) {
    const exact = ownThreads.find(
      (thread) =>
        !claimedThreads.has(thread.rootCommentId) &&
        anchorMatchesThread(comment, thread) &&
        thread.comments[0]?.body === comment.body,
    );
    if (exact !== undefined) {
      claimedThreads.add(exact.rootCommentId);
      pointers.set(comment.id, exact.rootCommentId);
    }
  }

  for (const comment of localComments) {
    if (pointers.has(comment.id)) {
      continue;
    }
    const fallback = ownThreads.find(
      (thread) =>
        !claimedThreads.has(thread.rootCommentId) &&
        anchorMatchesThread(comment, thread),
    );
    if (fallback !== undefined) {
      claimedThreads.add(fallback.rootCommentId);
      pointers.set(comment.id, fallback.rootCommentId);
    }
  }

  return pointers;
}

/**
 * Local SUBMITTED records whose own server thread already renders at the same
 * anchor, the server copy wins and the local card demotes out of display.
 * Drafts never demote: they are not on GitHub yet, and with the conversation
 * not loaded the caller passes no threads, so local cards keep rendering as
 * the only copy.
 */
export function demotedSubmittedCommentIds(
  localComments: readonly ReviewComment[],
  ownThreads: readonly ConversationThread[],
): ReadonlySet<string> {
  const submitted = localComments.filter(
    (comment) => comment.status === ReviewCommentStatuses.SUBMITTED,
  );
  return new Set(matchLocalsToOwnThreads(submitted, ownThreads).keys());
}
