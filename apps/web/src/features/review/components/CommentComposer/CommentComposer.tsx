/* eslint-disable jsx-a11y/no-autofocus --
   Single deliberate use: the composer mounts in response to an explicit
   click on a diff line, so moving focus into the textarea is the expected
   next action — not a page-load focus steal. */
import { useEffect } from "react";

import {
  commentAnchorLabel,
  reviewCommentSubmitLabel,
  type CommentAnchor,
} from "../../comments";
import { useMindMap } from "../../session";
import { MarkdownPreview } from "../MarkdownPreview/MarkdownPreview";
import { useCommentComposerFacade } from "./useCommentComposerFacade";
import styles from "./CommentComposer.module.scss";

export interface CommentComposerProps {
  anchor: CommentAnchor;
  cancel: () => void;
  save: (anchor: CommentAnchor, body: string) => void;
}

export function CommentComposer({
  anchor,
  cancel,
  save,
}: CommentComposerProps) {
  const composer = useCommentComposerFacade(anchor, save);
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
      <div className={styles["tabs"]}>
        <button
          data-state={composer.mode === "write" ? "active" : undefined}
          type="button"
          onClick={() => composer.setMode("write")}
        >
          Write
        </button>
        <button
          data-state={composer.mode === "preview" ? "active" : undefined}
          type="button"
          onClick={() => composer.setMode("preview")}
        >
          Preview
        </button>
      </div>
      {composer.mode === "write" ? (
        <>
          <div className={styles["toolbar"]}>
            <button type="button" onClick={composer.wrapBold}>
              B
            </button>
            <button type="button" onClick={composer.wrapItalic}>
              I
            </button>
            <button type="button" onClick={composer.wrapCode}>
              Code
            </button>
            <button type="button" onClick={composer.insertQuote}>
              Quote
            </button>
            <button type="button" onClick={composer.insertList}>
              List
            </button>
            <button type="button" onClick={composer.insertOrderedList}>
              1.
            </button>
            <button type="button" onClick={composer.insertTask}>
              Task
            </button>
            <button type="button" onClick={composer.insertLink}>
              Link
            </button>
            <button type="button" onClick={composer.insertSuggestion}>
              Suggestion
            </button>
          </div>
          <textarea
            className={styles["textarea"]}
            ref={composer.textareaRef}
            autoFocus
            onChange={(event) => composer.onBodyChange(event.target.value)}
            onKeyDown={composer.onKeyDown}
            placeholder="Leave a comment"
            suppressHydrationWarning
            value={composer.body}
          />
        </>
      ) : (
        <MarkdownPreview anchor={anchor} body={composer.body} />
      )}
      {composer.error ? (
        <div className={styles["error"]}>{composer.error}</div>
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
