/* eslint-disable jsx-a11y/no-autofocus --
   Single deliberate use: the composer mounts in response to an explicit
   click on a diff line, so moving focus into the textarea is the expected
   next action — not a page-load focus steal. */
import { useEffect, useId } from "react";

import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import { useUnsavedComposerText } from "@web/hooks/useUnsavedComposerGuard";
import {
  commentAnchorLabel,
  reviewCommentSubmitLabel,
  type CommentAnchor,
} from "../../utils/comments";
import { useMindMap } from "../../session";
import { MarkdownPreview } from "../MarkdownPreview/MarkdownPreview";
import { useCommentComposerFacade } from "./useCommentComposerFacade";
import styles from "./CommentComposer.module.scss";

export interface CommentComposerProps {
  anchor: CommentAnchor;
  cancel: () => void;
  /** Mention-autocomplete pool (repo collaborators — BRIEF-94); absent on the local path. */
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  save: (anchor: CommentAnchor, body: string) => void;
}

export function CommentComposer({
  anchor,
  cancel,
  mentionCandidates,
  save,
}: CommentComposerProps) {
  const composer = useCommentComposerFacade(anchor, save);
  const errorId = useId();
  const guardId = useId();
  // The composer's text exists nowhere else until saved as a draft —
  // navigation would destroy it (BRIEF-56 navigation guard).
  useUnsavedComposerText(guardId, composer.body.trim() !== "");
  // Selected here — the only consumer — so the count doesn't thread
  // through four component layers and bust every ChunkCard's memo on
  // save/delete; only a mounted (open) composer subscribes (BRIEF-27).
  const existingReviewCommentCount = useMindMap(
    (state) => state.reviewComments.length,
  );

  // Escape-to-close, mirroring Modal's convention: the composer is an overlay
  // that holds `shortcutsDisabled` while open (BriefPage), but — unlike
  // Modal — it never wired Escape to its own dismiss handler. Without this,
  // Escape does nothing while the composer is open (the global J/K/Z listener
  // stands down because `disabled` is true, and there is no other close path
  // for Escape), so the composer never unmounts, `activeCommentAnchor` never
  // clears, and J/K/Z stay dead until the reviewer notices they must click
  // Cancel/save explicitly.
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
          {anchor.rowIds.length} line{anchor.rowIds.length === 1 ? "" : "s"}
        </span>
      </div>
      <MarkdownTextarea
        ariaInvalid={composer.error !== ""}
        autoFocus
        describedBy={composer.error !== "" ? errorId : undefined}
        label="Comment"
        mentionCandidates={mentionCandidates}
        placeholder="Leave a comment"
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
        <button className="btn primary" type="button" onClick={composer.submit}>
          {reviewCommentSubmitLabel(existingReviewCommentCount)}
        </button>
        <button className="btn" type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
