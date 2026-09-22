import { z } from "zod/v4";
import { InboxReviewStates } from "types/inbox";
import type { Result } from "types/utils";

import {
  GenerationStatuses,
  PrStates,
  PullRequestSources,
} from "@web/features/pulls/types";

const prStateSchema = z.enum(PrStates);
const sourceSchema = z.enum(PullRequestSources);
const generationStatusSchema = z.enum(GenerationStatuses);

export const inboxGenerationSchema = z.object({
  status: generationStatusSchema,
  updatedAt: z.string(),
});

const inboxStackSchema = z.object({
  index: z.number().int().min(1),
  size: z.number().int().min(1),
});

export const inboxItemSchema = z.object({
  repoId: z.string().min(1),
  repoSlug: z.string().nullable(),
  prNumber: z.number().int().min(1),
  title: z.string().nullable(),
  state: prStateSchema,
  draft: z.boolean(),
  source: sourceSchema,
  installationId: z.string().nullable(),
  viewerIsAuthor: z.boolean(),
  reviewState: z.enum(InboxReviewStates).nullable(),
  behind: z.boolean(),
  unreachable: z.boolean(),
  generation: inboxGenerationSchema.nullable(),
  latestBriefAt: z.string().nullable(),
  githubUpdatedAt: z.string().nullable(),
  stack: inboxStackSchema.nullable(),
});

export const inboxCountsSchema = z.object({
  new: z.number().int().min(0),
  inProgress: z.number().int().min(0),
  reviewed: z.number().int().min(0),
  updated: z.number().int().min(0),
});

const inboxViewerSchema = z.object({
  login: z.string().nullable(),
  avatarUrl: z.string(),
});

const reachableInstallationSchema = z.object({
  installationId: z.string(),
  accountLogin: z.string(),
});

export const inboxResponseSchema = z.object({
  items: z.array(inboxItemSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  counts: inboxCountsSchema,
  viewer: inboxViewerSchema,
  reachableInstallations: z.array(reachableInstallationSchema),
});

export function parseInboxResponse(
  body: unknown,
): Result<z.infer<typeof inboxResponseSchema>, string> {
  const parsed = inboxResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }
  return { ok: true, value: parsed.data };
}
