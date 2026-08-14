import { useTranslation } from "react-i18next";
import { RowButton } from "@web/components/RowButton/RowButton";
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
 * One thread's digest row: a `<button aria-expanded>` disclosure over the
 * thread detail. Also rendered at the chunk by DiffTable and InlineThreads.
 *
 * A settled thread collapses to the slim variant — one faint line, same single
 * button and handler; the collapsed row carries no actions of its own.
 */
export function ThreadRowView({
  row,
  expanded,
  toggle,
  jumpToChunk,
  composer,
  hideJump = false,
}: ThreadRowViewProps) {
  const { t } = useTranslation();
  const { thread } = row;
  const author = thread.comments[0]?.author;
  const commentCount = thread.comments.length;
  // Outdated wins over resolved: it is WHY the thread left the code view, so
  // those rows stay full. Expanding any thread restores the full row too.
  const slim = thread.isResolved && !thread.isOutdated && !expanded;
  return (
    <li
      className={rowStyles["row"]}
      // The ?thread= landing target — DISTINCT from the inline diff rows'
      // `data-conversation-thread`: the section renders above the change
      // groups, so sharing that name would shadow the diff row in document
      // order. Section rows only; `hideJump` marks the at-chunk renders.
      data-conversation-section-thread={
        hideJump ? undefined : thread.rootCommentId
      }
    >
      <RowButton
        aria-expanded={expanded}
        data-testid="thread-row"
        density={slim ? "slim" : "full"}
        onClick={() => toggle(thread.rootCommentId)}
      >
        {slim ? (
          <>
            {/* The literal, not the chip: a settled row's whole point is to
                stop competing for attention. */}
            <span className={rowStyles["slimLabel"]}>
              {t("conversation.resolved")}
            </span>
            <SlimSeparator />
            <span className={rowStyles["rowAuthor"]}>@{author?.login}</span>
            <SlimSeparator />
            <span className={rowStyles["rowLine"]}>{row.digestLine}</span>
            {commentCount > 1 ? (
              <>
                <SlimSeparator />
                <span className={rowStyles["count"]}>
                  {t("conversation.comments", { count: commentCount })}
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
            {author?.avatarUrl === undefined ? null : (
              // Decorative — the adjacent login carries the identity.
              <img
                alt=""
                className={rowStyles["rowAvatar"]}
                decoding="async"
                loading="lazy"
                src={author.avatarUrl}
              />
            )}
            <span className={rowStyles["rowAuthor"]}>@{author?.login}</span>
            <span className={rowStyles["rowLine"]}>{row.digestLine}</span>
            {row.isOwn ? (
              <span className={rowStyles["ownTag"]}>
                {t("conversation.yours")}
              </span>
            ) : null}
            {row.anchorLabel !== undefined ? (
              <span className={rowStyles["revision"]}>
                {t("conversation.atRevision", { label: row.anchorLabel })}
              </span>
            ) : null}
            <span className={rowStyles["count"]}>
              {commentCount > 1 ? `${commentCount} comments` : null}
            </span>
          </>
        )}
      </RowButton>
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
