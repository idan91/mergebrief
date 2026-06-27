import {
  commentAnchorLabel,
  reviewCommentSubmitLabel,
  type CommentAnchor,
} from "../../comments";
import { MarkdownPreview } from "../MarkdownPreview/MarkdownPreview";
import { useCommentComposerFacade } from "./useCommentComposerFacade";

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
    <div className="comment-composer">
      <div className="comment-meta">
        <span>{commentAnchorLabel(anchor)}</span>
        <span>
          {anchor.rowIds.length} line{anchor.rowIds.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="comment-tabs">
        <button
          className={composer.mode === "write" ? "active" : ""}
          type="button"
          onClick={() => composer.setMode("write")}
        >
          Write
        </button>
        <button
          className={composer.mode === "preview" ? "active" : ""}
          type="button"
          onClick={() => composer.setMode("preview")}
        >
          Preview
        </button>
      </div>
      {composer.mode === "write" ? (
        <>
          <div className="comment-toolbar">
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
        <div className="comment-error">{composer.error}</div>
      ) : null}
      <div className="comment-actions">
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
