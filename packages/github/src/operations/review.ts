// Pin formal reviews to the viewed commit. GitHub creation is atomic: one invalid comment
// rejects the whole review. Distinguish anchoring from unknown-commit 422s internally;
// only sanitized text and the derived class may leave this boundary.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result, ValueOf } from "../types";

/** GitHub wire values for the review `event`, not our kebab-case vocabulary. */
export const ReviewEvents = {
  APPROVE: "APPROVE",
  REQUEST_CHANGES: "REQUEST_CHANGES",
  COMMENT: "COMMENT",
} as const;
export type ReviewEvent = ValueOf<typeof ReviewEvents>;

/** GitHub wire values for a review comment's diff side. */
export const ReviewCommentSides = {
  LEFT: "LEFT",
  RIGHT: "RIGHT",
} as const;
export type ReviewCommentSide = ValueOf<typeof ReviewCommentSides>;

/** GitHub `subject_type` on a review comment. File comments omit line and side. */
export const ReviewSubjectTypes = {
  LINE: "line",
  FILE: "file",
} as const;
export type ReviewSubjectType = ValueOf<typeof ReviewSubjectTypes>;

export interface LineReviewCommentInput {
  readonly path: string;
  /** The anchor line (the END line for a multi-line comment). */
  readonly line: number;
  readonly side: ReviewCommentSide;
  /** First line of a multi-line comment; omit for single-line. */
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
  readonly body: string;
}

export interface FileReviewCommentInput {
  readonly path: string;
  readonly body: string;
  readonly subjectType: typeof ReviewSubjectTypes.FILE;
}

export type ReviewCommentInput =
  | LineReviewCommentInput
  | FileReviewCommentInput;

export interface CreatePullRequestReviewInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  /** The reviewed head, pins anchors to the diff the reviewer saw. */
  readonly commitId: string;
  readonly event: ReviewEvent;
  readonly body?: string;
  readonly comments?: readonly ReviewCommentInput[];
}

/**
 * The 422 classes the submit route reacts to differently: `unknown-commit` →
 * fail closed; `invalid-comments` → one degradation retry with comments folded
 * into the body; `unknown` → a plain failure. Classification is best-effort
 * over the response text, GitHub exposes no stable discriminator.
 */
export const ReviewValidationClasses = {
  UNKNOWN_COMMIT: "unknown-commit",
  INVALID_COMMENTS: "invalid-comments",
  UNKNOWN: "unknown",
} as const;
export type ReviewValidationClass = ValueOf<typeof ReviewValidationClasses>;

export interface CreateReviewError extends GitHubApiError {
  /** Present only when GitHub returned a 422. */
  readonly validation?: ReviewValidationClass;
}

// GitHub's 422 body: top-level `message` plus an `errors` array whose entries
// are strings ("Pull request review thread line must be part of the diff") or
// objects ({ resource, code, field }). Parsed loosely, an unparseable body
// just classifies as `unknown`.
const validationBodySchema = z.object({
  message: z.string().optional(),
  errors: z
    .array(
      z.union([
        z.string(),
        z.object({
          field: z.string().optional(),
          message: z.string().optional(),
        }),
      ]),
    )
    .optional(),
});

const COMMIT_HINT = /commit/i;
const COMMENT_HINT = /\b(path|line|position|side|thread|diff)\b/i;

function classifyValidation422(error: RequestError): ReviewValidationClass {
  const parsed = validationBodySchema.safeParse(error.response?.data);
  if (!parsed.success) {
    return ReviewValidationClasses.UNKNOWN;
  }
  const texts: string[] = [];
  // The top-level message can be the ONLY signal, e.g. an unknown SHA is
  // reported as { message: "No commit found for SHA: …", errors: [] }.
  if (parsed.data.message !== undefined) {
    texts.push(parsed.data.message);
  }
  for (const entry of parsed.data.errors ?? []) {
    if (typeof entry === "string") {
      texts.push(entry);
    } else {
      if (entry.field !== undefined) texts.push(entry.field);
      if (entry.message !== undefined) texts.push(entry.message);
    }
  }
  // Commit takes priority: an unknown commit invalidates every anchor too,
  // and retrying anchors against a vanished SHA can never succeed.
  if (texts.some((text) => COMMIT_HINT.test(text))) {
    return ReviewValidationClasses.UNKNOWN_COMMIT;
  }
  if (texts.some((text) => COMMENT_HINT.test(text))) {
    return ReviewValidationClasses.INVALID_COMMENTS;
  }
  return ReviewValidationClasses.UNKNOWN;
}

type CreateReviewParams = NonNullable<
  Parameters<Octokit["rest"]["pulls"]["createReview"]>[0]
>;
type ReviewCommentParams = NonNullable<CreateReviewParams["comments"]>[number];
type FileReviewCommentParams = ReviewCommentParams & {
  subject_type: typeof ReviewSubjectTypes.FILE;
};

function isFileReviewComment(
  comment: ReviewCommentInput,
): comment is FileReviewCommentInput {
  return (
    "subjectType" in comment && comment.subjectType === ReviewSubjectTypes.FILE
  );
}

/** One grouped-review comment on the wire; the start pair rides only on ranges. */
function shapeReviewCommentParams(
  comment: ReviewCommentInput,
): ReviewCommentParams {
  if (isFileReviewComment(comment)) {
    const params: FileReviewCommentParams = {
      path: comment.path,
      body: comment.body,
      subject_type: ReviewSubjectTypes.FILE,
    };
    return params;
  }
  const params: ReviewCommentParams = {
    path: comment.path,
    line: comment.line,
    side: comment.side,
    body: comment.body,
  };

  if (comment.startLine !== undefined) params.start_line = comment.startLine;
  if (comment.startSide !== undefined) params.start_side = comment.startSide;

  return params;
}

/**
 * Create one grouped formal review on a PR, authored by whoever the octokit's
 * token identifies. A 422 additionally carries its `ReviewValidationClass`.
 */
export async function createPullRequestReview(
  octokit: Octokit,
  input: CreatePullRequestReviewInput,
): Promise<Result<{ readonly reviewId: bigint }, CreateReviewError>> {
  const params: CreateReviewParams = {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.prNumber,
    commit_id: input.commitId,
    event: input.event,
  };

  if (input.body !== undefined) params.body = input.body;
  if (input.comments !== undefined) {
    params.comments = input.comments.map(shapeReviewCommentParams);
  }

  try {
    const response = await octokit.rest.pulls.createReview(params);
    // JSON.parse rounds ints past 2^53 before we see them.
    if (!Number.isSafeInteger(response.data.id)) {
      return {
        ok: false,
        error: unexpectedResponseError("create pull request review"),
      };
    }
    return { ok: true, value: { reviewId: BigInt(response.data.id) } };
  } catch (error) {
    const sanitized = mapRequestError(error, "create pull request review");
    if (error instanceof RequestError && error.status === 422) {
      return {
        ok: false,
        error: { ...sanitized, validation: classifyValidation422(error) },
      };
    }
    return { ok: false, error: sanitized };
  }
}
