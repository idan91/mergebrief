import type { ReviewOutcome } from "types/reviews";
import { useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { Checkbox } from "@web/components/Checkbox";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea";
import { MentionListLayouts } from "@web/components/MarkdownTextarea/types";
import { hasUploadPlaceholder } from "@web/components/MarkdownTextarea/utils";
import { Modal } from "@web/components/Modal";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { useMentionSuggestions } from "@web/features/conversation/hooks";
import type { MentionSource } from "@web/features/conversation/types";
import { useReviewActions } from "../../session/flow/provider";
import { reviewOutcomeLabel } from "../../utils/state";
import styles from "./SubmitModal.module.scss";

const OUTCOMES: readonly ReviewOutcome[] = [
  "comment",
  "approve",
  "request-changes",
];

/** The staleness gate: a moved head needs fresh consent before Submit reopens. */
interface StaleAck {
  head: boolean;
  acked: boolean;
  setAcked: (acked: boolean) => void;
}

/** Everything the Submit control needs, including why it is off. */
interface SubmitAffordance {
  disabled: boolean;
  pending: boolean;
  describedBy: string | undefined;
  attempt: () => void;
}

/** The three mutually-ranked status lines above the actions row. */
interface SubmitStatus {
  blockedReason: string | undefined;
  error: string | null;
  note: string | null;
}

export interface VerdictViewProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  outcomeGroupName: string;
  outcome: ReviewOutcome | undefined;
  setOutcome: (outcome: ReviewOutcome) => void;
  reviewComment: string;
  setReviewComment: (comment: string) => void;
  stale: StaleAck;
  submit: SubmitAffordance;
  status: SubmitStatus;
  /** Someone has tried Submit, so its blocked reason shows. */
  reasonShown: boolean;
  close: () => void;
  previewReceipt: () => void;
  mentionSource?: MentionSource | undefined;
}

export function VerdictView({
  headingRef,
  outcomeGroupName,
  outcome,
  setOutcome,
  reviewComment,
  setReviewComment,
  stale,
  submit,
  status,
  reasonShown,
  close,
  previewReceipt,
  mentionSource,
}: VerdictViewProps) {
  const { t } = useTranslation();
  const { announce, announceQuietly } = useReviewActions();
  const mentions = useMentionSuggestions(mentionSource);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const editComment = (comment: string) => {
    setReviewComment(comment);
    setAttachError(undefined);
  };
  // The modal refuses a body that still holds a placeholder, since it would
  // ship in place of the image; saying so is this view's.
  const attemptSubmit = () => {
    if (hasUploadPlaceholder(reviewComment)) {
      setAttachError(t("shell.attach.waitForUpload"));
    }
    submit.attempt();
  };
  const showsNote = status.note !== null && status.error === null;

  let blockedLine: ReactNode = null;
  if (status.blockedReason !== undefined) {
    blockedLine = reasonShown ? (
      <p className={styles["submitStatus"]} id="submit-modal-blocked">
        {status.blockedReason}
      </p>
    ) : (
      <ScreenReaderOnly id="submit-modal-blocked">
        {status.blockedReason}
      </ScreenReaderOnly>
    );
  }

  return (
    <>
      <Modal.Header
        close={close}
        detail={t("review.submit.intro")}
        headingRef={headingRef}
        id="submit-modal-heading"
        title={t("review.submit.heading")}
      />
      <fieldset className={styles["outcomes"]}>
        <legend>{t("review.submit.outcomeLegend")}</legend>
        {OUTCOMES.map((option) => (
          <label
            className={styles["outcome"]}
            data-state={outcome === option ? "active" : undefined}
            key={option}
          >
            <input
              checked={outcome === option}
              name={outcomeGroupName}
              type="radio"
              value={option}
              onChange={() => setOutcome(option)}
            />
            {reviewOutcomeLabel(t, option)}
          </label>
        ))}
      </fieldset>
      <MarkdownTextarea
        value={reviewComment}
        onChange={editComment}
        label={t("review.submit.commentLabel")}
        labelVisible
        placeholder={t("review.submit.commentPlaceholder")}
        mentionSuggestions={mentions.mentionSuggestions}
        onMentionQueryChange={mentions.onMentionQueryChange}
        mentionListLayout={MentionListLayouts.FLOATING}
        announce={announce}
        announceQuietly={announceQuietly}
        onAttachError={setAttachError}
        onSubmit={attemptSubmit}
      />
      {attachError !== undefined ? (
        <p className={styles["submitStatus"]} data-kind="error" role="alert">
          {attachError}
        </p>
      ) : null}
      {stale.head ? (
        <div className={styles["staleWarning"]}>
          {/* The live region and describedby target is the TEXT alone,
              a live region wrapping the checkbox would re-announce the
              control on every state change. */}
          <p id="submit-modal-stale-warning" role="status">
            {t("review.submit.staleWarning")}
          </p>
          <div className={styles["staleAck"]}>
            <Checkbox checked={stale.acked} onChange={stale.setAcked}>
              {t("review.submit.staleAck")}
            </Checkbox>
          </div>
        </div>
      ) : null}
      <Modal.Footer
        reason={
          <>
            {blockedLine}
            {status.error !== null ? (
              <p
                className={styles["submitStatus"]}
                data-kind="error"
                id="submit-modal-error"
                role="alert"
              >
                {status.error}
              </p>
            ) : null}
            {showsNote ? (
              <p
                aria-live="polite"
                className={styles["submitStatus"]}
                role="status"
              >
                {status.note}
              </p>
            ) : null}
          </>
        }
      >
        <Button onClick={previewReceipt}>
          {t("review.submit.previewReceipt")}
        </Button>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
        <Button
          aria-describedby={submit.describedBy}
          aria-disabled={submit.disabled ? true : undefined}
          loading={submit.pending}
          variant="accent"
          onClick={attemptSubmit}
        >
          {submit.pending
            ? t("review.submit.submitting")
            : t("review.submit.submitReview")}
        </Button>
      </Modal.Footer>
    </>
  );
}
