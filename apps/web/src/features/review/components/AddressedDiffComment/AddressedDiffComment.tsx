import { Markdown } from "../../../../components/Markdown/Markdown";
import type { AddressedReviewComment } from "../../../brief/types";
import { addressedCommentRange } from "../AddressedComments/AddressedComments";

export interface AddressedDiffCommentProps {
  comment: AddressedReviewComment;
  label: string;
}

export function AddressedDiffComment({
  comment,
  label,
}: AddressedDiffCommentProps) {
  return (
    <details className="comment-thread addressed-diff-comment">
      <summary className="comment-thread-head">
        <span>
          @{comment.author} {label}
        </span>
        <span>
          {comment.file}
          {addressedCommentRange(comment)}
        </span>
      </summary>
      <div className="comment-preview">
        <Markdown content={comment.body} />
      </div>
      {comment.inReplyToId ? (
        <div className="reply-note">reply to {comment.inReplyToId}</div>
      ) : null}
    </details>
  );
}
