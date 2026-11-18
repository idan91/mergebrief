import { z } from "zod/v4";

/** The CLI's `LineRange`: 1-based, inclusive, `start <= end`. */
const lineRangeSchema = z
  .object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.end >= range.start, {
    message: "line range end must be >= start",
    path: ["end"],
  });

/** Per-file marks: coordinates only, never line content. */
const marksFileSchema = z
  .object({
    file: z.string(),
    addedRanges: z.array(lineRangeSchema),
    removedRanges: z.array(lineRangeSchema),
  })
  .strict();

/**
 * `.strict()` at every level rejects the CLI's read-time context
 * (`baselineLabel`, `baselineIndex`) and any per-line content key: the marks
 * are a pure function of the SHA pair, which the span-only unique key needs.
 */
export const ComparisonMarksBodySchema = z
  .object({
    baselineSha: z.string(),
    headSha: z.string(),
    files: z.array(marksFileSchema),
  })
  .strict();
export type ComparisonMarksBody = z.infer<typeof ComparisonMarksBodySchema>;

/** One `@@` header; zero is legal on either side (`@@ -0,0 +1,n @@`). */
const hunkSchema = z
  .object({
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
  })
  .strict();

/** `.strict()` keeps the hop coordinates-only: no per-line content key gets in. */
export const HunkSpansSchema = z.array(
  z.object({ file: z.string(), hunks: z.array(hunkSchema) }).strict(),
);
export type HunkSpans = z.infer<typeof HunkSpansSchema>;
