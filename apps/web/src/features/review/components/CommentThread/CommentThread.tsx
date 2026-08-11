/* eslint-disable jsx-a11y/no-autofocus --
   Single deliberate use: the edit surface mounts in response to an explicit
   Edit click, so moving focus into the textarea is the expected next
   action — not a page-load focus steal. */
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";

import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import { useUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import {
  postCommentBlockedReason,
  type ReviewComment,
} from "../../utils/comments";
import { MarkdownPreview } from "../MarkdownPreview/MarkdownPreview";
import styles from "./CommentThread.module.scss";

export interface CommentThreadProps {
  comment: ReviewComment;
  deleteComment: (commentId: string) => void;
  /** Mention-autocomplete pool (repo collaborators); absent on the local path. */
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  /**
   * Post this staged draft NOW as a standalone inline review comment against
   * the current head. Its presence is the sole gate on the Post affordance;
   * re-entrancy and commit-point handling live in the injected handler.
   */
  post?: ((comment: ReviewComment) => void) | undefined;
  /**
   * True while THIS comment's post-now request is in flight. Every mutating
   * control disables: a mid-flight edit would otherwise produce a `submitted`
   * record whose body was never what actually posted (capture-at-initiation).
   */
  posting?: boolean | undefined;
  /**
   * A screen-owned, wait-shaped reason Post must not run right now — a
   * Submit review in flight already CAPTURED the drafts it ships, so posting
   * one mid-submit would double-post it when the review lands. Wins the
   * blocked display; content reasons re-surface once it clears.
   */
  postBlockedExternally?: string | undefined;
  toggle: (commentId: string) => void;
  update: (commentId: string, body: string) => void;
}

export function CommentThread({
  comment,
  deleteComment,
  mentionCandidates,
  post,
  posting = false,
  postBlockedExternally,
  toggle,
  update,
}: CommentThreadProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Never-saved text = an open editor whose body diverged from the draft;
  // Save/Cancel both clear it (navigation guard).
  useUnsavedComposerText(
    useId(),
    editing && comment.status !== "submitted" && body !== comment.body,
  );
  // Save keeps the posting guard: an editor already open when a Post starts
  // must not save mid-flight (capture-at-initiation).
  const saveEdit = () => {
    if (posting) return;
    update(comment.id, body);
    setEditing(false);
  };
  const cancelEdit = () => {
    setBody(comment.body);
    setEditing(false);
  };
  // Posted to GitHub — GitHub holds the text now, so the local record is
  // read-only (an edit here would silently diverge: re-submits ship drafts).
  const submitted = comment.status === "submitted";
  // Why Post is blocked right now, or `undefined` when it may proceed:
  // - Submit review in flight (screen-owned, wins the display) → the review
  //   already captured this draft; posting would double-post it;
  // - editor open → Post ships the last SAVED body, and the success flip
  //   would silently discard the unsaved amendment — save or cancel first;
  // - over-cap body/path → deterministic route 400; the UI would resubmit
  //   the same draft, so it must block here with recoverable copy.
  const postBlocked =
    post !== undefined && !submitted
      ? (postBlockedExternally ??
        (editing
          ? t("review.comment.saveFirst")
          : postCommentBlockedReason(comment)))
      : undefined;

  if (comment.collapsed) {
    return (
      <div className={styles["thread"]} data-state="collapsed">
        <button type="button" onClick={() => toggle(comment.id)}>
          {submitted ? t("review.comment.posted") : t("review.comment.draft")}{" "}
          {t("review.comment.commentOn")}
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
          <MarkdownTextarea
            autoFocus
            label={t("review.comment.editLabel")}
            mentionCandidates={mentionCandidates}
            renderPreview={(previewBody) => (
              <MarkdownPreview anchor={comment.anchor} body={previewBody} />
            )}
            suggestionSeed={comment.anchor.selectedText}
            value={body}
            onChange={setBody}
            onEscape={cancelEdit}
            onSubmit={saveEdit}
          />
          <div className={styles["actions"]}>
            <button
              className="btn primary"
              disabled={posting}
              type="button"
              onClick={saveEdit}
            >
              Save
            </button>
            <button className="btn" type="button" onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <MarkdownPreview anchor={comment.anchor} body={comment.body} />
      )}
      {/* The recoverable why-not for a blocked Post, adjacent to the disabled
          control. */}
      {postBlocked !== undefined ? (
        <p className={styles["postBlocked"]}>{postBlocked}</p>
      ) : null}
      <div className={styles["footer"]} data-thread-footer="">
        <div className={styles["threadActions"]}>
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
          <button
            type="button"
            onClick={() => {
              // A confirmation must not resurface (and re-announce) on a
              // later expand without fresh intent.
              setConfirmingDelete(false);
              toggle(comment.id);
            }}
          >
            Collapse
          </button>
          {submitted ? null : (
            <button
              disabled={posting}
              type="button"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </button>
          )}
        </div>
        {/* Inline two-step confirm: the page toast is a text-only live
            region, so an undo BUTTON has no surface. */}
        {confirmingDelete && !submitted ? (
          <div className={styles["deleteConfirm"]} role="alert">
            <span>{t("review.comment.deleteConfirm")}</span>
            <button
              className="btn"
              disabled={posting}
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                deleteComment(comment.id);
              }}
            >
              Delete draft
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep
            </button>
          </div>
        ) : null}
        {/* Post-now: own-draft state only — a submitted comment is already on
            GitHub, so it never shows Post. While in flight the button stays
            visible (pending label) but inert. */}
        {post !== undefined && !submitted ? (
          <div className={styles["postCta"]}>
            <button
              className="btn primary"
              data-post-cta=""
              disabled={posting || postBlocked !== undefined}
              type="button"
              onClick={() => post(comment)}
            >
              {posting ? t("review.comment.posting") : t("review.comment.post")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
