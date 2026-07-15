import { useState } from "react";

import { postCommentBlockedReason, type ReviewComment } from "../../comments";
import { MarkdownPreview } from "../MarkdownPreview/MarkdownPreview";
import styles from "./CommentThread.module.scss";

export interface CommentThreadProps {
  comment: ReviewComment;
  deleteComment: (commentId: string) => void;
  /**
   * Post this staged draft NOW as a standalone inline review comment (BRIEF-43
   * own-draft state, current head). Absent everywhere else — its presence is
   * the sole gate on the Post affordance. Re-entrancy + commit-point handling
   * live in the injected handler; on success the draft flips to `submitted`
   * (so this button disappears) and the failure copy keeps the draft.
   */
  post?: ((comment: ReviewComment) => void) | undefined;
  /**
   * True while THIS comment's post-now request is in flight (BriefPage's
   * posting set, state-backed so it re-renders). The Post button shows a
   * pending label and every mutating control (Post/Edit/Delete) disables —
   * a mid-flight edit would otherwise produce a `submitted` record whose
   * edited body was never what actually posted (capture-at-initiation rule).
   */
  posting?: boolean | undefined;
  /**
   * A screen-owned, wait-shaped reason Post must not run right now — a
   * Submit review in flight already CAPTURED the drafts it ships, so posting
   * one mid-submit would double-post it when the review lands (the mirror of
   * the submit flow's blockedExternally). Wins the blocked display; the
   * per-comment content reasons re-surface once it clears.
   */
  postBlockedExternally?: string | undefined;
  toggle: (commentId: string) => void;
  update: (commentId: string, body: string) => void;
}

export function CommentThread({
  comment,
  deleteComment,
  post,
  posting = false,
  postBlockedExternally,
  toggle,
  update,
}: CommentThreadProps) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  // A submitted comment was posted to GitHub — GitHub holds the text now, so
  // the local record is read-only (an edit here would silently diverge: a
  // re-submit ships drafts only). BRIEF-23.
  const submitted = comment.status === "submitted";
  // Why Post is blocked right now, or `undefined` when it may proceed:
  // - Submit review in flight (screen-owned, wins the display) → the review
  //   already captured this draft; posting would double-post it;
  // - editor open → Post ships the last SAVED body, and the success flip
  //   would silently discard the unsaved amendment (reviewer round 2 #2) —
  //   save or cancel first;
  // - over-cap body/path → deterministic route 400; the UI would resubmit
  //   the same draft, so it must block here with recoverable copy (AGENTS.md).
  const postBlocked =
    post !== undefined && !submitted
      ? (postBlockedExternally ??
        (editing
          ? "Save or cancel your edit first — posting sends the last saved text."
          : postCommentBlockedReason(comment)))
      : undefined;

  if (comment.collapsed) {
    return (
      <div className={styles["thread"]} data-state="collapsed">
        <button type="button" onClick={() => toggle(comment.id)}>
          {submitted ? "Posted" : "Draft"} comment on{" "}
          {comment.anchor.side === "new" ? "+" : "-"}
          {comment.anchor.startLine}
        </button>
      </div>
    );
  }

  return (
    <div className={styles["thread"]}>
      <div className={styles["head"]}>
        <span>{submitted ? "@you posted to GitHub" : "@you pending"}</span>
        <span>
          {comment.anchor.file}:{comment.anchor.startLine}
          {comment.anchor.endLine !== comment.anchor.startLine
            ? `-${comment.anchor.endLine}`
            : ""}
        </span>
      </div>
      {/* An open editor dies with the draft: if a submit lands while the
          textarea is up, the posted record renders read-only regardless. */}
      {editing && !submitted ? (
        <>
          <textarea
            className={styles["textarea"]}
            suppressHydrationWarning
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className={styles["actions"]}>
            {/* An editor already open when a Post starts must not save
                mid-flight: the local record would flip to `submitted` with a
                body the request never shipped (capture-at-initiation rule). */}
            <button
              className="btn primary"
              disabled={posting}
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
      {/* The recoverable why-not for a blocked Post, adjacent to the disabled
          control (the ReceiptDrawer's submitBlockedReason pattern). */}
      {postBlocked !== undefined ? (
        <p className={styles["postBlocked"]}>{postBlocked}</p>
      ) : null}
      <div className={styles["threadActions"]}>
        {/* Post-now (BRIEF-43): staged draft → GitHub, in own-draft state only.
            A submitted comment is already on GitHub, so it never shows Post.
            While in flight the button stays visible (pending label) but inert. */}
        {post !== undefined && !submitted ? (
          <button
            className="btn primary"
            disabled={posting || postBlocked !== undefined}
            type="button"
            onClick={() => post(comment)}
          >
            {posting ? "Posting…" : "Post"}
          </button>
        ) : null}
        {submitted ? null : (
          <button
            disabled={posting}
            type="button"
            onClick={() => {
              // Seed the editor from the current comment each time, so an edit
              // never opens on a stale body if it changed since mount.
              setBody(comment.body);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
        <button type="button" onClick={() => toggle(comment.id)}>
          Collapse
        </button>
        {submitted ? null : (
          <button
            disabled={posting}
            type="button"
            onClick={() => deleteComment(comment.id)}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
