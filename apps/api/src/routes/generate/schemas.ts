import { RequestBounds, type GenerateBriefBody } from "contract";
import { z } from "zod/v4";

export const bodySchema = z.object({
  url: z.string().min(1).max(RequestBounds.GENERATE_URL_LENGTH),
}) satisfies z.ZodType<GenerateBriefBody>;
