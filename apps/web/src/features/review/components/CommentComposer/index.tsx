/* oxlint-disable jsx-a11y/no-autofocus --
   Single deliberate use: the composer mounts in response to an explicit
   click on a diff line, so moving focus into the textarea is the expected
   next action, not a page-load focus steal. */
import { useTranslation } from "react-i18next";
import { useEffect, useId } from "react";

import { Button } from "@web/components/Button";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea";
import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import { useUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import {
  commentAnchorLabel,
  isFileCommentAnchor,
  reviewCommentSubmitLabel,
  type CommentAnchor,
} from "../../utils/comments";
import { useReviewActions, useReviewSession } from "../../session";
import { MarkdownPreview } from "../MarkdownPreview";
import { useCommentComposerFacade } from "./useCommentComposerFacade";
import styles from "./CommentComposer.module.scss";

export interface CommentComposerProps {
  anchor: CommentAnchor;
  cancel: () => void;
  /** Mention-autocomplete pool (repo collaborators); absent on the local path. */
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  save: (anchor: CommentAnchor, body: string) => void;
  /** The staged-draft write is in flight; the composer closes when it lands. */
  saving?: boolean | undefined;
}

export function CommentComposer({
  anchor,
  cancel,
  mentionCandidates,
  save,
  saving = false,
}: CommentComposerProps) {
  const { t } = useTranslation();
  const composer = useCommentComposerFacade(anchor, save);
  const { announce, announceQuietly } = useReviewActions();
  const errorId = useId();
  const guardId = useId();
  // The composer's text exists nowhere else until saved as a draft.
  // navigation would destroy it.
  useUnsavedComposerText(guardId, composer.body.trim() !== "");
  // Selected here, the only consumer, so the count doesn't thread through
  // four component layers and bust every ChunkCard's memo on save/delete;
  // only a mounted (open) composer subscribes.
  const existingReviewCommentCount = useReviewSession(
    (state) => state.reviewComments.length,
  );

  // Escape-to-close: the composer holds `shortcutsDisabled` while open, so
  // without its own Escape handler the global shortcuts stay dead until the
  // reviewer clicks Cancel or Save.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  const lineCount = isFileCommentAnchor(anchor)
    ? undefined
    : t("review.comment.lines", { count: anchor.rowIds.length });
  const suggestionSeed = isFileCommentAnchor(anchor)
    ? undefined
    : anchor.selectedText;

  return (
    <div className={styles["composer"]}>
      <div className={styles["meta"]}>
        <span>{commentAnchorLabel(t, anchor)}</span>
        {lineCount !== undefined ? <span>{lineCount}</span> : null}
      </div>
      <MarkdownTextarea
        ariaBusy={saving}
        ariaInvalid={composer.error !== ""}
        autoFocus
        describedBy={composer.error !== "" ? errorId : undefined}
        label={t("review.comment.composerLabel")}
        mentionCandidates={mentionCandidates}
        placeholder={t("conversation.composerPlaceholder")}
        renderPreview={(body) => (
          <MarkdownPreview anchor={anchor} body={body} />
        )}
        readOnly={saving}
        suggestionSeed={suggestionSeed}
        value={composer.body}
        announce={announce}
        announceQuietly={announceQuietly}
        onAttachError={composer.failAttach}
        onChange={composer.onBodyChange}
        onSubmit={composer.submit}
      />
      {composer.error ? (
        <div className={styles["error"]} id={errorId} role="alert">
          {composer.error}
        </div>
      ) : null}
      <div className={styles["actions"]}>
        {/* Focusable-disabled: a hard `disabled` would drop keyboard/SR focus
            to <body> the moment saving starts. The click guard is in the
            store's one-in-flight rule. */}
        <Button
          aria-busy={saving || undefined}
          aria-disabled={saving || undefined}
          variant="accent"
          onClick={composer.submit}
        >
          {saving
            ? t("review.comment.saving")
            : reviewCommentSubmitLabel(t, existingReviewCommentCount)}
        </Button>
        <Button onClick={cancel}>{t("review.comment.cancel")}</Button>
      </div>
    </div>
  );
}
