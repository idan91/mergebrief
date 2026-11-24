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

/**
 * A thread's open state needs only its root and its last message; fetching
 * those two directly means a long thread can never hide its latest reply.
 */
const threadSchema = z
  .object({
    isResolved: z.boolean(),
    isOutdated: z.boolean(),
    root: connection(threadCommentSchema),
    latest: connection(threadCommentSchema),
  })
  .transform((thread) => {
    const [root] = thread.root;
    const [latest] = thread.latest;
    const comments = [root, latest].filter(
      (comment, index, all) =>
        comment !== undefined &&
        all.findIndex((other) => other?.id === comment.id) === index,
    );
    return {
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      comments: comments.filter((comment) => comment !== undefined),
    };
  });

/**
 * Activity counts from the earlier of the head's commit time and its first
 * check suite (created on push): a comment posted between commit and push is
 * new to the head, and a local clock running ahead of GitHub cannot hide one.
 */
function readActivitySince(
  commit:
    | { committedDate: string; checkSuites: readonly { createdAt: string }[] }
    | undefined,
): string {
  if (commit === undefined) {
    return "";
  }
  const pushes = commit.checkSuites.map((suite) => suite.createdAt);
  return (
    [commit.committedDate, ...pushes].toSorted()[0] ?? commit.committedDate
  );
}

const pullSchema = z
  .object({
    number: z.number(),
    state: z.string(),
    isDraft: z.boolean(),
    headRefName: z.string(),
    baseRefName: z.string(),
    headRefOid: z.string(),
    commits: connection(
      z.object({
        commit: z.object({
          committedDate: z.string(),
          checkSuites: connection(z.object({ createdAt: z.string() })),
        }),
      }),
    ),
    reviews: connection(reviewSchema),
    comments: connection(issueCommentSchema),
    reviewThreads: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean() }),
      nodes: z.array(threadSchema),
    }),
  })
  .transform((pull) => ({
    number: pull.number,
    state: pull.state,
    isDraft: pull.isDraft,
    head: pull.headRefName,
    base: pull.baseRefName,
    headSha: pull.headRefOid,
    activitySince: readActivitySince(pull.commits[0]?.commit),
    threadsTruncated: pull.reviewThreads.pageInfo.hasNextPage,
    reviews: pull.reviews,
    issueComments: pull.comments,
    threads: pull.reviewThreads.nodes,
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
