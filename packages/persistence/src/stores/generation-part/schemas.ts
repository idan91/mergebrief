import type { PartKey } from "brief-core";
import { PartChunkSchema, StoredGroupingSchema } from "brief-core/types";
import { z } from "zod/v4";
import { GenerationPartKinds } from "./types";

/** Every key brief-core's engine names: the grouping, a detail call, a cut batch's half. */
const PART_KEY_SHAPE = /^(grouping|detail:[1-9][0-9]*(:[12])?)$/;

function isPartKey(value: unknown): value is PartKey {
  return typeof value === "string" && PART_KEY_SHAPE.test(value);
}

export const GenerationPartKeySchema = z.custom<PartKey>(isPartKey);

/** A sha-256 hex digest, as `node:crypto` renders it. */
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * The grouping call's output as the engine parsed it: groups, hunk map and
 * whole-PR fields, no chunks; stamped with the digest of the `.gitattributes`
 * its outline was read under, since another file shortens other files.
 */
const GroupingPartBodySchema = z
  .object({
    kind: z.literal(GenerationPartKinds.GROUPING),
    grouping: StoredGroupingSchema,
    gitAttributesDigest: Sha256HexSchema,
  })
  .strict();

/** One detail call's chunks, closed at the chunk; nested shapes drop unknown keys. */
const DetailPartBodySchema = z
  .object({
    kind: z.literal(GenerationPartKinds.DETAIL),
    chunks: z.array(PartChunkSchema),
  })
  .strict();

/** Closed at the body: a grouping part or a detail part, nothing else. The stored text is the parsed value, never the input. */
export const GenerationPartBodySchema = z.discriminatedUnion("kind", [
  GroupingPartBodySchema,
  DetailPartBodySchema,
]);
export type GenerationPartBody = z.infer<typeof GenerationPartBodySchema>;
