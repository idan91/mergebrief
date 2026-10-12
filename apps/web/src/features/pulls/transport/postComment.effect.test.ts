// Post-now success effect: posting a staged draft must reduce the
// unposted-draft count the soft gate reminds on, and record the wrapping review
// id so the refetched thread reconciles as "yours".
//
// This drives the REAL Review Session store through the exact action sequence
// the own-draft `postDraftComment` handler applies on a `posted` result, and
// asserts against the SAME `status === DraftCommentStatuses.DRAFT` predicate
// the MarkReadyModal counts by, the store-level contract post-now depends on,
// not a re-test of a single action in isolation.
import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { buildBriefViewModel } from "@web/features/brief/model";
import {
  type CommentAnchor,
  type ReviewComment,
} from "@web/features/review/utils";
import {
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";
import {
  createReviewSessionStore,
  deriveInitialState,
} from "../../review/session";

function store() {
  return createReviewSessionStore(
    deriveInitialState(buildBriefViewModel(briefFixture)),
  );
}

/** The MarkReadyModal's unposted-draft count (BriefPage.unpostedDraftComments). */
function unpostedDraftCount(comments: readonly ReviewComment[]): number {
  return comments.filter(
    (comment) => comment.status === DraftCommentStatuses.DRAFT,
  ).length;
}

const ANCHOR: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: DiffSides.NEW,
  startLine: 3,
  endLine: 3,
  rowIds: ["chunk-a:0"],
  selectedText: "x",
};

describe("post-now success effect on the Review Session store", () => {
  it("drops the unposted-draft count and records the review id", () => {
    const s = store();
    const { actions } = s.getState();
    void actions.saveComment({
      anchor: ANCHOR,
      body: "post me now",
      status: DraftCommentStatuses.DRAFT,
      collapsed: false,
    });

    // Staged: counted by the soft gate's unposted-drafts reminder.
    expect(unpostedDraftCount(s.getState().reviewComments)).toBe(1);
    const draft = s.getState().reviewComments[0];
    if (draft === undefined) {
      throw new Error("unreachable");
    }

    // Exactly what the post-now handler applies on a `posted` result.
    actions.markCommentsSubmitted([draft.id]);
    actions.recordSubmittedReview(555);

    // Count drops, the draft is now server-owned, not unposted.
    expect(unpostedDraftCount(s.getState().reviewComments)).toBe(0);
    // The comment is retained as a submitted (read-only) record, not deleted.
    expect(s.getState().reviewComments[0]?.status).toBe("submitted");
    // The wrapping review id is recorded, the "yours" reconciliation join key.
    expect(s.getState().submittedReviewIds).toContain(555);
  });

  it("only clears the posted draft, other staged drafts still count", () => {
    const s = store();
    const { actions } = s.getState();
    void actions.saveComment({
      anchor: ANCHOR,
      body: "first",
      status: DraftCommentStatuses.DRAFT,
      collapsed: false,
    });
    void actions.saveComment({
      anchor: { ...ANCHOR, startLine: 9, endLine: 9, rowIds: ["chunk-a:6"] },
      body: "second",
      status: DraftCommentStatuses.DRAFT,
      collapsed: false,
    });
    expect(unpostedDraftCount(s.getState().reviewComments)).toBe(2);

    const first = s.getState().reviewComments[0];
    if (first === undefined) {
      throw new Error("unreachable");
    }
    actions.markCommentsSubmitted([first.id]);

    // Exactly one draft cleared; the other still reminds the author.
    expect(unpostedDraftCount(s.getState().reviewComments)).toBe(1);
  });
});
