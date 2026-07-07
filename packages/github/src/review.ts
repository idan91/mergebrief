// Review-submit primitive (BRIEF-23): create one formal, grouped pull-request
// review — `POST /repos/{owner}/{repo}/pulls/{n}/reviews` — pinned to the
// commit the reviewer actually read (`commit_id`, never head-at-delivery).
// GitHub's create-review is ATOMIC: one invalid comment 422s the whole review.
// The route's degradation retry needs to tell an anchoring 422 apart from an
// unknown-commit 422, so this module classifies the 422 body INTERNALLY (the
// body itself, like every response body, never leaves `mapRequestError`'s
// sanitization — only the derived class does).
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "./errors";
import type { Result, ValueOf } from "./types";

/**
 * GitHub wire values for the review `event` (like `HANDLED_EVENT_NAMES`,
 * these are GitHub's literals, not our kebab-case vocabulary).
 */
export const ReviewEvent = {
  APPROVE: "APPROVE",
  REQUEST_CHANGES: "REQUEST_CHANGES",
  COMMENT: "COMMENT",
} as const;
export type ReviewEvent = ValueOf<typeof ReviewEvent>;

/** GitHub wire values for a review comment's diff side. */
export const ReviewCommentSide = {
  LEFT: "LEFT",
  RIGHT: "RIGHT",
} as const;
export type ReviewCommentSide = ValueOf<typeof ReviewCommentSide>;

export interface ReviewCommentInput {
  readonly path: string;
  /** The anchor line (the END line for a multi-line comment). */
  readonly line: number;
  readonly side: ReviewCommentSide;
  /** First line of a multi-line comment; omit for single-line. */
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
  readonly body: string;
}

export interface CreatePullRequestReviewInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  /** The reviewed head — pins anchors to the diff the reviewer saw. */
  readonly commitId: string;
  readonly event: ReviewEvent;
  readonly body?: string;
  readonly comments?: readonly ReviewCommentInput[];
}

/**
 * The 422 classes the submit route reacts to differently: `unknown-commit` →
 * fail closed ("PR was rewritten — reload"); `invalid-comments` → one
 * degradation retry with comments folded into the body; `unknown` → treat as
 * a plain failure. Classification is best-effort over GitHub's response text
 * — GitHub does not expose a stable machine-readable discriminator.
 */
export const ReviewValidationClass = {
  UNKNOWN_COMMIT: "unknown-commit",
  INVALID_COMMENTS: "invalid-comments",
  UNKNOWN: "unknown",
} as const;
export type ReviewValidationClass = ValueOf<typeof ReviewValidationClass>;

export interface CreateReviewError extends GitHubApiError {
  /** Present only when GitHub returned a 422. */
  readonly validation?: ReviewValidationClass;
}

// GitHub's 422 body: top-level `message` plus an `errors` array whose entries
// are strings ("Pull request review thread line must be part of the diff") or
// objects ({ resource, code, field }). Parsed loosely — an unparseable body
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
    return ReviewValidationClass.UNKNOWN;
  }
  const texts: string[] = [];
  // The top-level message can be the ONLY signal — e.g. an unknown SHA is
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
    return ReviewValidationClass.UNKNOWN_COMMIT;
  }
  if (texts.some((text) => COMMENT_HINT.test(text))) {
    return ReviewValidationClass.INVALID_COMMENTS;
  }
  return ReviewValidationClass.UNKNOWN;
}

/**
 * Create one grouped formal review on a PR, authored by whoever the octokit's
 * token identifies (the viewer's user-to-server token — ADR 0016 #4). Returns
 * the created review's id. Failures are sanitized via `mapRequestError`; a
 * 422 additionally carries its `ReviewValidationClass`.
 */
export async function createPullRequestReview(
  octokit: Octokit,
  input: CreatePullRequestReviewInput,
): Promise<Result<{ readonly reviewId: bigint }, CreateReviewError>> {
  try {
    const response = await octokit.rest.pulls.createReview({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      commit_id: input.commitId,
      event: input.event,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.comments === undefined
        ? {}
        : {
            comments: input.comments.map((comment) => ({
              path: comment.path,
              line: comment.line,
              side: comment.side,
              ...(comment.startLine === undefined
                ? {}
                : { start_line: comment.startLine }),
              ...(comment.startSide === undefined
                ? {}
                : { start_side: comment.startSide }),
              body: comment.body,
            })),
          }),
    });
    // Same precision guard as comments.ts: JSON.parse rounds ints past 2^53.
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
