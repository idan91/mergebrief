import { describe, expect, it } from "vitest";

import { parsePostedComment } from "./postedComment";

describe("parsePostedComment", () => {
  it("shapes a created comment with and without a wrapping review", () => {
    expect(parsePostedComment({ commentId: 9, reviewId: 555 })).toEqual({
      kind: "posted",
      commentId: 9,
      reviewId: 555,
    });
    expect(parsePostedComment({ commentId: 9 })).toEqual({
      kind: "posted",
      commentId: 9,
    });
  });

  it("refuses a body that breaks the contract", () => {
    expect(parsePostedComment(null)).toBeUndefined();
    expect(parsePostedComment({ nope: true })).toBeUndefined();
    expect(parsePostedComment({ commentId: "9" })).toBeUndefined();
    expect(
      parsePostedComment({ commentId: 9, reviewId: "555" }),
    ).toBeUndefined();
    expect(
      parsePostedComment({ commentId: 9, reviewId: 9007199254740992 }),
    ).toBeUndefined();
  });
});
