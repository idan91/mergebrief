import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";

import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import { Modal } from "@web/components/Modal/Modal";
import modalStyles from "@web/components/Modal/Modal.module.scss";
import { useReviewActions, useReviewFlow } from "../../session/flow/provider";
import { RECEIPT_NOT_CHECKED, type Receipt } from "../../utils/receipt";
import { reviewOutcomeLabel, type ReviewOutcome } from "../../utils/state";
import styles from "./SubmitModal.module.scss";

/** The modal's in-flow position: the verdict form is the default; the
 * receipt is a pure preview one step away (BRIEF-137 locked decision 3). */
type SubmitView = "verdict" | "receipt";

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
  /** Live submit in flight (BRIEF-23) — the control disables, focusably. */
  submitPending?: boolean;
  /**
   * Screen-owned reason Submit must not run regardless of content (read-only
   * posture, BRIEF-24) — wins over the live content rule.
   */
  blockedReasonOverride?: string | undefined;
  /**
   * The live content rule evaluated against the current review-comment draft
   * (`useReviewSubmit.blockedReasonWith`) — this component subscribes to the
   * draft and re-derives per keystroke so the owning screen doesn't have to.
   * Absent on the local demo path.
   */
  blockedReasonWith?:
    | ((reviewComment: string) => string | undefined)
    | undefined;
  /** The last submit failure — announced assertively. */
  submitError?: string | null;
  /** Persistent post-submit note (anchoring degradation). */
  submitNote?: string | null;
  /**
   * The viewed span's head is no longer the PR head (BRIEF-127): Submit
   * requires the explicit ack below — comments stay pinned to the reviewed
   * revision and may appear as outdated on GitHub. Evaluated live: a poll
   * tick may flip it while the modal is open.
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
  submitPending = false,
  blockedReasonOverride,
  blockedReasonWith,
  submitError = null,
  submitNote = null,
  staleHead = false,
}: SubmitModalProps) {
  const outcomeGroupName = useId();
  const reviewComment = useReviewFlow((state) => state.reviewComment);
  const { setReviewComment } = useReviewActions();

  // View position is modal-local and resets on open (BRIEF-137 decision 5:
  // close is non-destructive for DATA — outcome and draft live in stores —
  // but never for position). The stale ack (BRIEF-127) is deliberately NOT
  // sticky: reopening re-requires the check, and so does staleness RETURNING
  // while the modal stays open (acked → head caught up → advanced again) — a
  // prior consent must not pre-authorize new staleness. All resets ride the
  // render-time adjustment pattern (no effect, no flicker).
  const [view, setView] = useState<SubmitView>("verdict");
  const [ackStale, setAckStale] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const [wasStale, setWasStale] = useState(staleHead);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const prevViewRef = useRef(view);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setView("verdict");
      setAckStale(false);
      // Also reset the focus-effect's view memory: reopening after a receipt
      // preview must NOT read as a view switch, or the heading focus below
      // would steal the Modal's own open-focus claim on the dialog box.
      prevViewRef.current = "verdict";
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
      {view === "verdict" ? (
        <>
          <h3 id="submit-modal-heading" ref={headingRef} tabIndex={-1}>
            Submit review
          </h3>
          <p className={modalStyles["copy"]}>
            The verdict and the words are yours. The tool adds one signature
            line of mechanical claims under them.
          </p>
          <fieldset className={styles["outcomes"]}>
            <legend>Review outcome</legend>
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
                {reviewOutcomeLabel(option)}
              </label>
            ))}
          </fieldset>
          <MarkdownTextarea
            value={reviewComment}
            onChange={setReviewComment}
            label="Review comment"
            labelVisible
            labelClassName={styles["commentLabel"]}
            placeholder="Optional — your words, posted above the signature line."
            describedBy="submit-modal-comment-hint"
            onSubmit={attemptSubmit}
          />
          <p className={styles["hint"]} id="submit-modal-comment-hint">
            Posted as your comment, a rule, then the tool&apos;s one-line
            signature.
          </p>
          {staleHead ? (
            <div className={styles["staleWarning"]}>
              {/* The live region and describedby target is the TEXT alone —
                  a live region wrapping the checkbox would re-announce the
                  control on every state change. */}
              <p id="submit-modal-stale-warning" role="status">
                This pull request has newer commits. Comments will anchor to the
                revision you reviewed and may appear as outdated on GitHub.
              </p>
              <label className={styles["staleAck"]}>
                <input
                  checked={ackStale}
                  onChange={(event) => {
                    setAckStale(event.target.checked);
                  }}
                  type="checkbox"
                />
                Submit against the reviewed revision anyway
              </label>
            </div>
          ) : null}
          <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
            <button
              className="btn"
              type="button"
              onClick={() => setView("receipt")}
            >
              Preview receipt
            </button>
            <button className="btn" type="button" onClick={close}>
              Keep reviewing
            </button>
            <button
              aria-busy={submitPending || undefined}
              aria-describedby={submitDescribedBy}
              aria-disabled={submitDisabled || undefined}
              className="btn primary"
              type="button"
              onClick={attemptSubmit}
            >
              {submitPending ? "Submitting…" : "Submit review"}
            </button>
          </div>
          <p className={styles["note"]}>
            Scoped to mechanical claims. The approve / request-changes verdict
            is yours alone.
          </p>
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
            <h3 id="submit-modal-heading" ref={headingRef} tabIndex={-1}>
              Verification receipt
            </h3>
            <span className={styles["tag"]}>not an approval</span>
          </div>
          <p className={styles["sub"]}>
            Frozen at submit · linked from a one-line signature on your normal
            GitHub review · the review itself stays yours. The signature line
            links a public summary.
          </p>
          <pre className={styles["receiptBody"]}>{receiptText(receipt)}</pre>
          <div className={clsx(modalStyles["actions"], styles["actionsRow"])}>
            <button
              className="btn"
              type="button"
              onClick={() => setView("verdict")}
            >
              Back to verdict
            </button>
            <button className="btn" type="button" onClick={close}>
              Keep reviewing
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** The frozen receipt rendering — ported verbatim from the retired
 * ReceiptDrawer so the ADR 0002 surface (mechanical claims, visible
 * "not checked" line) survives the move unchanged. */
function receiptText(receipt: Receipt): string {
  const { progress, addressed, dismissed, comments } = receipt;
  const openFlags = receipt.open;
  // The submit-facing split (BRIEF-23): drafts ship on the next submit;
  // submitted ones were already posted and are listed as the record they are.
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

function shortFile(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}
