import { threadStateChip } from "../../utils/chips";
import type { DigestThreadRow } from "../../utils/digest";
import rowStyles from "../../rows.module.scss";
import type { ThreadComposerWiring } from "../../wiring";
import { ThreadDetail } from "./ThreadDetail/ThreadDetail";

export interface ThreadRowViewProps {
  row: DigestThreadRow;
  expanded: boolean;
  toggle: (threadId: number) => void;
  jumpToChunk: (
    chunkId: string,
    target?: { rowId: string; threadId: number },
  ) => void;
  composer: ThreadComposerWiring;
  /** Marks the inline (at-chunk) renders, which suppress the jump action. */
  hideJump?: boolean;
}

/**
 * One thread's digest row: a plain `<button aria-expanded>` disclosure over
 * the thread detail. Promoted to a ConversationSection sibling — DiffTable
 * and InlineThreads render it at the chunk (ADR 0037 promotion rule).
 */
export function ThreadRowView({
  row,
  expanded,
  toggle,
  jumpToChunk,
  composer,
  hideJump = false,
}: ThreadRowViewProps) {
  const { thread } = row;
  const author = thread.comments[0]?.author;
  return (
    <li
      className={rowStyles["row"]}
      // The ?thread= landing target — a DISTINCT attribute from the inline
      // diff rows' `data-conversation-thread`. The section renders ABOVE the
      // change groups, so sharing that name would shadow the diff row in
      // document order and break the digest's "Jump to comment" landing on
      // the thread's own row. Section rows only: `hideJump` marks the inline
      // (at-chunk) renders of this same component.
      data-conversation-section-thread={
        hideJump ? undefined : thread.rootCommentId
      }
    >
      <button
        aria-expanded={expanded}
        className={rowStyles["rowButton"]}
        type="button"
        onClick={() => toggle(thread.rootCommentId)}
      >
        <span
          className={rowStyles["chip"]}
          data-state={threadStateChip(thread)}
        >
          {threadStateChip(thread)}
        </span>
        <span className={rowStyles["rowAuthor"]}>@{author?.login}</span>
        <span className={rowStyles["rowLine"]}>{row.digestLine}</span>
        {row.isOwn ? <span className={rowStyles["ownTag"]}>yours</span> : null}
        {row.anchorLabel !== undefined ? (
          <span className={rowStyles["revision"]}>at {row.anchorLabel}</span>
        ) : null}
        <span className={rowStyles["count"]}>
          {thread.comments.length > 1
            ? `${thread.comments.length} comments`
            : null}
        </span>
      </button>
      {expanded ? (
        <ThreadDetail
          composer={composer}
          hideJump={hideJump}
          jumpToChunk={jumpToChunk}
          row={row}
        />
      ) : null}
    </li>
  );
}
