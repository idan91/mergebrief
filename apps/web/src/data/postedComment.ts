// The 201 body the comment and reply routes share: the created comment, and
// the review GitHub wrapped it in when it assigns one.
import type { PostedCommentResponse } from "contract";
import { z } from "zod/v4";

/** `reviewId` is the own-comment join key; absent when GitHub assigns none. */
export interface PostedComment {
  readonly kind: "posted";
  readonly commentId: number;
  readonly reviewId?: number;
}

export const postedCommentSchema = z
  .object({ commentId: z.int(), reviewId: z.int().exactOptional() })
  .transform((body) => ({ kind: "posted", ...body }) satisfies PostedComment)
  .readonly() satisfies z.ZodType<PostedComment, PostedCommentResponse>;
