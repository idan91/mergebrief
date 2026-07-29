import { Markdown } from "@web/components/Markdown/Markdown";
import type { AddressedReviewComment } from "@web/features/brief/types";
import { addressedCommentRange } from "../AddressedComments/AddressedComments";
import styles from "./AddressedDiffComment.module.scss";

export interface AddressedDiffCommentProps {
  comment: AddressedReviewComment;
  label: string;
}

export function AddressedDiffComment({
  comment,
  label,
}: AddressedDiffCommentProps) {
  return (
    <details className={styles["comment"]}>
      <summary className={styles["head"]}>
        <span>
          @{comment.author} {label}
        </span>
        <span>
          {comment.file}
          {addressedCommentRange(comment)}
        </span>
      </summary>
      <div className={styles["preview"]}>
        <Markdown content={comment.body} renderSuggestions />
      </div>
      {comment.inReplyToId ? (
        <div className={styles["replyNote"]}>
          reply to {comment.inReplyToId}
        </div>
      ) : null}
    </details>
  );
}
