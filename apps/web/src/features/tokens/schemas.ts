import { z } from "zod/v4";
import { AccessLevels } from "types/access-levels";

import { dropNullKeys } from "@web/utils/drop-keys";
import { buildOpenEnumSchema } from "@web/utils/open-enum";

export const apiTokenSchema = dropNullKeys(
  z.object({
    id: z.string(),
    name: z.string(),
    scope: buildOpenEnumSchema(AccessLevels),
    userLogin: z.string().exactOptional(),
    expiresAt: z.string().exactOptional(),
    lastUsedAt: z.string().exactOptional(),
    revokedAt: z.string().exactOptional(),
    createdAt: z.string(),
  }),
  ["userLogin", "expiresAt", "lastUsedAt", "revokedAt"],
).readonly();

export const tokensViewSchema = z
  .object({ tokens: z.array(apiTokenSchema) })
  .readonly();

export const mintedTokenSchema = z
  .object({ token: z.string(), apiToken: apiTokenSchema })
  .readonly();
