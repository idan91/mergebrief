import { useState } from "react";

import type { ReviewComment } from "../../comments";
import { MarkdownPreview } from "../MarkdownPreview/MarkdownPreview";
import styles from "./CommentThread.module.scss";

export interface CommentThreadProps {
  comment: ReviewComment;
  deleteComment: (commentId: string) => void;
  toggle: (commentId: string) => void;
  update: (commentId: string, body: string) => void;
}

export function CommentThread({
  comment,
  deleteComment,
  toggle,
  update,
}: CommentThreadProps) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);

  if (comment.collapsed) {
    return (
      <div className={styles["thread"]} data-state="collapsed">
        <button type="button" onClick={() => toggle(comment.id)}>
          Draft comment on {comment.anchor.side === "new" ? "+" : "-"}
          {comment.anchor.startLine}
        </button>
      </div>
    );
  }

  return (
    <div className={styles["thread"]}>
      <div className={styles["head"]}>
        <span>@you pending</span>
        <span>
          {comment.anchor.file}:{comment.anchor.startLine}
          {comment.anchor.endLine !== comment.anchor.startLine
            ? `-${comment.anchor.endLine}`
            : ""}
        </span>
      </div>
      {editing ? (
        <>
          <textarea
            className={styles["textarea"]}
            suppressHydrationWarning
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className={styles["actions"]}>
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                update(comment.id, body);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setBody(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <MarkdownPreview anchor={comment.anchor} body={comment.body} />
      )}
      <div className={styles["threadActions"]}>
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" onClick={() => toggle(comment.id)}>
          Collapse
        </button>
        <button type="button" onClick={() => deleteComment(comment.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
