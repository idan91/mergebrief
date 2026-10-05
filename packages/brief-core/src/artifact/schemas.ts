import { z } from "zod/v4";
import type { Equals } from "types/utils";
import {
  BriefSchema,
  ChangeGroupSchema,
  ChunkSchema,
  DeltaBriefSchema,
  DeltaChunkSchema,
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

/** Strictness is a write check: a body a newer release wrote still reads. */
export const StoredRevisionNarrativeReadSchema = z.discriminatedUnion(
  "artifactKind",
  [RevisionNarrativeSchema.strip(), RevisionNarrativeSkippedSchema.strip()],
);

/** A repo's custom risk names are not known at read time. */
const readRiskToken = z.string().min(1);

const readRiskFields = {
  riskSurface: z.array(readRiskToken),
  riskNotes: z.array(RiskNoteSchema.extend({ attr: readRiskToken })).optional(),
};

export const StoredChunkReadSchema = ChunkSchema.extend({
  ...readRiskFields,
  changeGroupId: z.string().optional(),
});

/** Bodies older than `changeGroupId` list each group's chunks on the group. */
export const StoredChangeGroupReadSchema = ChangeGroupSchema.extend({
  id: z.string().optional(),
  coreChunkIds: z.array(z.string()).optional(),
  supportingChunkIds: z.array(z.string()).optional(),
});

export const StoredBriefReadSchema = BriefSchema.extend({
  index: BriefSchema.shape.index.optional(),
  commitRange: BriefSchema.shape.commitRange.optional(),
  generation: BriefSchema.shape.generation.optional(),
  changeGroups: z.array(StoredChangeGroupReadSchema),
  chunks: z.array(StoredChunkReadSchema),
});

export const StoredDeltaBriefReadSchema = DeltaBriefSchema.extend({
  chunks: z.array(DeltaChunkSchema.extend(readRiskFields)),
});
