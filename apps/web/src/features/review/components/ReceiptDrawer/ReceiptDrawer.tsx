import type { ReviewMode } from "../../state";
import { RECEIPT_NOT_CHECKED, type Receipt } from "../../receipt";

export interface ReceiptDrawerProps {
  receipt: Receipt;
  reviewMode: ReviewMode;
  open: boolean;
  close: () => void;
  openSummaryPreview: () => void;
  submit: () => void;
}

export function ReceiptDrawer({
  receipt,
  reviewMode,
  open,
  close,
  openSummaryPreview,
  submit,
}: ReceiptDrawerProps) {
  const { progress, addressed, dismissed, comments } = receipt;
  const openFlags = receipt.open;

  return (
    <>
      <button
        aria-label="Close receipt"
        className={open ? "scrim show" : "scrim"}
        type="button"
        onClick={close}
      />
      <aside className={open ? "receipt show" : "receipt"}>
        <div className="receipt-inner">
          <div className="receipt-title">
            <h2>
              {reviewMode === "author"
                ? "Self-review summary"
                : "Verification receipt"}
            </h2>
            <span className="tag">not an approval</span>
          </div>
          <div className="receipt-sub">
            {reviewMode === "author"
              ? "Author-side preview · catches unresolved risk before requesting review"
              : "Frozen at submit · linked from a one-line signature on your normal GitHub review · the review itself stays yours"}
          </div>
          <pre className="receipt-body">{`Reviewed by @you (human) · ${receipt.subject.repo} #${receipt.subject.number} @ ${receipt.subject.sha.slice(0, 7)}
Tool verification receipt — mechanical claims only

  ${progress.reviewedChunks >= progress.chunkTotal ? "✓" : "•"} chunks read: ${progress.reviewedChunks}/${progress.chunkTotal}
  ${addressed.length + dismissed.length >= progress.flagTotal ? "✓" : "•"} risk surface: ${addressed.length} addressed · ${dismissed.length} dismissed · ${openFlags.length} open
  ${comments.length > 0 ? "✓" : "•"} inline comments: ${comments.length} draft
${comments.map((comment) => `      comment: ${comment.file}:${comment.startLine}${comment.endLine !== comment.startLine ? `-${comment.endLine}` : ""} — ${comment.firstLine}`).join("\n")}
${addressed.map((flag) => `      addressed: ${flag.attr} @ ${shortFile(flag.file)} — ${flag.evidenceLabel ?? "addressed without linked evidence"}`).join("\n")}
${dismissed.map((flag) => `      dismissed: ${flag.attr} @ ${shortFile(flag.file)} — "${flag.reason}"`).join("\n")}
${openFlags.map((flag) => `      open: ${flag.attr} @ ${shortFile(flag.file)} — not addressed, not dismissed`).join("\n")}
${receipt.reclassifiedCount > 0 ? `\n  ${receipt.reclassifiedCount} group reclassified by reviewer` : ""}

  not checked: ${RECEIPT_NOT_CHECKED.join(" · ")}`}</pre>
          <div className="receipt-actions">
            <button className="btn primary" type="button" onClick={submit}>
              {reviewMode === "author"
                ? "Mark ready for review"
                : "Submit review to GitHub"}
            </button>
            <button className="btn" type="button" onClick={openSummaryPreview}>
              Preview public summary
            </button>
            <button className="btn" type="button" onClick={close}>
              Keep reviewing
            </button>
            <span className="receipt-note">
              Scoped to mechanical claims. The approve / request-changes verdict
              is yours alone.
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

function shortFile(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}
