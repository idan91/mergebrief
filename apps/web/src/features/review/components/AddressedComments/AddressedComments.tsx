import { Markdown } from "../../../../components/Markdown/Markdown";
import type { AddressedReviewComment, BriefChunk } from "../../../brief/types";

/** Formats the line range suffix for an addressed (shipped) review comment. */
export function addressedCommentRange(comment: AddressedReviewComment): string {
  if (comment.startLine != null && comment.line != null)
    return `:${comment.startLine}-${comment.line}`;
  if (comment.line != null) return `:${comment.line}`;
  if (comment.originalStartLine != null && comment.originalLine != null)
    return `:original ${comment.originalStartLine}-${comment.originalLine}`;
  if (comment.originalLine != null) return `:original ${comment.originalLine}`;
  return "";
}

export interface ReviewCommentsProps {
  comments: AddressedReviewComment[];
  label: string;
}

export function ReviewComments({ comments, label }: ReviewCommentsProps) {
  return (
    <div className="addressed-comments">
      {comments.map((comment) => (
        <details className="addressed-comment" key={comment.id}>
          <summary>
            <span>@{comment.author}</span>
            <b>
              {comment.file}
              {addressedCommentRange(comment)}
            </b>
            <em>
              {label} {comment.id}
            </em>
          </summary>
          <Markdown content={comment.body} />
          {comment.inReplyToId ? (
            <div className="reply-note">reply to {comment.inReplyToId}</div>
          ) : null}
        </details>
      ))}
    </div>
  );
}

export interface AddressedCommentsProps {
  chunk: BriefChunk;
  comments: AddressedReviewComment[];
}

export function AddressedComments({ chunk, comments }: AddressedCommentsProps) {
  const ids = chunk.addressesComments ?? [];
  if (ids.length === 0) return null;
  if (comments.length === 0) {
    return <span>addresses comments {ids.join(", ")}</span>;
  }
  return <ReviewComments comments={comments} label="comment" />;
}
