import { z } from "zod/v4";
import type { Result } from "types/utils";

import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import { dropInvalidKeys } from "@web/utils/drop-keys";
import { httpsUrlSchema } from "@web/utils/https-url";
import { parseWithSchema } from "@web/utils/parse-with-schema";

import {
  ReviewVerdictStates,
  ThreadSides,
  ThreadSubjectTypes,
  type ConversationThread,
  type PrConversation,
} from "./types";

const githubIdSchema = z.int().positive();
const lineSchema = z.int().positive();
const threadSideSchema = z.enum(ThreadSides);

export const conversationAuthorSchema = dropInvalidKeys(
  z.object({
    login: z.string(),
    isBot: z.boolean(),
    avatarUrl: httpsUrlSchema.exactOptional(),
  }),
  ["avatarUrl"],
).readonly();

export const conversationCommentSchema = z
  .object({
    commentId: githubIdSchema,
    author: conversationAuthorSchema,
    body: z.string(),
    createdAt: z.string(),
    url: httpsUrlSchema,
    reviewId: githubIdSchema.exactOptional(),
  })
  .readonly();

type ThreadAnchor = Pick<
  ConversationThread,
  "subjectType" | "line" | "isOutdated"
>;

/** `line` is absent ONLY for outdated or file-level threads; a FILE thread never carries one. */
function isAnchorConsistent(thread: ThreadAnchor): boolean {
  if (thread.subjectType === ThreadSubjectTypes.FILE) {
    return thread.line === undefined;
  }
  return thread.isOutdated || thread.line !== undefined;
}

/** The root id is the reply target, so it must be the first comment shown. */
function isRootFirst(
  thread: Pick<ConversationThread, "rootCommentId" | "comments">,
): boolean {
  return thread.comments[0]?.commentId === thread.rootCommentId;
}

export const conversationThreadSchema = z
  .object({
    rootCommentId: githubIdSchema,
    path: z.string(),
    line: lineSchema.exactOptional(),
    startLine: lineSchema.exactOptional(),
    side: threadSideSchema.exactOptional(),
    startSide: threadSideSchema.exactOptional(),
    subjectType: z.enum(ThreadSubjectTypes),
    isResolved: z.boolean(),
    isOutdated: z.boolean(),
    anchorSha: z.string().exactOptional(),
    comments: z.array(conversationCommentSchema).min(1).readonly(),
    hasMoreComments: z.boolean(),
  })
  .refine(isAnchorConsistent, { error: "line contradicts subjectType" })
  .refine(isRootFirst, { error: "root comment is not first" })
  .readonly();

export const conversationReviewSchema = z
  .object({
    reviewId: githubIdSchema,
    author: conversationAuthorSchema,
    state: z.enum(ReviewVerdictStates),
    body: z.string(),
    submittedAt: z.string().exactOptional(),
    url: httpsUrlSchema,
  })
  .readonly();

export const prLevelCommentSchema = z
  .object({
    commentId: githubIdSchema,
    author: conversationAuthorSchema,
    body: z.string(),
    createdAt: z.string(),
    url: httpsUrlSchema,
  })
  .readonly();

export const prConversationSchema = z
  .object({
    threads: z.array(conversationThreadSchema).readonly(),
    reviews: z.array(conversationReviewSchema).readonly(),
    prComments: z.array(prLevelCommentSchema).readonly(),
    hasMoreThreads: z.boolean(),
    hasMoreReviews: z.boolean(),
    hasMorePrComments: z.boolean(),
  })
  .readonly();

export const mentionCandidateSchema = dropInvalidKeys(
  z.object({
    login: z.string(),
    name: z.string().optional(),
    avatarUrl: httpsUrlSchema.optional(),
  }),
  ["avatarUrl"],
).readonly();

/** `hasMore` is required but not surfaced: a truncated pool is still a pool. */
const collaboratorsBodySchema = z.object({
  collaborators: z.array(mentionCandidateSchema).readonly(),
  hasMore: z.boolean(),
});

/** Parse the conversation GET's body; `ok: false` = contract violation. */
export function parseConversation(
  value: unknown,
): Result<PrConversation, string> {
  return parseWithSchema(prConversationSchema, value);
}

/** Parse the collaborators GET's body into mention candidates; `ok: false` = contract violation. */
export function parseCollaborators(
  value: unknown,
): Result<readonly MentionCandidate[], string> {
  const parsed = parseWithSchema(collaboratorsBodySchema, value);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, value: parsed.value.collaborators };
}
