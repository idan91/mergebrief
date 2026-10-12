// The 201 body the comment and reply routes share: the created comment, and
// the review GitHub wrapped it in when it assigns one.
import { z } from "zod/v4";

import { parseWithSchema } from "@web/utils/parse-with-schema";

/** `reviewId` is the own-comment join key; absent when GitHub assigns none. */
export interface PostedComment {
  readonly kind: "posted";
  readonly commentId: number;
  readonly reviewId?: number;
}

export const postedCommentSchema = z
  .object({ commentId: z.int(), reviewId: z.int().exactOptional() })
  .transform((body) => ({ kind: "posted", ...body }) satisfies PostedComment)
  .readonly();

/** The posted result, or `undefined` when the body breaks the contract. */
export function parsePostedComment(value: unknown): PostedComment | undefined {
  const parsed = parseWithSchema(postedCommentSchema, value);
  if (!parsed.ok) {
    return undefined;
  }
  return parsed.value;
}
