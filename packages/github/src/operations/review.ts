// Open a PENDING review pinned to the viewed commit. Threads attach through
// the GraphQL mutation in `review-thread.ts`; the verdict and body ride the
// submit mutation in `review-submit.ts`. Only sanitized text and the derived
// 422 class leave this boundary.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import { z } from "zod/v4";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result, ValueOf } from "types/utils";
import { HttpStatuses } from "types/http";

export interface CreatePullRequestReviewInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  /** The reviewed head, pins every thread to the diff the reviewer saw. */
  readonly commitId: string;
}

export interface PendingReview {
  /** REST id, what persistence joins own comments on. */
  readonly reviewId: bigint;
  /** GraphQL node id, what the thread and submit mutations take. */
  readonly reviewNodeId: string;
}

/**
 * The 422 classes the submit route reacts to differently: `unknown-commit`
 * fails closed; `pending-review-exists` clears the viewer's stale pending
 * review and retries once; `unknown` is a plain failure. Classification is
 * best-effort over the response text, GitHub exposes no stable discriminator.
 */
export const ReviewValidationClasses = {
  UNKNOWN_COMMIT: "unknown-commit",
  PENDING_REVIEW_EXISTS: "pending-review-exists",
  UNKNOWN: "unknown",
} as const;
export type ReviewValidationClass = ValueOf<typeof ReviewValidationClasses>;

export interface CreateReviewError extends GitHubApiError {
  /** Present only when GitHub returned a 422. */
  readonly validation?: ReviewValidationClass;
}

// GitHub's 422 body: top-level `message` plus an `errors` array whose entries
// are strings or objects ({ resource, code, field }). Parsed loosely, an
// unparseable body just classifies as `unknown`.
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
const PENDING_REVIEW_HINT = /pending review/i;

function collectValidationTexts(error: RequestError): string[] {
  const parsed = validationBodySchema.safeParse(error.response?.data);
  if (!parsed.success) {
    return [];
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
      if (entry.field !== undefined) {
        texts.push(entry.field);
      }
      if (entry.message !== undefined) {
        texts.push(entry.message);
      }
    }
  }
  return texts;
}

// The pending-review hint is the more specific one and wins: a body that
// names both is a stale pending review, and calling it an unknown commit
// would strand that review behind a fail-closed 409.
function classifyValidation422(error: RequestError): ReviewValidationClass {
  const texts = collectValidationTexts(error);
  if (texts.some((text) => PENDING_REVIEW_HINT.test(text))) {
    return ReviewValidationClasses.PENDING_REVIEW_EXISTS;
  }
  if (texts.some((text) => COMMIT_HINT.test(text))) {
    return ReviewValidationClasses.UNKNOWN_COMMIT;
  }
  return ReviewValidationClasses.UNKNOWN;
}

const CONTEXT = "create pull request review";

const pendingReviewResponseSchema = z.object({
  id: z.number(),
  node_id: z.string(),
});

/**
 * Open one PENDING review on a PR, authored by whoever the octokit's token
 * identifies. No event, body or comments ride the POST: threads and the
 * verdict follow through GraphQL. A 422 additionally carries its
 * `ReviewValidationClass`.
 */
export async function createPullRequestReview(
  octokit: Octokit,
  input: CreatePullRequestReviewInput,
): Promise<Result<PendingReview, CreateReviewError>> {
  try {
    const response = await octokit.rest.pulls.createReview({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      commit_id: input.commitId,
    });

    const parsed = pendingReviewResponseSchema.safeParse(response.data);
    // JSON.parse rounds ints past 2^53 before we see them.
    if (!parsed.success || !Number.isSafeInteger(parsed.data.id)) {
      return { ok: false, error: unexpectedResponseError(CONTEXT) };
    }
    return {
      ok: true,
      value: {
        reviewId: BigInt(parsed.data.id),
        reviewNodeId: parsed.data.node_id,
      },
    };
  } catch (error) {
    const sanitized = mapRequestError(error, CONTEXT);
    if (
      error instanceof RequestError &&
      error.status === HttpStatuses.UNPROCESSABLE_CONTENT
    ) {
      return {
        ok: false,
        error: { ...sanitized, validation: classifyValidation422(error) },
      };
    }
    return { ok: false, error: sanitized };
  }
}
