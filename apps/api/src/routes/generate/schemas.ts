import { z } from "zod";

export const bodySchema = z.object({ url: z.string().min(1).max(500) });
