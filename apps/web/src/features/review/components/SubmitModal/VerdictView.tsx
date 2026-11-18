import type { ReviewOutcome } from "types/reviews";
import { useId, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { Checkbox } from "@web/components/Checkbox";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea";
import { MentionListLayouts } from "@web/components/MarkdownTextarea/types";
import { Modal } from "@web/components/Modal";
import { useMentionSuggestions } from "@web/features/conversation/hooks";
import type { MentionSource } from "@web/features/conversation/types";
import { useReviewActions } from "../../session/flow/provider";
import { reviewOutcomeLabel } from "../../utils/state";
import { SubmitButton } from "./SubmitButton";
import { SubmitStatusLines } from "./SubmitStatusLines";
import type { SubmitAffordance, SubmitStatus } from "./types";
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

  const attachErrorRepeatsReason =
    reasonShown && attachError === status.blockedReason;
  const attachErrorShown =
    attachError !== undefined && !attachErrorRepeatsReason;
  const attachErrorId = useId();

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
        ariaInvalid={attachErrorShown}
        describedBy={attachErrorShown ? attachErrorId : undefined}
        onAttachError={setAttachError}
        onSubmit={submit.attempt}
      />
      {attachErrorShown ? (
        <p
          className={styles["submitStatus"]}
          data-kind="error"
          id={attachErrorId}
          role="alert"
        >
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
        reason={<SubmitStatusLines reasonShown={reasonShown} status={status} />}
      >
        <Button onClick={previewReceipt}>
          {t("review.submit.previewReceipt")}
        </Button>
        <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
        <SubmitButton submit={submit} />
      </Modal.Footer>
    </>
  );
}
