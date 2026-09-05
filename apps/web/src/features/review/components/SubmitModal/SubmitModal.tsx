import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";

import { Button } from "@web/components/Button/Button";
import { RowButton } from "@web/components/RowButton/RowButton";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import { Modal } from "@web/components/Modal/Modal";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import { useReviewActions, useReviewFlow } from "../../session/flow/provider";
import { RECEIPT_NOT_CHECKED, type Receipt } from "../../utils/receipt";
import { ReceiptAccordion } from "./ReceiptAccordion/ReceiptAccordion";
import { shortFile } from "./utils";
import {
  reviewOutcomeLabel,
  type ReviewOutcome,
  type UnresolvedItem,
} from "../../utils/state";
import styles from "./SubmitModal.module.scss";

/** The modal's in-flow position: verdict is the default, receipt a preview
 * one step away, advisory a conditional first stop with no way back to it. */
type SubmitView = "advisory" | "verdict" | "receipt";

const OUTCOMES: readonly ReviewOutcome[] = [
  "comment",
  "approve",
  "request-changes",
];

export interface SubmitModalProps {
  open: boolean;
  close: () => void;
  receipt: Receipt;
  outcome: ReviewOutcome;
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
  /** Live submit in flight — the control disables, focusably. */
  submitPending?: boolean;
  /**
   * Screen-owned reason Submit must not run regardless of content (read-only
   * posture) — wins over the live content rule.
   */
  blockedReasonOverride?: string | undefined;
  /**
   * The live content rule evaluated against the current review-comment draft
   * — this component subscribes to the draft and re-derives per keystroke so
   * the owning screen doesn't have to. Absent on the local demo path.
   */
  blockedReasonWith?:
    | ((reviewComment: string) => string | undefined)
    | undefined;
  /** The last submit failure — announced assertively. */
  submitError?: string | null;
  /** Persistent post-submit note (anchoring degradation). */
  submitNote?: string | null;
  /**
   * The viewed span's head is no longer the PR head: Submit requires the
   * explicit ack below. Evaluated live — a poll tick may flip it while the
   * modal is open.
   */
  staleHead?: boolean;
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
  staleHead = false,
}: SubmitModalProps) {
  const { t } = useTranslation();
  const outcomeGroupName = useId();
  const reviewComment = useReviewFlow((state) => state.reviewComment);
  const { setReviewComment } = useReviewActions();

  // View position is modal-local and resets on open; data (outcome, draft)
  // lives in stores and survives close. The stale ack is deliberately NOT
  // sticky — reopening re-requires it, and so does staleness RETURNING while
  // the modal stays open: prior consent must not pre-authorize new staleness.
  // Lazy initializers cover a mounted-open modal (tests; the app mounts it
  // closed): the open-transition adjustment below only runs on transitions.
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
    if (staleHead) setAckStale(false);
  }

  // An in-modal view switch unmounts the control that carried focus; move it
  // to the new view's heading so the switch is announced and the Tab cycle
  // restarts from the top. Open itself is the Modal's focus claim, not ours.
  useEffect(() => {
    if (open && prevViewRef.current !== view) headingRef.current?.focus();
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
  const submitDescribedBy =
    blockedReason !== undefined
      ? "submit-modal-blocked"
      : staleUnacked
        ? "submit-modal-stale-warning"
        : submitError !== null
          ? "submit-modal-error"
          : undefined;
  const attemptSubmit = () => {
    if (!submitDisabled) submit();
  };

  return (
    <Modal
      open={open}
      boxClassName={styles["submitBox"]}
      close={close}
      labelledBy="submit-modal-heading"
    >
      {view === "advisory" ? (
        <>
          <h2 id="submit-modal-heading" ref={headingRef} tabIndex={-1}>
            {t("review.submit.beforeYouSubmit")}
          </h2>
          <p className={modalStyles["copy"]}>
            {t("review.submit.advisoryIntro")}
          </p>
          <div className={modalStyles["unresolvedList"]}>
            {advisoryItems.map((item) => (
              <RowButton
                key={item.id}
                variant="card"
                onClick={() => jumpToItem(item)}
              >
                <span>{unresolvedKindLabel(t, item.kind)}</span>
                <b>{item.label}</b>
              </RowButton>
            ))}
          </div>
          <p className={styles["hint"]}>
            {t("review.submit.jumpClosesDialog")}
          </p>
          <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
            <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
            <Button variant="primary" onClick={() => setView("verdict")}>
              {t("review.submit.continueAction")}
            </Button>
          </div>
        </>
      ) : view === "verdict" ? (
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
            value={reviewComment}
            onChange={setReviewComment}
            label={t("review.submit.commentLabel")}
            labelVisible
            labelClassName={styles["commentLabel"]}
            placeholder={t("review.submit.commentPlaceholder")}
            describedBy="submit-modal-comment-hint"
            onSubmit={attemptSubmit}
          />
          <p className={styles["hint"]} id="submit-modal-comment-hint">
            {t("review.submit.commentHint")}
          </p>
          {staleHead ? (
            <div className={styles["staleWarning"]}>
              {/* The live region and describedby target is the TEXT alone —
                  a live region wrapping the checkbox would re-announce the
                  control on every state change. */}
              <p id="submit-modal-stale-warning" role="status">
                {t("review.submit.staleWarning")}
              </p>
              <label className={styles["staleAck"]}>
                <input
                  checked={ackStale}
                  onChange={(event) => {
                    setAckStale(event.target.checked);
                  }}
                  type="checkbox"
                />
                {t("review.submit.staleAck")}
              </label>
            </div>
          ) : null}
          <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
            <Button onClick={() => setView("receipt")}>
              {t("review.submit.previewReceipt")}
            </Button>
            <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
            <Button
              aria-describedby={submitDescribedBy}
              disabled={submitDisabled}
              loading={submitPending}
              variant="primary"
              onClick={attemptSubmit}
            >
              {submitPending
                ? t("review.submit.submitting")
                : t("review.submit.submitReview")}
            </Button>
          </div>
          <p className={styles["note"]}>{t("review.submit.note")}</p>
          {blockedReason !== undefined ? (
            <p className={styles["submitStatus"]} id="submit-modal-blocked">
              {blockedReason}
            </p>
          ) : null}
          {submitError !== null ? (
            <p
              className={styles["submitStatus"]}
              data-kind="error"
              id="submit-modal-error"
              role="alert"
            >
              {submitError}
            </p>
          ) : null}
          {submitNote !== null && submitError === null ? (
            <p
              aria-live="polite"
              className={styles["submitStatus"]}
              role="status"
            >
              {submitNote}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className={styles["receiptTitle"]}>
            <h2 id="submit-modal-heading" ref={headingRef} tabIndex={-1}>
              {t("review.submit.receiptHeading")}
            </h2>
            <span className={styles["tag"]}>
              {t("review.submit.notAnApproval")}
            </span>
          </div>
          <p className={styles["sub"]}>{t("review.submit.receiptSub")}</p>
          <ReceiptAccordion
            outcome={outcome}
            raw={receiptText(receipt)}
            receipt={receipt}
          />
          <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
            <Button onClick={() => setView("verdict")}>
              {t("review.submit.backToVerdict")}
            </Button>
            <Button onClick={close}>{t("review.submit.keepReviewing")}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function unresolvedKindLabel(
  t: TFunction,
  kind: UnresolvedItem["kind"],
): string {
  const keys: Record<UnresolvedItem["kind"], TranslationKey> = {
    "open-risk": "review.submit.blockerOpenRisk",
    "missing-evidence": "review.submit.blockerMissingEvidence",
    "unreviewed-core": "review.submit.blockerUnreviewedCore",
    "unreviewed-remainder": "review.submit.blockerUnreviewedRemainder",
    "draft-comment": "review.submit.blockerDraftComment",
    "thin-dismissal": "review.submit.blockerThinDismissal",
  };
  return t(keys[kind]);
}

/** The frozen receipt rendering: mechanical claims plus a visible "not
 * checked" line; blank-line runs left by empty sections collapse. */
function receiptText(receipt: Receipt): string {
  return rawReceiptText(receipt).replace(/\n{3,}/g, "\n");
}

function rawReceiptText(receipt: Receipt): string {
  const { progress, addressed, dismissed, comments } = receipt;
  const openFlags = receipt.open;
  // Drafts ship on the next submit; submitted ones were already posted and
  // are listed as the record they are.
  const draftComments = comments.filter(
    (comment) => comment.status === "draft",
  );
  const postedComments = comments.filter(
    (comment) => comment.status === "submitted",
  );
  return `Reviewed by @you (human) · ${receipt.subject.repo} #${receipt.subject.number} @ ${receipt.subject.sha.slice(0, 7)}
Tool verification receipt — mechanical claims only

  ${progress.reviewedChunks >= progress.chunkTotal ? "✓" : "•"} chunks read: ${progress.reviewedChunks}/${progress.chunkTotal}
  ${addressed.length + dismissed.length >= progress.flagTotal ? "✓" : "•"} risk surface: ${addressed.length} addressed · ${dismissed.length} dismissed · ${openFlags.length} open
  ${comments.length > 0 ? "✓" : "•"} inline comments: ${draftComments.length} draft${postedComments.length > 0 ? ` · ${postedComments.length} posted` : ""}
${draftComments.map((comment) => `      comment: ${comment.file}:${comment.startLine}${comment.endLine !== comment.startLine ? `-${comment.endLine}` : ""} — ${comment.firstLine}`).join("\n")}
${postedComments.map((comment) => `      posted: ${comment.file}:${comment.startLine}${comment.endLine !== comment.startLine ? `-${comment.endLine}` : ""} — ${comment.firstLine}`).join("\n")}
${addressed.map((flag) => `      addressed: ${flag.attr} @ ${shortFile(flag.file)} — ${flag.evidenceLabel ?? "addressed without linked evidence"}`).join("\n")}
${dismissed.map((flag) => `      dismissed: ${flag.attr} @ ${shortFile(flag.file)} — "${flag.reason}"`).join("\n")}
${openFlags.map((flag) => `      open: ${flag.attr} @ ${shortFile(flag.file)} — not addressed, not dismissed`).join("\n")}
${receipt.reclassifiedCount > 0 ? `\n  ${receipt.reclassifiedCount} group reclassified by reviewer` : ""}
${
  receipt.repoConfig
    ? `\n  repo config (generation-time):\n${receipt.repoConfig.files
        .map(
          (file) =>
            `      ${file.path} — ${file.outcome}${file.blobSha ? ` @ ${file.blobSha.slice(0, 7)}` : ""}`,
        )
        .join("\n")}${
        receipt.repoConfig.collisions.length > 0
          ? `\n      built-in wins over: ${receipt.repoConfig.collisions.join(", ")}`
          : ""
      }${receipt.repoConfig.deEmphasisLine ? `\n      ${receipt.repoConfig.deEmphasisLine}` : ""}`
    : ""
}
  not checked: ${RECEIPT_NOT_CHECKED.join(" · ")}`;
}
