import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

import { Button } from "@web/components/Button/Button";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import { MarkdownTextareaFrames } from "@web/components/MarkdownTextarea/types";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import { reviewOutcomeLabel, type ReviewOutcome } from "../../utils/state";
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

/** The three mutually-ranked status lines under the actions row. */
interface SubmitStatus {
  blockedReason: string | undefined;
  error: string | null;
  note: string | null;
}

export interface VerdictViewProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  outcomeGroupName: string;
  outcome: ReviewOutcome;
  setOutcome: (outcome: ReviewOutcome) => void;
  reviewComment: string;
  setReviewComment: (comment: string) => void;
  stale: StaleAck;
  submit: SubmitAffordance;
  status: SubmitStatus;
  close: () => void;
  previewReceipt: () => void;
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
  close,
  previewReceipt,
}: VerdictViewProps) {
  const { t } = useTranslation();
  return (
    <>
      <h2 id="submit-modal-heading" ref={headingRef} tabIndex={-1}>
        {t("review.submit.heading")}
      </h2>
      <p className={modalStyles["copy"]}>{t("review.submit.intro")}</p>
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
        frame={MarkdownTextareaFrames.CARD}
        value={reviewComment}
        onChange={setReviewComment}
        label={t("review.submit.commentLabel")}
        labelVisible
        placeholder={t("review.submit.commentPlaceholder")}
        describedBy="submit-modal-comment-hint"
        onSubmit={submit.attempt}
      />
      <p className={styles["hint"]} id="submit-modal-comment-hint">
        {t("review.submit.commentHint")}
      </p>
      {stale.head ? (
        <div className={styles["staleWarning"]}>
          {/* The live region and describedby target is the TEXT alone,
              a live region wrapping the checkbox would re-announce the
              control on every state change. */}
          <p id="submit-modal-stale-warning" role="status">
            {t("review.submit.staleWarning")}
          </p>
          <label className={styles["staleAck"]}>
            <input
              checked={stale.acked}
              onChange={(event) => {
                stale.setAcked(event.target.checked);
              }}
              type="checkbox"
            />
            {t("review.submit.staleAck")}
          </label>
        </div>
      ) : null}
      <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
        <Button onClick={previewReceipt}>
          {t("review.submit.previewReceipt")}
        </Button>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
        <Button
          aria-describedby={submit.describedBy}
          disabled={submit.disabled}
          loading={submit.pending}
          variant="accent"
          onClick={submit.attempt}
        >
          {submit.pending
            ? t("review.submit.submitting")
            : t("review.submit.submitReview")}
        </Button>
      </div>
      {status.blockedReason !== undefined ? (
        <p className={styles["submitStatus"]} id="submit-modal-blocked">
          {status.blockedReason}
        </p>
      ) : null}
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
      {status.note !== null && status.error === null ? (
        <p aria-live="polite" className={styles["submitStatus"]} role="status">
          {status.note}
        </p>
      ) : null}
    </>
  );
}
