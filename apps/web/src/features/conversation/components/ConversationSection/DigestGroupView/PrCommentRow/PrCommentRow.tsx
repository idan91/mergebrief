import { Markdown } from "@web/components/Markdown/Markdown";
import { deriveDigestLine } from "../../../../digestLine";
import rowStyles from "../../../../rows.module.scss";
import type { PrLevelComment } from "../../../../types";

export interface PrCommentRowProps {
  comment: PrLevelComment;
  expanded: boolean;
  toggle: (commentId: number) => void;
}

/**
 * A PR-level (non-thread) comment row — the same disclosure pattern as the
 * thread rows (one interaction model), with the comment body as its detail.
 */
export function PrCommentRow({ comment, expanded, toggle }: PrCommentRowProps) {
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
      </button>
      {expanded ? (
        <div className={rowStyles["detail"]}>
          <Markdown content={comment.body} />
        </div>
      ) : null}
    </li>
  );
}
