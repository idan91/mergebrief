import type { PostedCommentResponse } from "contract";
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";

import { postedCommentSchema, type PostedComment } from "./postedComment";

function parsePostedComment(value: unknown): PostedComment | undefined {
  const parsed = parseWithSchema(postedCommentSchema, value);
  const comment = parsed.ok ? parsed.value : undefined;
  return comment;
}

const postedCommentPin = true satisfies Equals<
  z.output<typeof postedCommentSchema>,
  PostedComment
>;

/** Every field the parser reads is one the contract sends. */
const readsWireFieldsPin = true satisfies Equals<
  Exclude<
    keyof z.input<typeof postedCommentSchema>,
    keyof PostedCommentResponse
  >,
  never
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

  it("reads only the fields the contract sends", () => {
    expect(readsWireFieldsPin).toBe(true);
  });
});
