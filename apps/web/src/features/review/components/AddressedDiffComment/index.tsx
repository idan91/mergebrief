import { useTranslation } from "react-i18next";
import { Markdown } from "@web/components/Markdown";
import type { AddressedReviewComment } from "@web/features/brief/types";
import { addressedCommentRange } from "../AddressedComments";
import styles from "./AddressedDiffComment.module.scss";

export interface AddressedDiffCommentProps {
  comment: AddressedReviewComment;
  label: string;
}

export function AddressedDiffComment({
  comment,
  label,
}: AddressedDiffCommentProps) {
  const { t } = useTranslation();
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
  );
}
