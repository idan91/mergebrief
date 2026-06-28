import {
  commentAnchorLabel,
  reviewCommentSubmitLabel,
  type CommentAnchor,
} from "../../comments";
import { MarkdownPreview } from "../MarkdownPreview/MarkdownPreview";
import { useCommentComposerFacade } from "./useCommentComposerFacade";
import styles from "./CommentComposer.module.scss";

export interface CommentComposerProps {
  anchor: CommentAnchor;
  cancel: () => void;
  existingReviewCommentCount: number;
  save: (anchor: CommentAnchor, body: string) => void;
}

export function CommentComposer({
  anchor,
  cancel,
  existingReviewCommentCount,
  save,
}: CommentComposerProps) {
  const composer = useCommentComposerFacade(anchor, save);

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
