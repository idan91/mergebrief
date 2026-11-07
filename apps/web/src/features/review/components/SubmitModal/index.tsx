import type { ReviewOutcome } from "types/reviews";
import type { ReactNode } from "react";
import clsx from "clsx";

import { Modal } from "@web/components/Modal";
import type { MentionSource } from "@web/features/conversation/types";
import { type Receipt } from "../../utils/receipt";
import { type UnresolvedItem } from "../../utils/state";
import { AdvisoryView } from "./AdvisoryView";
import { ReceiptView } from "./ReceiptView";
import { useSubmitModalFacade } from "./useSubmitModalFacade";
import { VerdictView } from "./VerdictView";
import styles from "./SubmitModal.module.scss";

export interface SubmitModalProps {
  open: boolean;
  close: () => void;
  receipt: Receipt;
  outcome: ReviewOutcome | undefined;
  setOutcome: (outcome: ReviewOutcome) => void;
  submit: () => void;
  /**
   * The pre-submit advisory list: nonempty at open → the modal lands on the
   * advisory view first. Captured at open, so items resolving mid-flow don't
   * reshuffle the view.
   */
  unresolvedItems: UnresolvedItem[];
  /** Closes the whole modal and jumps the page to the item (screen-owned). */
  jumpToItem: (item: UnresolvedItem) => void;
  /** Live submit in flight, the control disables, focusably. */
  submitPending?: boolean;
  /**
   * Screen-owned reason Submit must not run regardless of content (read-only
   * posture), wins over the live content rule.
   */
  blockedReasonOverride?: string | undefined;
  /**
   * The live content rule evaluated against the current review-comment draft,
   * this component subscribes to the draft and re-derives per keystroke so
   * the owning screen doesn't have to. Absent on the local demo path.
   */
  blockedReasonWith?:
    | ((reviewComment: string) => string | undefined)
    | undefined;
  /** The last submit failure, announced assertively. */
  submitError?: string | null;
  /** Persistent post-submit note (anchoring degradation). */
  submitNote?: string | null;
  /** The signature line the submit posts; absent on the local demo path. */
  signatureLine?: string | undefined;
  /**
   * The viewed span's head is no longer the PR head: Submit requires the
   * explicit ack below. Evaluated live, a poll tick may flip it while the
   * modal is open.
   */
  staleHead?: boolean;
  /** Where the review body's mention suggestions come from; absent turns them off. */
  mentionSource?: MentionSource | undefined;
}

export function SubmitModal({
  open,
  close,
  receipt,
  outcome,
  setOutcome,
  submit,
  unresolvedItems,
  jumpToItem,
  submitPending = false,
  blockedReasonOverride,
  blockedReasonWith,
  submitError = null,
  submitNote = null,
  signatureLine,
  staleHead = false,
  mentionSource,
}: SubmitModalProps) {
  const facade = useSubmitModalFacade({
    open,
    unresolvedItems,
    submit,
    submitPending,
    blockedReasonOverride,
    blockedReasonWith,
    submitError,
    submitNote,
    staleHead,
  });
  const { view, headingRef, reasonShown, submitAffordance } = facade;
  const boxClassName = clsx(
    styles["submitBox"],
    view === "receipt" && styles["receiptBox"],
  );

  let content: ReactNode;
  if (view === "advisory") {
    content = (
      <AdvisoryView
        headingRef={headingRef}
        items={facade.advisoryItems}
        jumpToItem={jumpToItem}
        close={close}
        continueToVerdict={facade.showVerdict}
      />
    );
  } else if (view === "verdict") {
    content = (
      <VerdictView
        headingRef={headingRef}
        outcomeGroupName={facade.outcomeGroupName}
        outcome={outcome}
        setOutcome={setOutcome}
        reviewComment={facade.reviewComment}
        setReviewComment={facade.setReviewComment}
        stale={facade.staleAck}
        submit={submitAffordance}
        status={facade.verdictStatus}
        reasonShown={reasonShown}
        close={close}
        previewReceipt={facade.showReceipt}
        mentionSource={mentionSource}
      />
    );
  } else {
    content = (
      <ReceiptView
        headingRef={headingRef}
        outcome={outcome}
        receipt={receipt}
        signatureLine={signatureLine}
        submit={submitAffordance}
        status={facade.receiptStatus}
        reasonShown={reasonShown}
        staleWarning={facade.receiptStaleWarning}
        close={close}
        backToVerdict={facade.showVerdict}
      />
    );
  }

  return (
    <Modal
      open={open}
      boxClassName={boxClassName}
      close={close}
      labelledBy="submit-modal-heading"
    >
      {content}
    </Modal>
  );
}
