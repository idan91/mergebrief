import type { DismissVersionNoticeBody } from "contract";
import { parseSemver } from "persistence";
import { z } from "zod/v4";

const MAX_VERSION_LENGTH = 64;

/** The dismiss body: one release, as the update check spells `latest`. */
export const dismissVersionBodySchema = z
  .object({
    version: z
      .string()
      .max(MAX_VERSION_LENGTH)
      .refine((value) => parseSemver(value).ok),
  })
  .strict() satisfies z.ZodType<DismissVersionNoticeBody>;
