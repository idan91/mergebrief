import { z } from "zod/v4";

/** `pnpm licenses list --json`: packages grouped under the license pnpm resolved for them. */
export const LicenseListingSchema = z.record(
  z.string(),
  z.array(
    z.looseObject({
      name: z.string().min(1),
      versions: z.array(z.string()).min(1),
    }),
  ),
);
