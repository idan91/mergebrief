import type { OwnDraftPlan, ReviewCapability } from "@web/features/brief";
import type {
  ReviewSessionPayload,
  SessionReadSource,
  SessionWrites,
} from "@web/features/review/session";
import type { SubmitReviewAction } from "@web/features/review/utils";
import type { PrSummary } from "../../../types";
import { MAIN_CONTENT_ID } from "@web/utils/main-content";

export interface PrReviewInput {
  submitReview: SubmitReviewAction;
  /** Base drift; wins over the session's reason. */
  readOnly: { reason: string } | undefined;
  staleHead: boolean;
  ownDraft: OwnDraftPlan | undefined;
  /** Absent while the read has not landed or has failed. */
  session: ReviewSessionPayload | undefined;
  sessionReads: SessionReadSource;
  writes: SessionWrites;
  sessionUnavailableReason: string;
  /** Whether the viewer wrote the PR: GitHub refuses their own Approve or Request changes. */
  meta: Pick<PrSummary, "viewerIsAuthor">;
}

/**
 * No session in hand closes writes, whether the read failed or has not
 * landed: a reviewer typing into a screen hiding their earlier drafts writes
 * the same comment twice.
 */
export function buildPrReview(input: PrReviewInput): ReviewCapability {
  const { session } = input;
  const review: ReviewCapability = {
    submitReview: input.submitReview,
    staleHead: input.staleHead,
    ownDraft: input.ownDraft,
    session,
    sessionReads: input.sessionReads,
    viewerIsAuthor: input.meta.viewerIsAuthor,
  };
  if (input.readOnly !== undefined) {
    review.readOnly = input.readOnly;
  }
  if (session === undefined) {
    review.readOnly ??= { reason: input.sessionUnavailableReason };
  } else {
    review.writes = input.writes;
  }

  return review;
}

/** Where focus lands when the brief's rows arrive after a timed-out read. */
export function findMainContent(): HTMLElement | null {
  return document.getElementById(MAIN_CONTENT_ID);
}
