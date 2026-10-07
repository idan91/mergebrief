import { z } from "zod/v4";

export const bodySchema = z.object({ url: z.string().min(1).max(500) });
