import { MentionPatterns } from "contract";
import {
  ReviewCommentSides,
  ReviewVerdictStates,
  ThreadSubjectTypes,
} from "types/conversation";
import { z } from "zod/v4";

import { dropInvalidKeys } from "@web/utils/drop-keys";
import { httpsUrlSchema } from "@web/utils/https-url";
import { buildOpenEnumSchema } from "@web/utils/open-enum";

import type { ConversationThread } from "./types";

const githubIdSchema = z.int().positive();
const lineSchema = z.int().positive();
const threadSideSchema = buildOpenEnumSchema(ReviewCommentSides);

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

/**
 * `line` is absent ONLY for outdated or file-level threads; a FILE thread
 * never carries one. An unknown subject type states no rule to check.
 */
function isAnchorConsistent(thread: ThreadAnchor): boolean {
  if (thread.subjectType === ThreadSubjectTypes.FILE) {
    return thread.line === undefined;
  }
  if (thread.subjectType === ThreadSubjectTypes.LINE) {
    const placeable = thread.isOutdated || thread.line !== undefined;
    return placeable;
  }
  return true;
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
    subjectType: buildOpenEnumSchema(ThreadSubjectTypes),
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
    state: buildOpenEnumSchema(ReviewVerdictStates),
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

/** Each item its schema rejects is dropped, so one bad row never fails the list. */
function buildTolerantListSchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  return z
    .array(z.unknown())
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = z.safeParse(itemSchema, entry);
        if (!parsed.success) {
          return [];
        }
        return [parsed.data];
      }),
    )
    .readonly();
}

const TEAM_HANDLE_PATTERN = new RegExp(
  `^(${MentionPatterns.LOGIN})/(${MentionPatterns.TEAM_SLUG})$`,
);

export const mentionSuggestionUserSchema = dropInvalidKeys(
  z.object({
    login: z.string(),
    name: z.string().exactOptional(),
    avatarUrl: httpsUrlSchema.exactOptional(),
  }),
  ["avatarUrl"],
).readonly();

export const mentionSuggestionTeamSchema = z
  .object({
    combinedSlug: z
      .templateLiteral([z.string(), "/", z.string()])
      .refine((handle) => TEAM_HANDLE_PATTERN.test(handle)),
    name: z.string(),
  })
  .readonly();

export const mentionSuggestionsResponseSchema = z
  .object({
    users: buildTolerantListSchema(mentionSuggestionUserSchema),
    teams: buildTolerantListSchema(mentionSuggestionTeamSchema),
  })
  .readonly();
