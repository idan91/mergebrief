import { z } from "zod";

/** The switch body — `installationId` as a numeric string or JSON number. */
export const switchBodySchema = z.object({
  installationId: z.union([z.string().min(1), z.number().int()]),
  setDefault: z.boolean().optional(),
});
