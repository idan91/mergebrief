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

/** Decorative run separator — aria-hidden, so it stays out of the row's name. */
function SlimSeparator() {
  return (
    <span aria-hidden="true" className={rowStyles["slimSep"]}>
      ·
    </span>
  );
}

/**
 * One thread's digest row: a plain `<button aria-expanded>` disclosure over
 * the thread detail. Promoted to a ConversationSection sibling — DiffTable
 * and InlineThreads render it at the chunk (ADR 0037 promotion rule).
 *
 * A settled thread collapses to the SLIM variant (BRIEF-93): one faint line
 * instead of a framed row. Same single button, same handler — the collapsed
 * row carries no actions of its own.
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
  const commentCount = thread.comments.length;
  // Outdated wins over resolved (the chip's rule, unchanged): outdated is WHY
  // the thread left the code view, and that fact outranks settledness — so
  // those rows stay full. Expanding any thread restores the full row too.
  const slim = thread.isResolved && !thread.isOutdated && !expanded;
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
        data-testid="thread-row"
        data-variant={slim ? "slim" : "full"}
        type="button"
        onClick={() => toggle(thread.rootCommentId)}
      >
        {slim ? (
          <>
            {/* The literal, not the chip: a settled row's whole point is to
                stop competing for attention. */}
            <span className={rowStyles["slimLabel"]}>resolved</span>
            <SlimSeparator />
            <span className={rowStyles["rowAuthor"]}>@{author?.login}</span>
            <SlimSeparator />
            <span className={rowStyles["rowLine"]}>{row.digestLine}</span>
            {commentCount > 1 ? (
              <>
                <SlimSeparator />
                <span className={rowStyles["count"]}>
                  {commentCount} comments
                </span>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span
              className={rowStyles["chip"]}
              data-state={threadStateChip(thread)}
            >
              {threadStateChip(thread)}
            </span>
            <span className={rowStyles["rowAuthor"]}>@{author?.login}</span>
            <span className={rowStyles["rowLine"]}>{row.digestLine}</span>
            {row.isOwn ? (
              <span className={rowStyles["ownTag"]}>yours</span>
            ) : null}
            {row.anchorLabel !== undefined ? (
              <span className={rowStyles["revision"]}>
                at {row.anchorLabel}
              </span>
            ) : null}
            <span className={rowStyles["count"]}>
              {commentCount > 1 ? `${commentCount} comments` : null}
            </span>
          </>
        )}
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
