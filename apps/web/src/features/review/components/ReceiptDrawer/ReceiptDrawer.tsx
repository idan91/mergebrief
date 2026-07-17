import { Drawer } from "../../../../components/Drawer/Drawer";
import { RECEIPT_NOT_CHECKED, type Receipt } from "../../receipt";
import styles from "./ReceiptDrawer.module.scss";

export interface ReceiptDrawerProps {
  receipt: Receipt;
  open: boolean;
  close: () => void;
  openSummaryPreview: () => void;
  submit: () => void;
  /** Live submit in flight (BRIEF-23) — the control disables, focusably. */
  submitPending?: boolean;
  /** Why Submit is blocked; rendered as reachable text, never hover-only. */
  submitBlockedReason?: string | undefined;
  /** The last submit failure — announced assertively. */
  submitError?: string | null;
  /** Persistent post-submit note (anchoring degradation). */
  submitNote?: string | null;
}

export function ReceiptDrawer({
  receipt,
  open,
  close,
  openSummaryPreview,
  submit,
  submitPending = false,
  submitBlockedReason,
  submitError = null,
  submitNote = null,
}: ReceiptDrawerProps) {
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
  // Focusable-disabled (aria-disabled, not the disabled attribute): keyboard
  // and screen-reader users can reach the control and hear WHY it is off via
  // the described-by reason text below it.
  const submitDisabled = submitPending || submitBlockedReason !== undefined;
  const submitDescribedBy =
    submitBlockedReason !== undefined
      ? "receipt-submit-blocked"
      : submitError !== null
        ? "receipt-submit-error"
        : undefined;

  return (
    <Drawer
      open={open}
      closeLabel="Close receipt"
      close={close}
      asideClassName={styles["receipt"]}
    >
      <div className={styles["inner"]}>
        <div className={styles["title"]}>
          <h2>Verification receipt</h2>
          <span className={styles["tag"]}>not an approval</span>
        </div>
        <div className={styles["sub"]}>
          Frozen at submit · linked from a one-line signature on your normal
          GitHub review · the review itself stays yours
        </div>
        <pre
          className={styles["body"]}
        >{`Reviewed by @you (human) · ${receipt.subject.repo} #${receipt.subject.number} @ ${receipt.subject.sha.slice(0, 7)}
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
  not checked: ${RECEIPT_NOT_CHECKED.join(" · ")}`}</pre>
        <div className={styles["actions"]}>
          <button
            aria-busy={submitPending || undefined}
            aria-describedby={submitDescribedBy}
            aria-disabled={submitDisabled || undefined}
            className="btn primary"
            type="button"
            onClick={() => {
              if (!submitDisabled) submit();
            }}
          >
            {submitPending ? "Submitting…" : "Submit review to GitHub"}
          </button>
          <button className="btn" type="button" onClick={openSummaryPreview}>
            Preview public summary
          </button>
          <button className="btn" type="button" onClick={close}>
            Keep reviewing
          </button>
          <span className={styles["note"]}>
            Scoped to mechanical claims. The approve / request-changes verdict
            is yours alone.
          </span>
        </div>
        {submitBlockedReason !== undefined ? (
          <p className={styles["submitStatus"]} id="receipt-submit-blocked">
            {submitBlockedReason}
          </p>
        ) : null}
        {submitError !== null ? (
          <p
            className={styles["submitStatus"]}
            data-kind="error"
            id="receipt-submit-error"
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
      </div>
    </Drawer>
  );
}

function shortFile(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}
