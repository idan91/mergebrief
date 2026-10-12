import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import {
  parsePostedComment,
  type PostedComment,
  type postedCommentSchema,
} from "./postedComment";

const postedCommentPin = true satisfies Equals<
  z.output<typeof postedCommentSchema>,
  PostedComment
>;

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

  it("pins the schema to the PostedComment interface", () => {
    expect(postedCommentPin).toBe(true);
  });
});
