import type { PartKey } from "brief-core";
import { PartChunkSchema } from "brief-core/types";
import { z } from "zod/v4";

/** Every key brief-core's engine names: the grouping, a detail call, a cut batch's half. */
const PART_KEY_SHAPE = /^(grouping|detail:[1-9][0-9]*(:[12])?)$/;

function isPartKey(value: unknown): value is PartKey {
  return typeof value === "string" && PART_KEY_SHAPE.test(value);
}

export const GenerationPartKeySchema = z.custom<PartKey>(isPartKey);

/** Chunks only, closed at the body and the chunk; nested shapes drop unknown keys. The stored text is the parsed value, never the input. */
export const GenerationPartBodySchema = z
  .object({ chunks: z.array(PartChunkSchema) })
  .strict();
export type GenerationPartBody = z.infer<typeof GenerationPartBodySchema>;
