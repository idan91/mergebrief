import { z } from "zod/v4";
import type { Equals } from "types/utils";
import {
  BriefSchema,
  ChunkSchema,
  DeltaBriefSchema,
  DeltaChunkSchema,
  DeltaSkipReasons,
  PrRefSchema,
  RevisionNarrativeSchema,
  RevisionNarrativeSkipReasons,
  RiskNoteSchema,
  RiskSurfaceAttributes,
  UnattributedFileSchema,
  type Brief,
  type DeltaSkipped,
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

  const riskToken = z.enum([
    ...Object.values(RiskSurfaceAttributes),
    ...customNames,
  ]);
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

export const DeltaSkippedSchema = z.strictObject({
  artifactKind: z.literal("deltaSkipped"),
  pr: PrRefSchema,
  baselineSha: z.string(),
  headSha: z.string(),
  baselineIndex: z.number().int().nullable(),
  headIndex: z.number().int().nullable(),
  skipped: z.enum(DeltaSkipReasons),
});

true satisfies Equals<z.infer<typeof DeltaSkippedSchema>, DeltaSkipped>;

/** A repo's custom risk names are not known at read time; the reader checks shape. */
const readRiskToken = z.string();

const readRiskFields = {
  riskSurface: z.array(readRiskToken),
  riskNotes: z.array(RiskNoteSchema.extend({ attr: readRiskToken })).optional(),
};

export const StoredChunkReadSchema = ChunkSchema.extend({
  ...readRiskFields,
  changeGroupId: z.string().optional(),
});

/** A remainder file's risk names stay open like a chunk's, so one a newer release wrote never drops the section. */
export const StoredUnattributedReadSchema = z
  .array(
    UnattributedFileSchema.extend({
      riskSurface: z.array(readRiskToken).optional(),
    }),
  )
  .optional();

export const StoredBriefReadSchema = BriefSchema.extend({
  index: BriefSchema.shape.index.optional(),
  commitRange: BriefSchema.shape.commitRange.optional(),
  generation: BriefSchema.shape.generation.optional(),
  chunks: z.array(StoredChunkReadSchema),
  unattributed: StoredUnattributedReadSchema,
});

export const StoredDeltaBriefReadSchema = DeltaBriefSchema.extend({
  chunks: z.array(DeltaChunkSchema.extend(readRiskFields)),
});

const sessionFactsRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
});

/** One unattributed file as a session reads it; an entry that fails is counted but carries no flag. */
export const StoredSessionFactsRemainderSchema = z.object({
  file: z.string(),
  addedRanges: z.array(sessionFactsRangeSchema).default([]),
  removedRanges: z.array(sessionFactsRangeSchema).default([]),
  riskSurface: z.array(z.string()).default([]),
});

/**
 * The two top-level lists are required: a body without them would read as
 * zero groups and zero flags, which a carry-over takes for every decision
 * having stopped firing. A chunk missing its ranges is only a chunk with no
 * span. Risk names stay open, a repo's custom names included. Only the
 * unattributed files' count is read, and a broken section counts none.
 */
export const StoredSessionFactsReadSchema = z.object({
  changeGroups: z.array(z.object({ id: z.string() })),
  chunks: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      addedRanges: z.array(sessionFactsRangeSchema).default([]),
      removedRanges: z.array(sessionFactsRangeSchema).default([]),
      riskSurface: z.array(z.string()).default([]),
    }),
  ),
  unattributed: z.array(z.unknown()).catch([]),
});
