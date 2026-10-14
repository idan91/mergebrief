import { z } from "zod/v4";
import { AccessLevels } from "types/access-levels";
import { MAX_EXPIRY_DAYS } from "./consts";

/**
 * Mint body. `expiresInDays` is a whole number of days, `null` = NO expiry
 * (the adopter's call for self-host CI), omitted = the 90-day default.
 * `scope` is immutable for the token's life, narrowing later is a new token.
 */
export const mintBodySchema = z.object({
  name: z.string().min(1).max(100),
  // REQUIRED, no default. A fallback mints reach the caller never chose:
  // widen and every browser token is external-write; narrow and the token
  // silently lacks what its owner expects, surfacing as an unexplained 403.
  // The mint form asks, and the list shows what was asked for.
  scope: z.enum([
    AccessLevels.READ,
    AccessLevels.PRIVATE_WRITE,
    AccessLevels.EXTERNAL_WRITE,
  ]),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(MAX_EXPIRY_DAYS)
    .nullable()
    .optional(),
});
