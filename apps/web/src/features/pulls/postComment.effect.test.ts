// Post-now success effect (BRIEF-43 PR 4, ADR 0031 #5): posting a staged draft
// must reduce the unposted-draft count the soft gate reminds on, and record the
// wrapping review id so the refetched thread reconciles as "yours" (BRIEF-25).
//
// This drives the REAL Mind-Map store through the exact action sequence the
// own-draft `postDraftComment` handler applies on a `posted` result
// (`markCommentsSubmitted` + `recordSubmittedReview`), and asserts the outcome
// against the SAME `status === "draft"` predicate the MarkReadyModal counts by
// (`BriefPage.unpostedDraftComments`). It is the store-level contract post-now
// depends on — not a re-test of a single action in isolation.
import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/utils/fixtures";
import { buildBriefViewModel } from "@web/features/brief/utils";
import type { CommentAnchor, ReviewComment } from "../review/comments";
import { createMindMapStore, deriveInitialState } from "../review/session";

function store() {
  return createMindMapStore(
    deriveInitialState(buildBriefViewModel(briefFixture)),
  );
}

/** The MarkReadyModal's unposted-draft count (BriefPage.unpostedDraftComments). */
function unpostedDraftCount(comments: readonly ReviewComment[]): number {
  return comments.filter((comment) => comment.status === "draft").length;
}

const ANCHOR: CommentAnchor = {
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: "new",
  startLine: 3,
  endLine: 3,
  rowIds: ["chunk-a:0"],
  selectedText: "x",
};

describe("post-now success effect on the Mind-Map store", () => {
  it("drops the unposted-draft count and records the review id on a posted comment", () => {
    const s = store();
    const { actions } = s.getState();
    actions.saveComment({
      anchor: ANCHOR,
      body: "post me now",
      status: "draft",
      collapsed: false,
    });

    // Staged: counted by the soft gate's unposted-drafts reminder.
    expect(unpostedDraftCount(s.getState().reviewComments)).toBe(1);
    const draft = s.getState().reviewComments[0];
    if (draft === undefined) throw new Error("unreachable");

    // Exactly what `applySettledPosts` drains into the live store on settle.
    actions.markCommentsSubmitted([draft.id]);
    actions.recordSubmittedReview(555);

    // Count drops (ADR 0031 #5) — the draft is now server-owned, not unposted.
    expect(unpostedDraftCount(s.getState().reviewComments)).toBe(0);
    // The comment is retained as a submitted (read-only) record, not deleted.
    expect(s.getState().reviewComments[0]?.status).toBe("submitted");
    // The wrapping review id is recorded — the "yours" reconciliation join key.
    expect(s.getState().submittedReviewIds).toContain(555);
  });

  it("only clears the posted draft — other staged drafts still count", () => {
    const s = store();
    const { actions } = s.getState();
    actions.saveComment({
      anchor: ANCHOR,
      body: "first",
      status: "draft",
      collapsed: false,
    });
    actions.saveComment({
      anchor: { ...ANCHOR, startLine: 9, endLine: 9, rowIds: ["chunk-a:6"] },
      body: "second",
      status: "draft",
      collapsed: false,
    });
    expect(unpostedDraftCount(s.getState().reviewComments)).toBe(2);

    const first = s.getState().reviewComments[0];
    if (first === undefined) throw new Error("unreachable");
    actions.markCommentsSubmitted([first.id]);

    // Exactly one draft cleared; the other still reminds the author.
    expect(unpostedDraftCount(s.getState().reviewComments)).toBe(1);
  });
});
