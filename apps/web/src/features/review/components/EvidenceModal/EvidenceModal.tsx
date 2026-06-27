import { useEffect, useState } from "react";

import type { BriefChunk } from "../../../brief/types";
import type { ReviewComment } from "../../comments";
import { commentLocation, type RiskEvidenceKind } from "../../state";

export interface EvidenceTarget {
  flagIds: string[];
  label: string;
}

export function EvidenceModal({
  cancel,
  chunks,
  comments,
  confirm,
  target,
}: {
  cancel: () => void;
  chunks: BriefChunk[];
  comments: ReviewComment[];
  confirm: (
    kind: RiskEvidenceKind,
    commentId: string | undefined,
    note: string | undefined,
  ) => void;
  target: EvidenceTarget | null;
}) {
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
    <div className={target ? "modal show" : "modal"}>
      <div className="modal-box evidence-box">
        <h3>Address risk with evidence</h3>
        <div className="mattr">{target?.label}</div>
        <div className="evidence-options">
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
          <p className="modal-copy">
            Each selected risk will link to its related chunk. Reviewed chunks
            are shown as evidence in the receipt.
          </p>
        ) : null}
        {kind === "manual-note" ? (
          <textarea
            placeholder="What did you verify?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        ) : null}
        <div className="modal-actions">
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
      </div>
    </div>
  );
}
