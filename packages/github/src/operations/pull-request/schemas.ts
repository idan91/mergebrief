import { z } from "zod/v4";

export const gitHubRepoSchema = z.object({
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});

export const openPullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  draft: z.boolean().optional(),
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

export const compareMergeBaseSchema = z.object({
  merge_base_commit: z.object({ sha: z.string().min(1) }),
});

export type OpenPullRequestRow = z.infer<typeof openPullRequestSchema>;
