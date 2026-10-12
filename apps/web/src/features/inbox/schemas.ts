import { z } from "zod/v4";
import { InboxReviewStates } from "types/inbox";
import type { Result } from "types/utils";

import {
  GenerationStatuses,
  PrStates,
  PullRequestSources,
} from "@web/features/pulls/types";
import { dropNullKeys } from "@web/utils/drop-keys";
import { httpsUrlSchema } from "@web/utils/https-url";
import { parseWithSchema } from "@web/utils/parse-with-schema";

import type { InboxPage } from "./types";

const prStateSchema = z.enum(PrStates);
const sourceSchema = z.enum(PullRequestSources);
const generationStatusSchema = z.enum(GenerationStatuses);

export const inboxGenerationSchema = z.object({
  status: generationStatusSchema,
  updatedAt: z.string(),
});

export const inboxStackPositionSchema = z.object({
  index: z.number().int().min(1),
  size: z.number().int().min(1),
});

export const inboxItemSchema = dropNullKeys(
  z.object({
    repoId: z.string().min(1),
    repoSlug: z.string().nullable(),
    prNumber: z.number().int().min(1),
    title: z.string().nullable(),
    state: prStateSchema,
    draft: z.boolean(),
    source: sourceSchema,
    installationId: z.string().nullable(),
    authorLogin: z.string().exactOptional(),
    viewerIsAuthor: z.boolean(),
    viewerCanDelete: z.boolean(),
    reviewState: z.enum(InboxReviewStates).nullable(),
    behind: z.boolean(),
    unreachable: z.boolean(),
    generation: inboxGenerationSchema.nullable(),
    latestBriefAt: z.string().nullable(),
    githubUpdatedAt: z.string().nullable(),
    stack: inboxStackPositionSchema.nullable(),
  }),
  ["authorLogin"],
);

export const inboxCountsSchema = z.object({
  new: z.number().int().min(0),
  inProgress: z.number().int().min(0),
  reviewed: z.number().int().min(0),
  updated: z.number().int().min(0),
});

export const inboxViewerSchema = z.object({
  login: z.string().nullable(),
  avatarUrl: z.string(),
});

export const reachableInstallationSchema = z.object({
  installationId: z.string(),
  accountLogin: z.string(),
});

export const inboxRepositorySchema = z.object({
  repoId: z.string().min(1),
  repoSlug: z.string().nullable(),
});

export const inboxResponseSchema = z.object({
  items: z.array(inboxItemSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  archivedTotal: z.number().int().min(0),
  counts: inboxCountsSchema,
  viewer: inboxViewerSchema,
  reachableInstallations: z.array(reachableInstallationSchema),
  repositories: z.array(inboxRepositorySchema),
  installUrl: httpsUrlSchema.nullable().catch(null),
});

export function parseInboxResponse(body: unknown): Result<InboxPage, string> {
  return parseWithSchema(inboxResponseSchema, body);
}
