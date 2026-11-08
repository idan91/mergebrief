/* oxlint-disable jsx-a11y/no-autofocus --
   Single deliberate use: the edit surface mounts in response to an explicit
   Edit click, so moving focus into the textarea is the expected next
   action, not a page-load focus steal. */
import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";
import { useId } from "react";
import { DraftCommentStatuses } from "types";

import { Button } from "@web/components/Button";
import { LinkButton } from "@web/components/LinkButton";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea";
import { useUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import { useMentionSuggestions } from "@web/features/conversation/hooks";
import type { MentionSource } from "@web/features/conversation/types";
import {
  postCommentBlockedReason,
  isFileCommentAnchor,
  type ReviewComment,
} from "../../utils/comments";
import { commentLocation } from "../../utils/state";
import { useReviewActions } from "../../session";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { MarkdownPreview } from "../MarkdownPreview";
import { useCommentThreadFacade } from "./useCommentThreadFacade";
import { readSideSign } from "./utils";
import styles from "./CommentThread.module.scss";

interface StatusLabelKeys {
  readonly collapsed: TranslationKey;
  readonly head: TranslationKey;
}

/** A status this bundle predates gets no label rather than a wrong one. */
const STATUS_LABEL_KEYS: Partial<
  Record<ReviewComment["status"], StatusLabelKeys>
> = {
  [DraftCommentStatuses.DRAFT]: {
    collapsed: "review.comment.draft",
    head: "review.comment.pending",
  },
  [DraftCommentStatuses.SUBMITTED]: {
    collapsed: "review.comment.posted",
    head: "review.comment.postedToGithub",
  },
};

export interface CommentThreadProps {
  comment: ReviewComment;
  deleteComment: (commentId: string) => void;
  /** Where the draft editor's mention suggestions come from; absent turns them off. */
  mentionSource?: MentionSource | undefined;
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
  /** Answers whether the edit landed; the editor closes only then. */
  update: (commentId: string, body: string) => Promise<boolean>;
}

export function CommentThread({
  comment,
  deleteComment,
  mentionSource,
  post,
  posting = false,
  postBlockedExternally,
  toggle,
  update,
}: CommentThreadProps) {
  const { t } = useTranslation();
  const { announce, announceQuietly } = useReviewActions();
  const mentions = useMentionSuggestions(mentionSource);
  // Only a draft is the reviewer's to change. Posted means GitHub holds the
  // text (an edit here would silently diverge: re-submits ship drafts), and a
  // status this bundle predates is the server's, so both read-only.
  const readOnly = comment.status !== DraftCommentStatuses.DRAFT;
  const thread = useCommentThreadFacade({ comment, readOnly, posting, update });
  const { body, editError, editorOpen, saving } = thread;
  const postable = post !== undefined && !readOnly;
  // Never-saved text = an open editor whose body diverged from the draft;
  // a landed Save or a Cancel clears it (navigation guard).
  const unsavedEdit = editorOpen && body !== comment.body;
  useUnsavedComposerText(useId(), unsavedEdit);
  const saveLabel = saving
    ? t("review.comment.saving")
    : t("review.comment.save");
  const statusLabels = STATUS_LABEL_KEYS[comment.status];
  const collapsedLabel =
    statusLabels === undefined ? "" : `${t(statusLabels.collapsed)} `;
  const headLabel = statusLabels === undefined ? "" : t(statusLabels.head);
  // Why Post is blocked right now, or `undefined` when it may proceed:
  // - Submit review in flight (screen-owned, wins the display) → the review
  //   already captured this draft; posting would double-post it;
  // - editor open → Post ships the last SAVED body, and the success flip
  //   would silently discard the unsaved amendment. Save or cancel first;
  // - over-cap body/path → deterministic route 400; the UI would resubmit
  //   the same draft, so it must block here with recoverable copy.
  const postBlocked = postable
    ? (postBlockedExternally ??
      (thread.editing
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
  const leadsToggle = statusLabels === undefined;
  const commentOn = leadsToggle
    ? t("review.comment.commentOn")
    : t("review.comment.commentOn", { context: "inline" });
  const commentOnFile = leadsToggle
    ? t("review.comment.commentOnFile")
    : t("review.comment.commentOnFile", { context: "inline" });
  const collapsedWhere = isFileCommentAnchor(comment.anchor)
    ? commentOnFile
    : `${commentOn}${readSideSign(comment.anchor)}${comment.anchor.startLine}`;

  if (comment.collapsed) {
    return (
      <div className={styles["thread"]} data-state="collapsed">
        <LinkButton
          aria-expanded={false}
          className={styles["collapsedToggle"]}
          onClick={() => toggle(comment.id)}
        >
          {collapsedLabel}
          {collapsedWhere}
        </LinkButton>
      </div>
    );
  }

  return (
    <div className={styles["thread"]}>
      <div className={styles["head"]}>
        <span>{headLabel}</span>
        <span className={styles["location"]} data-anchor={comment.anchor.kind}>
          {locationLabel}
        </span>
      </div>
      {/* An open editor dies with the draft: if a submit lands while the
          textarea is up, the posted record renders read-only regardless. */}
      {editorOpen ? (
        <div className={styles["editor"]} ref={thread.editorRef}>
          <MarkdownTextarea
            autoFocus
            label={t("review.comment.editLabel")}
            mentionSuggestions={mentions.mentionSuggestions}
            onMentionQueryChange={mentions.onMentionQueryChange}
            renderPreview={(previewBody) => (
              <MarkdownPreview anchor={comment.anchor} body={previewBody} />
            )}
            suggestionSeed={editSuggestionSeed}
            value={body}
            announce={announce}
            announceQuietly={announceQuietly}
            ariaBusy={saving}
            readOnly={saving}
            onAttachError={thread.setEditError}
            onChange={thread.editBody}
            onEscape={thread.cancelEdit}
            onSubmit={thread.saveEdit}
          />
          {editError !== undefined ? (
            <p className={styles["postBlocked"]} role="alert">
              {editError}
            </p>
          ) : null}
          <div className={styles["actions"]}>
            <Button disabled={saving} onClick={thread.cancelEdit}>
              {t("review.comment.cancel")}
            </Button>
            {/* Focusable-disabled while saving: focus stays on Save. */}
            <Button
              aria-busy={saving || undefined}
              aria-disabled={saving || undefined}
              disabled={posting}
              variant="primary"
              onClick={thread.saveEdit}
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles["body"]}>
          <MarkdownPreview anchor={comment.anchor} body={comment.body} />
        </div>
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
          {readOnly ? null : (
            <LinkButton
              disabled={posting}
              ref={thread.editTriggerRef}
              onClick={thread.openEditor}
            >
              {t("review.comment.edit")}
            </LinkButton>
          )}
          <LinkButton
            onClick={() => {
              thread.dropDeleteConfirm();
              toggle(comment.id);
            }}
          >
            {t("review.comment.collapse")}
          </LinkButton>
          {readOnly ? null : (
            <LinkButton
              aria-disabled={editorOpen || undefined}
              disabled={posting}
              ref={thread.deleteTriggerRef}
              onClick={thread.requestDelete}
            >
              {t("review.comment.delete")}
            </LinkButton>
          )}
        </div>
        {/* Inline two-step confirm: the page toast is a text-only live
            region, so an undo BUTTON has no surface. */}
        {thread.confirmDeleteOpen ? (
          <div className={styles["deleteConfirm"]} role="alert">
            <span>{t("review.comment.deleteConfirm")}</span>
            <Button onClick={thread.keepDraft}>
              {t("review.comment.keep")}
            </Button>
            <Button
              disabled={posting}
              onClick={() => {
                thread.dropDeleteConfirm();
                deleteComment(comment.id);
              }}
            >
              {t("review.comment.deleteDraft")}
            </Button>
          </div>
        ) : null}
        {/* Post-now: own-draft state only. A submitted comment is already on
            GitHub, so it never shows Post. While in flight the button stays
            visible (pending label) but inert. */}
        {postable ? (
          <div className={styles["postCta"]}>
            <Button
              aria-describedby={
                postDescribed === undefined ? undefined : postReasonId
              }
              data-post-cta=""
              disabled={posting || postBlocked !== undefined}
              loading={posting}
              variant="primary"
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
