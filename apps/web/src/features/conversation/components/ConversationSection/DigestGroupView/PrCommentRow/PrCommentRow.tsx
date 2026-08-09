import { Markdown } from "@web/components/Markdown/Markdown";
import { deriveDigestLine } from "../../../../utils/digestLine";
import { postdatesBrief } from "../../../../utils/postdate";
import rowStyles from "../../../../rows.module.scss";
import type { PrLevelComment } from "../../../../types";

export interface PrCommentRowProps {
  comment: PrLevelComment;
  expanded: boolean;
  toggle: (commentId: number) => void;
  /** The viewed revision's generation cutoff; absent marks nothing. */
  briefGeneratedAt?: string | undefined;
}

/**
 * A PR-level (non-thread) comment row — same disclosure pattern as the thread
 * rows, with the comment body as its detail.
 */
export function PrCommentRow({
  comment,
  expanded,
  toggle,
  briefGeneratedAt,
}: PrCommentRowProps) {
  return (
    <li className={rowStyles["row"]}>
      <button
        aria-expanded={expanded}
        className={rowStyles["rowButton"]}
        type="button"
        onClick={() => toggle(comment.commentId)}
      >
        <span className={rowStyles["rowAuthor"]}>
          @{comment.author.login}
          {comment.author.isBot ? (
            <span className={rowStyles["botTag"]}>bot</span>
          ) : null}
        </span>
        <span className={rowStyles["rowLine"]}>
          {deriveDigestLine(comment.body)}
        </span>
        {postdatesBrief(comment.createdAt, briefGeneratedAt) ? (
          <span className={rowStyles["chip"]} data-state="after-brief">
            after this brief
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className={rowStyles["detail"]}>
          <Markdown content={comment.body} renderSuggestions />
        </div>
      ) : null}
    </li>
  );
}
