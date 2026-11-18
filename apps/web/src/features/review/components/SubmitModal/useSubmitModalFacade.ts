import { useId } from "react";
import { useTranslation } from "react-i18next";

import { useReviewActions, useReviewFlow } from "../../session/flow/provider";
import type { UnresolvedItem } from "../../utils/state";
import { usePerOpenState } from "./usePerOpenState";
import { deriveSubmitGate } from "./utils";

export interface SubmitModalFacadeParams {
  open: boolean;
  unresolvedItems: UnresolvedItem[];
  submit: () => void;
  submitPending: boolean;
  blockedReasonOverride: string | undefined;
  blockedReasonWith:
    | ((reviewComment: string) => string | undefined)
    | undefined;
  submitError: string | null;
  submitNote: string | null;
  staleHead: boolean;
}

/** The modal's per-open view state, the review comment draft and the Submit gate. */
export function useSubmitModalFacade({
  open,
  unresolvedItems,
  submit,
  submitPending,
  blockedReasonOverride,
  blockedReasonWith,
  submitError,
  submitNote,
  staleHead,
}: SubmitModalFacadeParams) {
  const { t } = useTranslation();
  const outcomeGroupName = useId();
  const reviewComment = useReviewFlow((state) => state.reviewComment);
  const { setReviewComment, announceQuietly } = useReviewActions();
  const perOpen = usePerOpenState(open, unresolvedItems, staleHead);
  const { view, setView, ackStale, setAckStale, setSubmitTried } = perOpen;

  const staleUnacked = staleHead && !ackStale;
  const gate = deriveSubmitGate({
    reviewComment,
    blockedReasonOverride,
    blockedReasonWith,
    staleUnacked,
    submitPending,
    submitError,
    submitNote,
    copy: {
      uploadPending: t("shell.attach.waitForUpload"),
      receiptUploadPending: t("review.submit.receiptUploadPending"),
      staleWarning: t("review.submit.staleWarning"),
      receiptStaleWarning: t("review.submit.receiptStaleWarning"),
    },
  });
  const refusal =
    view === "receipt" ? gate.receiptRefusal : gate.verdictRefusal;

  // A refused try says why each time; the shown reason is no live region.
  const attemptSubmit = () => {
    setSubmitTried(true);
    if (!gate.disabled) {
      submit();
    } else if (refusal !== undefined) {
      announceQuietly(refusal);
    }
  };

  return {
    view,
    headingRef: perOpen.headingRef,
    advisoryItems: perOpen.advisoryItems,
    reasonShown: perOpen.submitTried,
    outcomeGroupName,
    reviewComment,
    setReviewComment,
    staleAck: { head: staleHead, acked: ackStale, setAcked: setAckStale },
    submitAffordance: {
      disabled: gate.disabled,
      pending: submitPending,
      describedBy: gate.describedBy,
      attempt: attemptSubmit,
    },
    verdictStatus: gate.verdictStatus,
    receiptStatus: gate.receiptStatus,
    receiptStaleWarning: gate.receiptStaleWarning,
    showVerdict: () => setView("verdict"),
    showReceipt: () => setView("receipt"),
  };
}
