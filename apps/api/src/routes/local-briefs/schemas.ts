import { z } from "zod/v4";
import { BRIEF_ID_PATTERN, MAX_BRIEF_ID_LENGTH } from "./consts";
import { ComparisonBaselineLabels } from "types/comparisons";

export const briefIdParamSchema = z
  .string()
  .max(MAX_BRIEF_ID_LENGTH)
  .regex(BRIEF_ID_PATTERN);

/** The header the listing reads; `files` is the reader's to parse. */
export const comparisonMarksHeaderSchema = z.object({
  baselineSha: z.string(),
  headSha: z.string(),
  baselineLabel: z.enum(ComparisonBaselineLabels),
  baselineIndex: z
    .number()
    .int()
    .nullish()
    .transform((index) => index ?? null),
});

/** `files` is kept unparsed: a legacy sidecar serves it as marks verbatim. */
export const revisionChangesHeaderSchema = z.object({
  headSha: z.string(),
  prevHeadSha: z.string(),
  prevIndex: z.number().int(),
  files: z.array(z.unknown()),
});
