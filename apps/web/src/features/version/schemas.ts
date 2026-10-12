import type { VersionResponse } from "contract";
import { z } from "zod/v4";
import type { Result } from "types/utils";

import { dropInvalidKeys } from "@web/utils/drop-keys";
import { httpsUrlSchema } from "@web/utils/https-url";
import { parseWithSchema } from "@web/utils/parse-with-schema";

export const versionResponseSchema = dropInvalidKeys(
  z.object({
    version: z.string(),
    latest: z.string().exactOptional(),
    releaseNotesUrl: httpsUrlSchema.exactOptional(),
    checkedAt: z.string().exactOptional(),
    breaking: z.boolean().exactOptional(),
    security: z.boolean().exactOptional(),
    dismissedVersion: z.string().exactOptional(),
  }),
  [
    "latest",
    "releaseNotesUrl",
    "checkedAt",
    "breaking",
    "security",
    "dismissedVersion",
  ],
).readonly();

/** Unknown fields drop, a mistyped optional field drops, a missing version refuses. */
export function parseVersion(body: unknown): Result<VersionResponse, string> {
  return parseWithSchema(versionResponseSchema, body);
}
