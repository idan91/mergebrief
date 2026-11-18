import type { TranslationKey } from "i18n";

export interface AwaitingDetailInput {
  readonly noLongerOpen: boolean;
  /** A draft under a drafts-off instance: only ready for review queues a run. */
  readonly awaitsReadyForReview: boolean;
}

/** A closed or merged PR promises nothing, whatever its draft state. */
export function readAwaitingDetailKey({
  noLongerOpen,
  awaitsReadyForReview,
}: AwaitingDetailInput): TranslationKey {
  if (noLongerOpen) {
    return "pulls.awaitingTrigger.notOpenCopy";
  }
  if (awaitsReadyForReview) {
    return "pulls.awaitingTrigger.readyForReviewCopy";
  }
  return "pulls.awaitingTrigger.copy";
}
