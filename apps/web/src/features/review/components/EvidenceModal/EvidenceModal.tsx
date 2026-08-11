import { useTranslation } from "react-i18next";
import { useState } from "react";

import { Modal } from "@web/components/Modal/Modal";
import type { ReviewComment } from "../../utils/comments";
import {
  commentLocation,
  type EvidenceTarget,
  type RiskEvidenceKind,
} from "../../utils/state";
import styles from "@web/components/Modal/Modal.module.scss";

export interface EvidenceModalProps {
  cancel: () => void;
  comments: ReviewComment[];
  confirm: (
    kind: RiskEvidenceKind,
    commentId: string | undefined,
    note: string | undefined,
  ) => void;
  target: EvidenceTarget | null;
}

export function EvidenceModal({
  cancel,
  comments,
  confirm,
  target,
}: EvidenceModalProps) {
  return (
    <Modal
      open={Boolean(target)}
      boxClassName={styles["wideBox"]}
      close={cancel}
      labelledBy="evidence-modal-heading"
    >
      {target ? (
        <EvidenceForm
          key={target.flagIds.join("\n")}
          cancel={cancel}
          comments={comments}
          confirm={confirm}
          target={target}
        />
      ) : null}
    </Modal>
  );
}

export interface EvidenceFormProps {
  cancel: () => void;
  comments: ReviewComment[];
  confirm: (
    kind: RiskEvidenceKind,
    commentId: string | undefined,
    note: string | undefined,
  ) => void;
  target: EvidenceTarget;
}

// Mounted only while the modal is open: initializers seed from the comments
// present at open time, and mid-flow comment-list churn (e.g. a settled
// post-now drain) can no longer wipe the user's typed note.
function EvidenceForm({
  cancel,
  comments,
  confirm,
  target,
}: EvidenceFormProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<RiskEvidenceKind>(
    comments.length > 0 ? "linked-comment" : "chunk-reviewed",
  );
  const [commentId, setCommentId] = useState(comments[0]?.id ?? "");
  const [note, setNote] = useState("");

  const linkedCommentDisabled = kind === "linked-comment" && !commentId;
  return (
    <>
      <h3 id="evidence-modal-heading">{t("review.evidence.heading")}</h3>
      <div className={styles["target"]}>{target.label}</div>
      <div className={styles["evidenceOptions"]}>
        <label>
          <input
            checked={kind === "linked-comment"}
            disabled={comments.length === 0}
            name="risk-evidence"
            type="radio"
            onChange={() => setKind("linked-comment")}
          />{" "}
          Linked comment
        </label>
        <label>
          <input
            checked={kind === "chunk-reviewed"}
            name="risk-evidence"
            type="radio"
            onChange={() => setKind("chunk-reviewed")}
          />{" "}
          Reviewed related chunk
        </label>
        <label>
          <input
            checked={kind === "manual-note"}
            name="risk-evidence"
            type="radio"
            onChange={() => setKind("manual-note")}
          />{" "}
          Manually verified
        </label>
      </div>
      {kind === "linked-comment" ? (
        <select
          aria-label={t("review.evidence.ariaLabelLinkedComment")}
          className={styles["select"]}
          value={commentId}
          onChange={(event) => setCommentId(event.target.value)}
        >
          {comments.map((comment) => (
            <option key={comment.id} value={comment.id}>
              {commentLocation(comment)}
            </option>
          ))}
        </select>
      ) : null}
      {kind === "chunk-reviewed" ? (
        <p className={styles["copy"]}>
          Each selected risk will link to its related chunk. Reviewed chunks are
          shown as evidence in the receipt.
        </p>
      ) : null}
      {kind === "manual-note" ? (
        <textarea
          aria-label={t("review.evidence.verifyLabel")}
          placeholder={t("review.evidence.verifyLabel")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      ) : null}
      <div className={styles["actions"]}>
        <button className="btn" type="button" onClick={cancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={linkedCommentDisabled}
          type="button"
          onClick={() =>
            confirm(kind, commentId || undefined, note.trim() || undefined)
          }
        >
          Mark addressed
        </button>
      </div>
    </>
  );
}
