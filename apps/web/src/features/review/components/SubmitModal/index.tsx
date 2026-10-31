import type { ReviewOutcome } from "types/reviews";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

import { Modal } from "@web/components/Modal";
import type { MentionSource } from "@web/features/conversation/types";
import { useReviewActions, useReviewFlow } from "../../session/flow/provider";
import { type Receipt } from "../../utils/receipt";
import { type UnresolvedItem } from "../../utils/state";
import { AdvisoryView } from "./AdvisoryView";
import { ReceiptView } from "./ReceiptView";
import { VerdictView } from "./VerdictView";
import styles from "./SubmitModal.module.scss";

/** The modal's in-flow position: verdict is the default, receipt a preview
 * one step away, advisory a conditional first stop with no way back to it. */
type SubmitView = "advisory" | "verdict" | "receipt";

/** The id of the text explaining why Submit is off; the first reason wins. */
function deriveSubmitDescribedBy(
  blockedReason: string | undefined,
  staleUnacked: boolean,
  submitError: string | null,
): string | undefined {
  if (blockedReason !== undefined) {
    return "submit-modal-blocked";
  }
  if (staleUnacked) {
    return "submit-modal-stale-warning";
  }
  if (submitError !== null) {
    return "submit-modal-error";
  }
  return undefined;
}

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
  const outcomeGroupName = useId();
  const reviewComment = useReviewFlow((state) => state.reviewComment);
  const { setReviewComment } = useReviewActions();

  // Reset modal view and stale acknowledgment on open; store data survives close.
  // Returning staleness requires fresh consent even while the modal stays open.
  // Lazy initializers also cover mounting open, without an open transition.
  const [view, setView] = useState<SubmitView>(() =>
    open && unresolvedItems.length > 0 ? "advisory" : "verdict",
  );
  const [ackStale, setAckStale] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const [wasStale, setWasStale] = useState(staleHead);
  // Advisory items are CAPTURED at open: a live list would let a mid-flow
  // refetch reshuffle the view under the reviewer.
  const [advisoryItems, setAdvisoryItems] = useState<UnresolvedItem[]>(() =>
    open ? unresolvedItems : [],
  );
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const prevViewRef = useRef(view);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const entryView = unresolvedItems.length > 0 ? "advisory" : "verdict";
      setView(entryView);
      setAdvisoryItems(unresolvedItems);
      setAckStale(false);
      // Also reset the focus-effect's view memory: reopening after a receipt
      // preview must NOT read as a view switch, or the heading focus below
      // would steal the Modal's own open-focus claim on the dialog box.
      prevViewRef.current = entryView;
    }
  }
  if (staleHead !== wasStale) {
    setWasStale(staleHead);
    if (staleHead) {
      setAckStale(false);
    }
  }

  // An in-modal view switch unmounts the control that carried focus; move it
  // to the new view's heading so the switch is announced and the Tab cycle
  // restarts from the top. Open itself is the Modal's focus claim, not ours.
  useEffect(() => {
    if (open && prevViewRef.current !== view) {
      headingRef.current?.focus();
    }
    prevViewRef.current = view;
  }, [open, view]);

  const blockedReason =
    blockedReasonOverride ?? blockedReasonWith?.(reviewComment);
  // Focusable-disabled (aria-disabled, not the disabled attribute): keyboard
  // and screen-reader users can reach the control and hear WHY it is off via
  // the described-by reason text.
  const staleUnacked = staleHead && !ackStale;
  const submitDisabled =
    submitPending || blockedReason !== undefined || staleUnacked;
  const submitDescribedBy = deriveSubmitDescribedBy(
    blockedReason,
    staleUnacked,
    submitError,
  );
  const attemptSubmit = () => {
    if (!submitDisabled) {
      submit();
    }
  };

  let content: ReactNode;
  if (view === "advisory") {
    content = (
      <AdvisoryView
        headingRef={headingRef}
        items={advisoryItems}
        jumpToItem={jumpToItem}
        close={close}
        continueToVerdict={() => setView("verdict")}
      />
    );
  } else if (view === "verdict") {
    content = (
      <VerdictView
        headingRef={headingRef}
        outcomeGroupName={outcomeGroupName}
        outcome={outcome}
        setOutcome={setOutcome}
        reviewComment={reviewComment}
        setReviewComment={setReviewComment}
        stale={{ head: staleHead, acked: ackStale, setAcked: setAckStale }}
        submit={{
          disabled: submitDisabled,
          pending: submitPending,
          describedBy: submitDescribedBy,
          attempt: attemptSubmit,
        }}
        status={{ blockedReason, error: submitError, note: submitNote }}
        close={close}
        previewReceipt={() => setView("receipt")}
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
        close={close}
        backToVerdict={() => setView("verdict")}
      />
    );
  }

  return (
    <Modal
      open={open}
      boxClassName={clsx(
        styles["submitBox"],
        view === "receipt" && styles["receiptBox"],
      )}
      close={close}
      labelledBy="submit-modal-heading"
    >
      {content}
    </Modal>
  );
}
