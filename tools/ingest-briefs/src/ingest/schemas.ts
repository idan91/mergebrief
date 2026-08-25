// The body boundaries: what the ingest needs to READ off each artifact. The
// bodies themselves still reach the stores verbatim — these schemas only pull
// out the coordinates a row is keyed on.
import { z } from "zod";

/** `owner/repo`, strict: the slug reaches a `gh api` path in the CLI
 * wrapper, so it must never smuggle extra path segments. */
const repoSlugSchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

const generationSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    effort: z.string(),
  })
  .optional();

const lineRangeSchema = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive(),
});

const markedFileSchema = z
  .object({
    file: z.string(),
    addedRanges: z.array(lineRangeSchema),
    removedRanges: z.array(lineRangeSchema),
  })
  .passthrough();

/** The metadata slice the ingest needs off a Brief body; the body itself
 * stays verbatim. `generation` is absent on artifacts predating the stamp. */
export const BriefMetaSchema = z.object({
  pr: z.object({
    repo: repoSlugSchema,
    number: z.number().int().positive(),
    title: z.string().optional(),
  }),
  index: z.number().int().positive(),
  commitRange: z.object({
    base: z.string().min(1),
    head: z.string().min(1),
    commitCount: z.number().int().nonnegative().optional(),
  }),
  generation: generationSchema,
});

/**
 * The PRE-INDEX brief shape: one brief per PR, its head under `pr.sha`, with
 * no index and no commit range. Two of these are in the migration set, so the
 * cutover has to carry them rather than report them lost. The PR-base SHA
 * they lack comes from the repo resolution (`--resolve-repos`).
 */
export const LegacyBriefMetaSchema = z.object({
  pr: z.object({
    repo: repoSlugSchema,
    number: z.number().int().positive(),
    title: z.string().optional(),
    sha: z.string().min(1),
  }),
});

/** The legacy previous-brief marks alias: same coordinates, older wrapper. */
export const RevchangesSchema = z.object({
  prevHeadSha: z.string().min(1),
  headSha: z.string().min(1),
  files: z.array(
    z
      .object({
        file: z.string(),
        addedRanges: z.array(z.object({ start: z.number(), end: z.number() })),
        removedRanges: z.array(
          z.object({ start: z.number(), end: z.number() }),
        ),
      })
      .passthrough(),
  ),
});

export const DeltaMetaSchema = z.object({
  pr: z.object({
    repo: repoSlugSchema,
    number: z.number().int().positive(),
  }),
  baselineSha: z.string().min(1),
  headSha: z.string().min(1),
  generation: generationSchema,
});

export const NarrativeMetaSchema = z.object({
  pr: z.object({
    repo: repoSlugSchema,
    number: z.number().int().positive(),
  }),
  prevHeadSha: z.string().min(1),
  headSha: z.string().min(1),
  generation: generationSchema,
});

/** Tolerant read of the CLI comparison file; projected to the store's
 * coordinates-only shape (extra keys dropped, never passed through). */
export const ComparisonFileSchema = z
  .object({
    baselineSha: z.string().min(1),
    headSha: z.string().min(1),
    files: z.array(markedFileSchema),
  })
  .passthrough();
