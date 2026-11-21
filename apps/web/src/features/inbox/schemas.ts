import { z } from "zod/v4";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  InboxReviewStates,
  PrStates,
  PullRequestSources,
  type Result,
} from "types";

import { dropInvalidKeys, dropNullKeys } from "@web/utils/drop-keys";
import { httpsUrlSchema } from "@web/utils/https-url";
import { unmetConditionSchema } from "@web/features/pulls/schemas";
import { buildOpenEnumSchema } from "@web/utils/open-enum";
import { parseWithSchema } from "@web/utils/parse-with-schema";
import { buildTolerantListSchema } from "@web/utils/tolerant-list";

import type { InboxPage } from "./types";

const prStateSchema = buildOpenEnumSchema(PrStates);
const sourceSchema = buildOpenEnumSchema(PullRequestSources);
const generationStatusSchema = buildOpenEnumSchema(GenerationStatuses);

export const inboxGenerationSchema = dropInvalidKeys(
  z.object({
    status: generationStatusSchema,
    errorCode: z.enum(GenerationFailureCodes).exactOptional(),
    updatedAt: z.string(),
    unmetConditions:
      buildTolerantListSchema(unmetConditionSchema).exactOptional(),
  }),
  ["errorCode", "unmetConditions"],
);

export const inboxStackPositionSchema = z.object({
  index: z.number().int().min(1),
  size: z.number().int().min(1),
});

/** A vocabulary value this bundle predates reads `unknown`; a null review state means the viewer's own row. */
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
    // An API one release older sends no push bit: offer nothing that needs one.
    viewerCanPush: z.boolean().default(false),
    reviewState: buildOpenEnumSchema(InboxReviewStates).exactOptional(),
    behind: z.boolean(),
    unreachable: z.boolean(),
    generation: inboxGenerationSchema.exactOptional(),
    latestBriefAt: z.string().exactOptional(),
    githubUpdatedAt: z.string().exactOptional(),
    githubCreatedAt: z.string().exactOptional(),
    stack: inboxStackPositionSchema.exactOptional(),
  }),
  [
    "repoSlug",
    "title",
    "installationId",
    "authorLogin",
    "generation",
    "latestBriefAt",
    "githubUpdatedAt",
    "githubCreatedAt",
    "stack",
    "reviewState",
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
    // An API one release older sends neither count: no search, no match.
    searchMatchTotal: z.number().int().min(0).default(0),
    archivedSearchMatchTotal: z.number().int().min(0).default(0),
    heldTotal: z.number().int().min(0).default(0),
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
