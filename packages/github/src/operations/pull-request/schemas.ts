import { z } from "zod/v4";

export const gitHubRepoSchema = z.object({
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});

export const openPullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  head: z.object({
    ref: z.string(),
    repo: gitHubRepoSchema.nullable(),
  }),
  base: z.object({
    ref: z.string(),
    repo: gitHubRepoSchema,
  }),
});

export const openPullRequestListSchema = z.array(openPullRequestSchema);

export const compareFilesSchema = z.object({
  status: z.string().optional(),
  files: z
    .array(
      z.object({
        filename: z.string(),
        status: z.string(),
        previous_filename: z.string().optional(),
      }),
    )
    .optional(),
});

export type OpenPullRequestRow = z.infer<typeof openPullRequestSchema>;
