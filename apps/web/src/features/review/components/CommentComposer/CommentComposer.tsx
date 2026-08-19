/* oxlint-disable jsx-a11y/no-autofocus --
   Single deliberate use: the composer mounts in response to an explicit
   click on a diff line, so moving focus into the textarea is the expected
   next action — not a page-load focus steal. */
import { useTranslation } from "react-i18next";
import { useEffect, useId } from "react";

import { Button } from "@web/components/Button/Button";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import { useUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import {
  commentAnchorLabel,
  reviewCommentSubmitLabel,
  type CommentAnchor,
} from "../../utils/comments";
import { useReviewSession } from "../../session";
import { MarkdownPreview } from "../MarkdownPreview/MarkdownPreview";
import { useCommentComposerFacade } from "./useCommentComposerFacade";
import styles from "./CommentComposer.module.scss";

export interface CommentComposerProps {
  anchor: CommentAnchor;
  cancel: () => void;
  /** Mention-autocomplete pool (repo collaborators); absent on the local path. */
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  save: (anchor: CommentAnchor, body: string) => void;
}

export function CommentComposer({
  anchor,
  cancel,
  mentionCandidates,
  save,
}: CommentComposerProps) {
  const { t } = useTranslation();
  const composer = useCommentComposerFacade(anchor, save);
  const errorId = useId();
  const guardId = useId();
  // The composer's text exists nowhere else until saved as a draft —
  // navigation would destroy it.
  useUnsavedComposerText(guardId, composer.body.trim() !== "");
  // Selected here — the only consumer — so the count doesn't thread through
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

  return (
    <div className={styles["composer"]}>
      <div className={styles["meta"]}>
        <span>{commentAnchorLabel(anchor)}</span>
        <span>
          {t("review.comment.lines", { count: anchor.rowIds.length })}
        </span>
      </div>
      <MarkdownTextarea
        ariaInvalid={composer.error !== ""}
        autoFocus
        describedBy={composer.error !== "" ? errorId : undefined}
        label={t("review.comment.composerLabel")}
        mentionCandidates={mentionCandidates}
        placeholder={t("conversation.composerPlaceholder")}
        renderPreview={(body) => (
          <MarkdownPreview anchor={anchor} body={body} />
        )}
        suggestionSeed={anchor.selectedText}
        value={composer.body}
        onChange={composer.onBodyChange}
        onSubmit={composer.submit}
      />
      {composer.error ? (
        <div className={styles["error"]} id={errorId} role="alert">
          {composer.error}
        </div>
      ) : null}
      <div className={styles["actions"]}>
        <Button variant="primary" onClick={composer.submit}>
          {reviewCommentSubmitLabel(t, existingReviewCommentCount)}
        </Button>
        <Button onClick={cancel}>{t("review.comment.cancel")}</Button>
      </div>
    </div>
  );
}
