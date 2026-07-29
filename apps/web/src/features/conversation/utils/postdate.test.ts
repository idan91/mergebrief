// BRIEF-95 cutoff derivations: strictly-after comparison, absent-cutoff and
// unparsable-date safety, and the count spanning thread + PR-level comments.
import { describe, expect, it } from "vitest";

import type { PrConversation } from "../types";
import { countCommentsAfterBrief, postdatesBrief } from "./postdate";

const CUTOFF = "2026-07-01T10:30:00Z";

function comment(commentId: number, createdAt: string) {
  return {
    commentId,
    author: { login: "alice", isBot: false },
    body: "b",
    createdAt,
    url: "https://example.test/c",
  };
}

describe("postdatesBrief", () => {
  it("marks strictly-newer comments only (the cutoff itself is accounted for)", () => {
    expect(postdatesBrief("2026-07-01T10:31:00Z", CUTOFF)).toBe(true);
    expect(postdatesBrief(CUTOFF, CUTOFF)).toBe(false);
    expect(postdatesBrief("2026-07-01T10:00:00Z", CUTOFF)).toBe(false);
  });

  it("marks nothing without a cutoff or with unparsable dates", () => {
    expect(postdatesBrief("2026-07-01T10:31:00Z", undefined)).toBe(false);
    expect(postdatesBrief("not-a-date", CUTOFF)).toBe(false);
    expect(postdatesBrief("2026-07-01T10:31:00Z", "not-a-date")).toBe(false);
  });
});

describe("countCommentsAfterBrief", () => {
  it("counts thread comments AND PR-level comments past the cutoff", () => {
    const conversation: PrConversation = {
      threads: [
        {
          rootCommentId: 1,
          path: "src/a.ts",
          line: 1,
          side: "RIGHT",
          subjectType: "LINE",
          isResolved: false,
          isOutdated: false,
          comments: [
            comment(1, "2026-07-01T10:00:00Z"),
            comment(2, "2026-07-01T11:00:00Z"),
          ],
          hasMoreComments: false,
        },
      ],
      reviews: [],
      prComments: [
        { ...comment(3, "2026-07-01T12:00:00Z") },
        { ...comment(4, "2026-07-01T09:00:00Z") },
      ],
      hasMoreThreads: false,
      hasMoreReviews: false,
      hasMorePrComments: false,
    };
    expect(countCommentsAfterBrief(conversation, CUTOFF)).toBe(2);
    expect(countCommentsAfterBrief(conversation, undefined)).toBe(0);
  });
});
