import { z } from "zod";
import { MAX_BODY_LENGTH, rowIdSchema } from "../wire-bounds";

export const publishDraftSchema = z.object({ draftId: rowIdSchema });

/** A reply/thread target id is a REST comment id — bounded by JS integer precision. */
export const commentIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .refine((value) => Number.isSafeInteger(value));

export const replyBodySchema = z.object({
  body: z.string().min(1).max(MAX_BODY_LENGTH),
});
