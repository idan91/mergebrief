import { useTranslation } from "react-i18next";

import {
  receiptCommentLabel,
  type ReceiptComment,
} from "../../../utils/receipt";
import styles from "./ReceiptAccordion.module.scss";

export interface CommentListProps {
  comments: ReceiptComment[];
}

export function CommentList({ comments }: CommentListProps) {
  const { t } = useTranslation();
  if (comments.length === 0) {
    return <p className={styles["empty"]}>{t("review.summary.noComments")}</p>;
  }
  return (
    <div>
      {comments.map((comment) => (
        <div className={styles["itemRow"]} key={comment.id}>
          <span>
            {receiptCommentLabel(comment)}
            {comment.status === "submitted"
              ? ` · ${t("review.submit.receiptPostedTag")}`
              : ""}
          </span>
          <small>{comment.firstLine}</small>
        </div>
      ))}
    </div>
  );
}
