import { useTranslation } from "react-i18next";
import { Markdown } from "@web/components/Markdown";
import type {
  AddressedReviewComment,
  BriefChunk,
} from "@web/features/brief/model";
import styles from "./AddressedComments.module.scss";

/** Formats the line range suffix for an addressed (shipped) review comment. */
export function addressedCommentRange(comment: AddressedReviewComment): string {
  if (comment.startLine !== undefined && comment.line !== undefined) {
    return `:${comment.startLine}-${comment.line}`;
  }
  if (comment.line !== undefined) {
    return `:${comment.line}`;
  }
  if (
    comment.originalStartLine !== undefined &&
    comment.originalLine !== undefined
  ) {
    return `:original ${comment.originalStartLine}-${comment.originalLine}`;
  }
  if (comment.originalLine !== undefined) {
    return `:original ${comment.originalLine}`;
  }
  return "";
}

export interface ReviewCommentsProps {
  comments: AddressedReviewComment[];
  label: string;
}

export function ReviewComments({ comments, label }: ReviewCommentsProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["comments"]}>
      {comments.map((comment) => (
        <details className={styles["comment"]} key={comment.id}>
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
          <div className={styles["body"]}>
            <Markdown
              content={comment.body}
              filePath={comment.file}
              renderHtml
              renderSuggestions
            />
          </div>
          {comment.inReplyToId ? (
            <div className={styles["replyNote"]}>
              {t("review.comment.replyTo", { id: comment.inReplyToId })}
            </div>
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
  const { t } = useTranslation();
  const ids = chunk.addressesComments ?? [];
  if (ids.length === 0) {
    return null;
  }
  if (comments.length === 0) {
    return (
      <span>
        {t("review.comment.addressesComments", { ids: ids.join(", ") })}
      </span>
    );
  }
  return (
    <ReviewComments
      comments={comments}
      label={t("review.comment.commentLabel")}
    />
  );
}
