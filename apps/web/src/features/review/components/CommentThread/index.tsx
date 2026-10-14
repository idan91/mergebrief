/* oxlint-disable jsx-a11y/no-autofocus --
   Single deliberate use: the edit surface mounts in response to an explicit
   Edit click, so moving focus into the textarea is the expected next
   action, not a page-load focus steal. */
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { DiffSides, DraftCommentStatuses } from "types";

import { Button } from "@web/components/Button";
import { LinkButton } from "@web/components/LinkButton";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea";
import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import { hasUploadPlaceholder } from "@web/components/MarkdownTextarea/utils";
import { useUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import {
  postCommentBlockedReason,
  isFileCommentAnchor,
  type ReviewComment,
} from "../../utils/comments";
import { commentLocation } from "../../utils/state";
import { useReviewActions } from "../../session";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { MarkdownPreview } from "../MarkdownPreview";
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
   * A screen-owned, wait-shaped reason Post must not run right now: a
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
  const { announce, announceQuietly } = useReviewActions();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The editor's image uploads: a failure lands here, a save waits for zero.
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const editBody = (next: string) => {
    setBody(next);
    setAttachError(undefined);
  };
  // Never-saved text = an open editor whose body diverged from the draft;
  // Save/Cancel both clear it (navigation guard).
  useUnsavedComposerText(
    useId(),
    editing &&
      comment.status !== DraftCommentStatuses.SUBMITTED &&
      body !== comment.body,
  );
  // Save keeps the posting guard: an editor already open when a Post starts
  // must not save mid-flight (capture-at-initiation).
  const saveEdit = () => {
    if (posting) {
      return;
    }
    // The body would carry the placeholder, not the image.
    if (hasUploadPlaceholder(body)) {
      setAttachError(t("shell.attach.waitForUpload"));
      return;
    }
    update(comment.id, body);
    setEditing(false);
  };
  const cancelEdit = () => {
    setBody(comment.body);
    setAttachError(undefined);
    setEditing(false);
  };
  // Posted to GitHub. GitHub holds the text now, so the local record is
  // read-only (an edit here would silently diverge: re-submits ship drafts).
  const submitted = comment.status === DraftCommentStatuses.SUBMITTED;
  // Why Post is blocked right now, or `undefined` when it may proceed:
  // - Submit review in flight (screen-owned, wins the display) → the review
  //   already captured this draft; posting would double-post it;
  // - editor open → Post ships the last SAVED body, and the success flip
  //   would silently discard the unsaved amendment. Save or cancel first;
  // - over-cap body/path → deterministic route 400; the UI would resubmit
  //   the same draft, so it must block here with recoverable copy.
  const postBlocked =
    post !== undefined && !submitted
      ? (postBlockedExternally ??
        (editing
          ? t("review.comment.saveFirst")
          : postCommentBlockedReason(t, comment)))
      : undefined;
  // A disabled control must say why: `aria-disabled` keeps it focusable, so
  // the reason rides `aria-describedby`. An in-flight post is the live reason
  // and is screen-reader-only (the label already reads "Posting…"); anything
  // else keeps its visible paragraph as the description.
  const postingReason = posting ? t("review.comment.postingReason") : undefined;
  const postReasonId = useId();
  const postDescribed = postingReason ?? postBlocked;
  const locationLabel = isFileCommentAnchor(comment.anchor)
    ? t("review.comment.commentOnFile")
    : commentLocation(comment);
  const editSuggestionSeed = isFileCommentAnchor(comment.anchor)
    ? undefined
    : comment.anchor.selectedText;
  const collapsedWhere = isFileCommentAnchor(comment.anchor)
    ? t("review.comment.commentOnFile")
    : `${t("review.comment.commentOn")}${(comment.anchor.startSide ?? comment.anchor.side) === DiffSides.NEW ? "+" : "-"}${comment.anchor.startLine}`;

  if (comment.collapsed) {
    return (
      <div className={styles["thread"]} data-state="collapsed">
        <LinkButton
          aria-expanded={false}
          className={styles["collapsedToggle"]}
          onClick={() => toggle(comment.id)}
        >
          {submitted ? t("review.comment.posted") : t("review.comment.draft")}{" "}
          {collapsedWhere}
        </LinkButton>
      </div>
    );
  }

  return (
    <div className={styles["thread"]}>
      <div className={styles["head"]}>
        <span>
          {submitted
            ? t("review.comment.postedToGithub")
            : t("review.comment.pending")}
        </span>
        <span>{locationLabel}</span>
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
            suggestionSeed={editSuggestionSeed}
            value={body}
            announce={announce}
            announceQuietly={announceQuietly}
            onAttachError={setAttachError}
            onChange={editBody}
            onEscape={cancelEdit}
            onSubmit={saveEdit}
          />
          {attachError !== undefined ? (
            <p className={styles["postBlocked"]} role="alert">
              {attachError}
            </p>
          ) : null}
          <div className={styles["actions"]}>
            <Button disabled={posting} variant="accent" onClick={saveEdit}>
              {t("review.comment.save")}
            </Button>
            <Button onClick={cancelEdit}>{t("review.comment.cancel")}</Button>
          </div>
        </>
      ) : (
        <MarkdownPreview anchor={comment.anchor} body={comment.body} />
      )}
      {/* The recoverable why-not for a blocked Post, adjacent to the disabled
          control. */}
      {postBlocked !== undefined ? (
        <p
          className={styles["postBlocked"]}
          id={postingReason === undefined ? postReasonId : undefined}
        >
          {postBlocked}
        </p>
      ) : null}
      <div className={styles["footer"]} data-thread-footer="">
        <div className={styles["threadActions"]}>
          {submitted ? null : (
            <LinkButton
              disabled={posting}
              onClick={() => {
                // Seed the editor from the current comment each time, so an edit
                // never opens on a stale body if it changed since mount.
                setBody(comment.body);
                setEditing(true);
              }}
            >
              {t("review.comment.edit")}
            </LinkButton>
          )}
          <LinkButton
            onClick={() => {
              // A confirmation must not resurface (and re-announce) on a
              // later expand without fresh intent.
              setConfirmingDelete(false);
              toggle(comment.id);
            }}
          >
            {t("review.comment.collapse")}
          </LinkButton>
          {submitted ? null : (
            <LinkButton
              disabled={posting}
              onClick={() => setConfirmingDelete(true)}
            >
              {t("review.comment.delete")}
            </LinkButton>
          )}
        </div>
        {/* Inline two-step confirm: the page toast is a text-only live
            region, so an undo BUTTON has no surface. */}
        {confirmingDelete && !submitted ? (
          <div className={styles["deleteConfirm"]} role="alert">
            <span>{t("review.comment.deleteConfirm")}</span>
            <Button
              disabled={posting}
              onClick={() => {
                setConfirmingDelete(false);
                deleteComment(comment.id);
              }}
            >
              {t("review.comment.deleteDraft")}
            </Button>
            <Button onClick={() => setConfirmingDelete(false)}>
              {t("review.comment.keep")}
            </Button>
          </div>
        ) : null}
        {/* Post-now: own-draft state only. A submitted comment is already on
            GitHub, so it never shows Post. While in flight the button stays
            visible (pending label) but inert. */}
        {post !== undefined && !submitted ? (
          <div className={styles["postCta"]}>
            <Button
              aria-describedby={
                postDescribed === undefined ? undefined : postReasonId
              }
              data-post-cta=""
              disabled={posting || postBlocked !== undefined}
              loading={posting}
              variant="accent"
              onClick={() => post(comment)}
            >
              {posting ? t("review.comment.posting") : t("review.comment.post")}
            </Button>
            {postingReason === undefined ? null : (
              <ScreenReaderOnly id={postReasonId}>
                {postingReason}
              </ScreenReaderOnly>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
