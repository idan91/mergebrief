import { z } from "zod";

/** Hard row cap (flat list, no cursor); also the Zod upper bound. */
export const LIST_MAX_ROWS = 100;

export const listQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIST_MAX_ROWS)
    .default(LIST_MAX_ROWS),
});
