// The 201 body the comment and reply routes share: the created comment, and
// the review GitHub wrapped it in when it assigns one.
import type { Mutable } from "types/utils";

/** `reviewId` is the own-comment join key; absent when GitHub assigns none. */
export interface PostedComment {
  readonly kind: "posted";
  readonly commentId: number;
  readonly reviewId?: number;
}

function isSafeId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** The posted result, or `undefined` when the body breaks the contract. */
export function parsePostedComment(value: unknown): PostedComment | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  if (!("commentId" in value) || !isSafeId(value.commentId)) {
    return undefined;
  }

  const posted: Mutable<PostedComment> = {
    kind: "posted",
    commentId: value.commentId,
  };
  if (!("reviewId" in value) || value.reviewId === undefined) {
    return posted;
  }
  if (!isSafeId(value.reviewId)) {
    return undefined;
  }

  posted.reviewId = value.reviewId;
  return posted;
}
