// One review thread attached to a PENDING review through GraphQL: the only
// surface that anchors a FILE comment (REST's grouped comments[] drops
// subject_type). A rejected anchor arrives two ways and both fold: HTTP 200
// with `thread: null`, or a thrown GraphQL error typed UNPROCESSABLE.
import type { Octokit } from "octokit";
import { z } from "zod/v4";
import {
  GitHubApiErrorCodes,
  hasOnlyGraphqlErrorType,
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result, ValueOf } from "types/utils";

/** GitHub wire values for a review comment's diff side. */
export const ReviewCommentSides = {
  LEFT: "LEFT",
  RIGHT: "RIGHT",
} as const;
export type ReviewCommentSide = ValueOf<typeof ReviewCommentSides>;

/** What a review comment anchors to; file comments omit line and side. */
export const ReviewSubjectTypes = {
  LINE: "line",
  FILE: "file",
} as const;
export type ReviewSubjectType = ValueOf<typeof ReviewSubjectTypes>;

/** GraphQL's `PullRequestReviewThreadSubjectType` casing for our vocabulary. */
const SubjectTypeOnWire: Readonly<Record<ReviewSubjectType, string>> = {
  [ReviewSubjectTypes.LINE]: "LINE",
  [ReviewSubjectTypes.FILE]: "FILE",
};

interface ReviewThreadBase {
  /** The pending review's GraphQL node id. */
  readonly reviewNodeId: string;
  readonly path: string;
  readonly body: string;
}

export interface LineReviewThreadInput extends ReviewThreadBase {
  readonly subjectType: typeof ReviewSubjectTypes.LINE;
  /** The anchor line (the END line for a multi-line comment). */
  readonly line: number;
  readonly side: ReviewCommentSide;
  /** First line of a multi-line comment; omit for single-line. */
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
}

export interface FileReviewThreadInput extends ReviewThreadBase {
  readonly subjectType: typeof ReviewSubjectTypes.FILE;
}

export type AddReviewThreadInput =
  | LineReviewThreadInput
  | FileReviewThreadInput;

export interface ReviewThread {
  /** The thread's GraphQL node id. */
  readonly threadId: string;
}

const CONTEXT = "add pull request review thread";
const REJECTED_ANCHOR_TYPE = "UNPROCESSABLE";

const ADD_THREAD_MUTATION = `
mutation AddPullRequestReviewThread($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread {
      id
    }
  }
}`;

const mutationResponseSchema = z.object({
  addPullRequestReviewThread: z
    .object({
      thread: z.object({ id: z.string() }).nullable(),
    })
    .nullable(),
});

interface ThreadMutationInput {
  pullRequestReviewId: string;
  path: string;
  body: string;
  subjectType: string;
  line?: number;
  side?: ReviewCommentSide;
  startLine?: number;
  startSide?: ReviewCommentSide;
}

/** The mutation input on the wire; the start pair rides only on ranges. */
function shapeThreadMutationInput(
  input: AddReviewThreadInput,
): ThreadMutationInput {
  const variables: ThreadMutationInput = {
    pullRequestReviewId: input.reviewNodeId,
    path: input.path,
    body: input.body,
    subjectType: SubjectTypeOnWire[input.subjectType],
  };
  if (input.subjectType === ReviewSubjectTypes.FILE) {
    return variables;
  }

  variables.line = input.line;
  variables.side = input.side;
  if (input.startLine !== undefined) {
    variables.startLine = input.startLine;
  }
  if (input.startSide !== undefined) {
    variables.startSide = input.startSide;
  }
  return variables;
}

function shapeAnchorRejection(): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.ANCHOR_REJECTED,
    message: `failed to ${CONTEXT}: GitHub rejected the anchor`,
  };
}

/**
 * Attach one thread, line or file, to a pending review, authored by whoever
 * the octokit's token identifies. A rejected anchor answers
 * `anchor-rejected` whether GitHub voids the payload or throws an
 * UNPROCESSABLE entry, the one failure a caller folds instead of aborting on.
 */
export async function addPullRequestReviewThread(
  octokit: Octokit,
  input: AddReviewThreadInput,
): Promise<Result<ReviewThread, GitHubApiError>> {
  let response: unknown;
  try {
    response = await octokit.graphql(ADD_THREAD_MUTATION, {
      input: shapeThreadMutationInput(input),
    });
  } catch (error) {
    if (hasOnlyGraphqlErrorType(error, REJECTED_ANCHOR_TYPE)) {
      return { ok: false, error: shapeAnchorRejection() };
    }
    return { ok: false, error: mapGraphqlError(error, CONTEXT) };
  }

  const parsed = mutationResponseSchema.safeParse(response);
  const payload = parsed.success
    ? parsed.data.addPullRequestReviewThread
    : null;
  if (payload === null) {
    return { ok: false, error: unexpectedResponseError(CONTEXT) };
  }
  if (payload.thread === null) {
    return { ok: false, error: shapeAnchorRejection() };
  }
  return { ok: true, value: { threadId: payload.thread.id } };
}
