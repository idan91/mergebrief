import { z } from "zod/v4";
import {
  LineDiffAnswerKinds,
  type LineDiffAnswer,
  type LineDiffRequest,
} from "./types";

const MessageIdSchema = z.number().int().nonnegative();

/** Strict, so a contents field this schema does not read fails the thread instead of vanishing from its diff. */
export const LineDiffRequestSchema = z.strictObject({
  id: MessageIdSchema,
  input: z.strictObject({
    contents: z.strictObject({
      prevPath: z.string(),
      path: z.string(),
      prevContent: z.string().optional(),
      newContent: z.string().optional(),
      modeChange: z
        .strictObject({ prevMode: z.string(), newMode: z.string() })
        .optional(),
      prevMode: z.string().optional(),
      newMode: z.string().optional(),
    }),
    maxEditLength: z.number().int().nonnegative(),
  }),
}) satisfies z.ZodType<LineDiffRequest>;

export const LineDiffAnswerSchema = z.discriminatedUnion("kind", [
  z.object({
    id: MessageIdSchema,
    kind: z.literal(LineDiffAnswerKinds.PATCH),
    patch: z.string(),
  }),
  z.object({
    id: MessageIdSchema,
    kind: z.literal(LineDiffAnswerKinds.NO_PATCH),
  }),
]) satisfies z.ZodType<LineDiffAnswer>;
