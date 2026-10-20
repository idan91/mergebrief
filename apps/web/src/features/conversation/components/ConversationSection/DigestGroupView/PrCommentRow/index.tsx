import type { PrLevelCommentView } from "contract";
import { useTranslation } from "react-i18next";
import { Markdown } from "@web/components/Markdown";
import { RowButton } from "@web/components/RowButton";
import { deriveDigestLine } from "../../../../utils/digestLine";
import { NO_OWN_REVIEWS, postdatesBrief } from "../../../../utils/postdate";
import rowStyles from "../../../../rows.module.scss";

export interface PrCommentRowProps {
  comment: PrLevelCommentView;
  expanded: boolean;
  toggle: (commentId: number) => void;
  /** The viewed revision's generation cutoff; absent marks nothing. */
  briefGeneratedAt?: string | undefined;
}

/**
 * A PR-level (non-thread) comment row, same disclosure pattern as the thread
 * rows, with the comment body as its detail.
 */
export function PrCommentRow({
  comment,
  expanded,
  toggle,
  briefGeneratedAt,
}: PrCommentRowProps) {
  const { t } = useTranslation();
  const digestLine =
    deriveDigestLine(comment.body) ?? t("conversation.digestCodeOnly");
  return (
    <li className={rowStyles["row"]}>
      <RowButton
        aria-expanded={expanded}
        onClick={() => toggle(comment.commentId)}
      >
        <span className={rowStyles["rowAuthor"]}>
          @{comment.author.login}
          {comment.author.isBot ? (
            <span className={rowStyles["botTag"]}>
              {t("conversation.botTag")}
            </span>
          ) : null}
        </span>
        <span className={rowStyles["rowLine"]}>{digestLine}</span>
        {postdatesBrief(comment, briefGeneratedAt, NO_OWN_REVIEWS) ? (
          <span className={rowStyles["chip"]} data-state="after-brief">
            {t("conversation.afterThisBrief")}
          </span>
        ) : null}
      </RowButton>
      {expanded ? (
        <div className={rowStyles["detail"]}>
          <Markdown
            content={comment.body}
            renderHtml
            renderMentions
            renderSuggestions
          />
        </div>
      ) : null}
    </li>
  );
}
