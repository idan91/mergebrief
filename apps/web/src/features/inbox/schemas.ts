import { z } from "zod/v4";
import { InboxReviewStates } from "types/inbox";
import type { Result } from "types/utils";

import {
  GenerationStatuses,
  PrStates,
  PullRequestSources,
} from "@web/features/pulls/types";
import { dropInvalidKeys, dropNullKeys } from "@web/utils/drop-keys";
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
    repoSlug: z.string().exactOptional(),
    prNumber: z.number().int().min(1),
    title: z.string().exactOptional(),
    state: prStateSchema,
    draft: z.boolean(),
    source: sourceSchema,
    installationId: z.string().exactOptional(),
    authorLogin: z.string().exactOptional(),
    viewerIsAuthor: z.boolean(),
    viewerCanDelete: z.boolean(),
    reviewState: z.enum(InboxReviewStates).exactOptional(),
    behind: z.boolean(),
    unreachable: z.boolean(),
    generation: inboxGenerationSchema.exactOptional(),
    latestBriefAt: z.string().exactOptional(),
    githubUpdatedAt: z.string().exactOptional(),
    stack: inboxStackPositionSchema.exactOptional(),
  }),
  [
    "repoSlug",
    "title",
    "installationId",
    "authorLogin",
    "reviewState",
    "generation",
    "latestBriefAt",
    "githubUpdatedAt",
    "stack",
  ],
);

export const inboxCountsSchema = z.object({
  new: z.number().int().min(0),
  inProgress: z.number().int().min(0),
  reviewed: z.number().int().min(0),
  updated: z.number().int().min(0),
});

export const inboxViewerSchema = dropNullKeys(
  z.object({ login: z.string().exactOptional(), avatarUrl: z.string() }),
  ["login"],
);

export const reachableInstallationSchema = z.object({
  installationId: z.string(),
  accountLogin: z.string(),
});

export const inboxRepositorySchema = dropNullKeys(
  z.object({
    repoId: z.string().min(1),
    repoSlug: z.string().exactOptional(),
  }),
  ["repoSlug"],
);

export const inboxResponseSchema = dropInvalidKeys(
  z.object({
    items: z.array(inboxItemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    archivedTotal: z.number().int().min(0),
    counts: inboxCountsSchema,
    viewer: inboxViewerSchema,
    reachableInstallations: z.array(reachableInstallationSchema),
    repositories: z.array(inboxRepositorySchema),
    installUrl: httpsUrlSchema.exactOptional(),
  }),
  ["installUrl"],
);

export function parseInboxResponse(body: unknown): Result<InboxPage, string> {
  return parseWithSchema(inboxResponseSchema, body);
}
