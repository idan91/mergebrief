import { useEffect, useState } from "react";

import { Modal } from "@web/components/Modal/Modal";
import type { ReviewComment } from "../../comments";
import { commentLocation, type RiskEvidenceKind } from "../../state";
import styles from "@web/components/Modal/ModalContent.module.scss";

export interface EvidenceTarget {
  flagIds: string[];
  label: string;
}

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
  const [kind, setKind] = useState<RiskEvidenceKind>("chunk-reviewed");
  const [commentId, setCommentId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!target) return;
    setKind(comments.length > 0 ? "linked-comment" : "chunk-reviewed");
    setCommentId(comments[0]?.id ?? "");
    setNote("");
  }, [comments, target]);

  const linkedCommentDisabled = kind === "linked-comment" && !commentId;
  return (
    <Modal
      open={Boolean(target)}
      boxClassName={styles["wideBox"]}
      close={cancel}
      labelledBy="evidence-modal-heading"
    >
      <h3 id="evidence-modal-heading">Address risk with evidence</h3>
      <div className={styles["target"]}>{target?.label}</div>
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
          aria-label="Linked comment"
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
          aria-label="What did you verify?"
          placeholder="What did you verify?"
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
    </Modal>
  );
}
