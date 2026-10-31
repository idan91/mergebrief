import { z } from "zod/v4";

export const spendViewSchema = z
  .object({
    startedRuns: z.number(),
    cap: z.number().exactOptional(),
    largeRuns: z
      .object({ runs: z.number(), units: z.number() })
      .readonly()
      .exactOptional(),
    dayStartedAt: z.string(),
    resetsAt: z.string(),
  })
  .readonly();
