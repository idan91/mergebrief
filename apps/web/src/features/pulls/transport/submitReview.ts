// The submit write. Expected failures are RESULT KINDS the submit flow
// renders: the fail-closed 409, the clean 401 re-login, upstream rejections.
import {
  ProductActionIds,
  type SubmitReviewBody,
  type SubmitReviewResponse,
} from "contract";
import { z } from "zod/v4";

import {
  SubmitReviewResultKinds,
  type SubmitReviewResult,
  type SubmitReviewResultKind,
} from "@web/features/review/utils";

import { ApiErrorCodes } from "../../../data/apiFetch";
import { readFailureKind, request } from "../../../data/request";
import type { WriteKindTable } from "../../../data/request/types";

type SubmitFailureKind = Exclude<
  SubmitReviewResultKind,
  typeof SubmitReviewResultKinds.SUBMITTED
>;

type SubmittedReview = Extract<
  SubmitReviewResult,
  { kind: typeof SubmitReviewResultKinds.SUBMITTED }
>;

// The orphaned anchor is its own refusal. A frozen session (pr-changed, what a
// codeless 409 synthesizes to) and a fail-closed unknown commit (pr-rewritten)
// both mean the read went stale. A 413 is deterministic: edit, never retry
// as-is. The proxy's 504 and a malformed 2xx mean the API may still post the
// review, so a retry could post it twice.
const SubmitKinds: WriteKindTable<SubmitFailureKind> = {
  [ApiErrorCodes.GITHUB_PERMISSION]: SubmitReviewResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: SubmitReviewResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.NOT_FOUND]: SubmitReviewResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: SubmitReviewResultKinds.INVALID,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: SubmitReviewResultKinds.INVALID,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: SubmitReviewResultKinds.INVALID,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: SubmitReviewResultKinds.ORPHANED_DRAFT,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]:
    SubmitReviewResultKinds.PUBLISH_PENDING,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]:
    SubmitReviewResultKinds.PUBLISH_IN_DOUBT,
  [ApiErrorCodes.PENDING_REVIEW_HELD]:
    SubmitReviewResultKinds.PENDING_REVIEW_HELD,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: SubmitReviewResultKinds.REWRITTEN,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: SubmitReviewResultKinds.REWRITTEN,
  [ApiErrorCodes.MALFORMED]: SubmitReviewResultKinds.INDETERMINATE,
  fallback: SubmitReviewResultKinds.UPSTREAM,
};

/** The receipt's counts; `commentsDegraded` is left for the CLI. */
export const submittedReviewSchema = z
  .object({
    reviewId: z.number(),
    commentsFolded: z.number(),
    commentsTotal: z.number(),
  })
  .transform(
    (receipt) =>
      ({
        kind: SubmitReviewResultKinds.SUBMITTED,
        ...receipt,
      }) satisfies SubmittedReview,
  ) satisfies z.ZodType<
  SubmittedReview,
  Omit<SubmitReviewResponse, "commentsDegraded">
>;

/**
 * The write NAMES its Brief, exactly as the session read did: resolving "the
 * newest Brief" would submit a stale tab against a revision it has never seen.
 */
export async function submitReview(
  repoId: string,
  prNumber: number,
  span: { base: string; head: string },
  body: SubmitReviewBody,
): Promise<SubmitReviewResult> {
  try {
    return await request(
      ProductActionIds.SUBMIT_REVIEW,
      {
        params: { repoId, prNumber },
        query: { base: span.base, head: span.head },
        body,
      },
      submittedReviewSchema,
    );
  } catch (error) {
    return { kind: readFailureKind(error, SubmitKinds) };
  }
}
