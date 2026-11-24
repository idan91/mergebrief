import { z } from "zod/v4";

import type { Author } from "./types";

const BOT_TYPENAME = "Bot";

/** GraphQL reports a deleted account as `author: null`; the tool calls it absent. */
const authorSchema = z
  .object({ login: z.string(), __typename: z.string() })
  .nullable()
  .transform((author): Author | undefined => {
    if (author === null) {
      return undefined;
    }
    return { login: author.login, isBot: author.__typename === BOT_TYPENAME };
  });

function connection<Node extends z.ZodType>(node: Node) {
  return z.object({ nodes: z.array(node) }).transform((page) => page.nodes);
}

const threadCommentSchema = z
  .object({
    databaseId: z.number(),
    author: authorSchema,
    createdAt: z.string(),
    path: z.string(),
    line: z.number().nullable(),
  })
  .transform((comment) => ({
    id: comment.databaseId,
    author: comment.author,
    createdAt: comment.createdAt,
    path: comment.path,
    line: comment.line ?? undefined,
  }));

const reviewSchema = z
  .object({
    databaseId: z.number(),
    author: authorSchema,
    state: z.string(),
    submittedAt: z.string().nullable(),
    comments: connection(z.object({ databaseId: z.number() })),
  })
  .transform((review) => ({
    id: review.databaseId,
    author: review.author,
    state: review.state,
    submittedAt: review.submittedAt ?? undefined,
    commentIds: review.comments.map((comment) => comment.databaseId),
  }));

const issueCommentSchema = z
  .object({
    databaseId: z.number(),
    author: authorSchema,
    createdAt: z.string(),
  })
  .transform((comment) => ({
    id: comment.databaseId,
    author: comment.author,
    createdAt: comment.createdAt,
  }));

const pullSchema = z
  .object({
    number: z.number(),
    state: z.string(),
    isDraft: z.boolean(),
    headRefName: z.string(),
    baseRefName: z.string(),
    headRefOid: z.string(),
    commits: connection(
      z.object({ commit: z.object({ committedDate: z.string() }) }),
    ),
    reviews: connection(reviewSchema),
    comments: connection(issueCommentSchema),
    reviewThreads: connection(
      z.object({
        isResolved: z.boolean(),
        isOutdated: z.boolean(),
        comments: connection(threadCommentSchema),
      }),
    ),
  })
  .transform((pull) => ({
    number: pull.number,
    state: pull.state,
    isDraft: pull.isDraft,
    head: pull.headRefName,
    base: pull.baseRefName,
    headSha: pull.headRefOid,
    headCommittedAt: pull.commits[0]?.commit.committedDate ?? "",
    reviews: pull.reviews,
    issueComments: pull.comments,
    threads: pull.reviewThreads,
  }));

export const stackResponseSchema = z.object({
  data: z.object({
    repository: z.record(z.string(), pullSchema.nullable()),
  }),
});

export const reviewCommentSchema = z.object({
  id: z.number(),
  in_reply_to_id: z.number().nullish(),
});

export const postedReplySchema = z.object({
  id: z.number(),
  html_url: z.string(),
});
