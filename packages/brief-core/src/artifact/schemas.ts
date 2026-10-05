import { z } from "zod/v4";
import type { Equals } from "types/utils";
import {
  BriefSchema,
  ChunkSchema,
  PrRefSchema,
  RevisionNarrativeSchema,
  RevisionNarrativeSkipReasons,
  RiskNoteSchema,
  RiskSurfaceAttributes,
  type Brief,
  type RevisionNarrativeSkipped,
} from "../types";

/**
 * The stored Brief schema for one repo: the built-in risk vocabulary plus that
 * repo's custom attribute names. `extend` builds new schemas, so the generation
 * schemas the model's JSON schema derives from are never touched.
 */
export function buildStoredBriefSchema(
  customNames: readonly string[],
): z.ZodType<Brief> {
  if (customNames.length === 0) {
    return BriefSchema;
  }

  const riskToken = z.enum([...RiskSurfaceAttributes, ...customNames]);
  const storedChunkSchema = ChunkSchema.extend({
    riskSurface: z.array(riskToken),
    riskNotes: z.array(RiskNoteSchema.extend({ attr: riskToken })).optional(),
  });

  return BriefSchema.extend({ chunks: z.array(storedChunkSchema) });
}

export const RevisionNarrativeSkippedSchema = z.strictObject({
  artifactKind: z.literal("revisionNarrativeSkipped"),
  pr: PrRefSchema,
  prevHeadSha: z.string(),
  headSha: z.string(),
  prevIndex: z.number().int(),
  headIndex: z.number().int(),
  skipped: z.enum(RevisionNarrativeSkipReasons),
});

true satisfies Equals<
  z.infer<typeof RevisionNarrativeSkippedSchema>,
  RevisionNarrativeSkipped
>;

export const StoredRevisionNarrativeSchema = z.discriminatedUnion(
  "artifactKind",
  [RevisionNarrativeSchema, RevisionNarrativeSkippedSchema],
);
