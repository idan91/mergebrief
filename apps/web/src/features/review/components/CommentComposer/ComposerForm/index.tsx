/* oxlint-disable jsx-a11y/no-autofocus --
   Single deliberate use: the composer mounts in response to an explicit
   click on a diff line, so moving focus into the textarea is the expected
   next action, not a page-load focus steal. */
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useId } from "react";

import { Button } from "@web/components/Button";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea";
import { useUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import { useMentionSuggestions } from "@web/features/conversation/hooks";
import { isInsideMenuOrDialog } from "@web/utils/overlay-target";
import {
  commentAnchorLabel,
  countAnchorLines,
  isFileCommentAnchor,
  reviewCommentSubmitLabel,
} from "../../../utils/comments";
import { useReviewActions, useReviewSession } from "../../../session";
import { MarkdownPreview } from "../../MarkdownPreview";
import type { CommentComposerProps } from "..";
import type { UnsavedCommentKey } from "../unsaved-text-storage";
import { useComposerFormFacade } from "./useComposerFormFacade";
import styles from "./ComposerForm.module.scss";

export interface ComposerFormProps extends CommentComposerProps {
  /** Where this place's text is kept; absent keeps it in memory only. */
  unsavedTextKey: UnsavedCommentKey | undefined;
}

export function ComposerForm({
  anchor,
  cancel,
  mentionSource,
  save,
  saving = false,
  unsavedTextKey,
}: ComposerFormProps) {
  const { t } = useTranslation();
  const composer = useComposerFormFacade(anchor, save, unsavedTextKey);
  const { announce, announceQuietly } = useReviewActions();
  const mentions = useMentionSuggestions(mentionSource);
  const errorId = useId();
  const guardId = useId();
  // Text kept in the tab's storage survives navigation; only text held
  // nowhere else registers, as reply drafts do not.
  const textOnlyInMemory = !composer.persisted && composer.body.trim() !== "";
  useUnsavedComposerText(guardId, textOnlyInMemory);
  // Selected here, the only consumer, so the count doesn't thread through
  // four component layers and bust every ChunkCard's memo on save/delete;
  // only a mounted (open) composer subscribes.
  const existingReviewCommentCount = useReviewSession(
    (state) => state.reviewComments.length,
  );

  // Escape-to-close: the composer holds `shortcutsDisabled` while open, so
  // without its own Escape handler the global shortcuts stay dead until the
  // reviewer clicks Cancel or Save. An Escape inside a menu or dialog closes
  // that overlay only, and one mid-save would discard nothing the write needs.
  const { discard } = composer;
  // A cancel the store refuses mid-save keeps the text the write may need.
  const cancelComposer = useCallback(() => {
    if (!saving) {
      discard();
    }
    cancel();
  }, [cancel, discard, saving]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ownEscape =
        event.key === "Escape" && !isInsideMenuOrDialog(event.target);
      const closesComposer = ownEscape && !saving;
      if (closesComposer) {
        cancelComposer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelComposer, saving]);

  const lineCount = isFileCommentAnchor(anchor)
    ? undefined
    : t("review.comment.lines", { count: countAnchorLines(anchor) });
  const suggestionSeed = isFileCommentAnchor(anchor)
    ? undefined
    : anchor.selectedText;
  const submitLabel = saving
    ? t("review.comment.saving")
    : reviewCommentSubmitLabel(t, existingReviewCommentCount);

  return (
    <div className={styles["composer"]}>
      <div className={styles["meta"]}>
        <span className={styles["location"]} data-anchor={anchor.kind}>
          {commentAnchorLabel(t, anchor)}
        </span>
        {lineCount !== undefined ? <span>{lineCount}</span> : null}
      </div>
      <MarkdownTextarea
        ariaBusy={saving}
        ariaInvalid={composer.error !== ""}
        autoFocus
        describedBy={composer.error !== "" ? errorId : undefined}
        label={t("review.comment.composerLabel")}
        mentionSuggestions={mentions.mentionSuggestions}
        onMentionQueryChange={mentions.onMentionQueryChange}
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
            to <body> the moment saving starts. The store refuses a cancel
            or a second save mid-write and announces why. */}
        <Button aria-disabled={saving || undefined} onClick={cancelComposer}>
          {t("review.comment.cancel")}
        </Button>
        <Button
          aria-busy={saving || undefined}
          aria-disabled={saving || undefined}
          variant="primary"
          onClick={composer.submit}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
