import { DraftCommentStatuses } from "types/comments";
import { useTranslation } from "react-i18next";

import { MentionText } from "@web/components/Markdown/MentionText";
import {
  receiptCommentLabel,
  type ReceiptComment,
} from "../../../utils/receipt";
import styles from "./ReceiptBody.module.scss";

export interface CommentListProps {
  comments: ReceiptComment[];
}

export function CommentList({ comments }: CommentListProps) {
  const { t } = useTranslation();
  if (comments.length === 0) {
    return <p className={styles["empty"]}>{t("review.summary.noComments")}</p>;
  }
  const postedTag = `· ${t("review.submit.receiptPostedTag")}`;
  const commentRows = comments.map((comment) => ({
    comment,
    label: receiptCommentLabel(comment),
    posted: comment.status === DraftCommentStatuses.SUBMITTED,
  }));

  return (
    <div>
      {commentRows.map(({ comment, label, posted }) => (
        <div className={styles["itemRow"]} key={comment.id}>
          <div className={styles["itemHead"]}>
            <b>
              <MentionText text={comment.firstLine} />
            </b>
            <span className={styles["itemAnchor"]}>
              <code title={label}>
                <bdi dir="ltr">{label}</bdi>
              </code>
              {posted ? <span>{postedTag}</span> : null}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
