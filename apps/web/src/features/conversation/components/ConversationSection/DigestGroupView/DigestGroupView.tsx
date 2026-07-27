import type { DigestGroup } from "../../../digest";
import rowStyles from "../../../rows.module.scss";
import type { ThreadComposerWiring } from "../../../wiring";
import { ThreadRowView } from "../../ThreadRowView/ThreadRowView";
import { BotGroupRowView } from "./BotGroupRowView/BotGroupRowView";
import { PrCommentRow } from "./PrCommentRow/PrCommentRow";
import styles from "./DigestGroupView.module.scss";

/** Rows shown per digest group before "Show more" (locked decision 6). */
export const GROUP_ROW_CAP = 50;

export interface DigestGroupViewProps {
  group: DigestGroup;
  expandedThreads: ReadonlySet<number>;
  toggleThread: (threadId: number) => void;
  expandedGroups: ReadonlySet<string>;
  toggleGroup: (key: string) => void;
  shownAll: boolean;
  showAll: (groupId: string) => void;
  jumpToChunk: (
    chunkId: string,
    target?: { rowId: string; threadId: number },
  ) => void;
  composer: ThreadComposerWiring;
}

/**
 * One digest group (a chunk's threads, or the PR-level bucket): thread rows,
 * per-bot collapsed groups, and PR-level comments — which share the group's
 * ~50-row budget and the SAME disclosure pattern (no second interaction
 * model).
 */
export function DigestGroupView({
  group,
  expandedThreads,
  toggleThread,
  expandedGroups,
  toggleGroup,
  shownAll,
  showAll,
  jumpToChunk,
  composer,
}: DigestGroupViewProps) {
  const rows = shownAll ? group.rows : group.rows.slice(0, GROUP_ROW_CAP);
  const hidden = group.rows.length - rows.length;
  const allPrComments = group.prComments ?? [];
  const prCommentBudget = Math.max(0, GROUP_ROW_CAP - rows.length);
  const prComments = shownAll
    ? allPrComments
    : allPrComments.slice(0, prCommentBudget);
  const hiddenPrComments = allPrComments.length - prComments.length;
  return (
    <section aria-label={group.label} className={styles["group"]}>
      <h3 className={styles["groupLabel"]}>
        {group.kind === "chunk" && group.chunkId !== undefined ? (
          <button
            className={styles["groupJump"]}
            type="button"
            onClick={() => {
              if (group.chunkId !== undefined) jumpToChunk(group.chunkId);
            }}
          >
            {group.label}
          </button>
        ) : (
          group.label
        )}
      </h3>
      <ul className={rowStyles["rows"]}>
        {rows.map((row) =>
          row.kind === "thread" ? (
            <ThreadRowView
              composer={composer}
              expanded={expandedThreads.has(row.thread.rootCommentId)}
              jumpToChunk={jumpToChunk}
              key={row.thread.rootCommentId}
              row={row}
              toggle={toggleThread}
            />
          ) : (
            <BotGroupRowView
              composer={composer}
              expandedGroups={expandedGroups}
              expandedThreads={expandedThreads}
              groupId={group.id}
              jumpToChunk={jumpToChunk}
              key={`${group.id}:${row.author}`}
              row={row}
              toggleGroup={toggleGroup}
              toggleThread={toggleThread}
            />
          ),
        )}
      </ul>
      {hidden > 0 ? (
        <button
          className={rowStyles["action"]}
          type="button"
          onClick={() => showAll(group.id)}
        >
          Show {hidden} more
        </button>
      ) : null}
      {prComments.length > 0 ? (
        <ul className={rowStyles["rows"]}>
          {prComments.map((comment) => (
            <PrCommentRow
              comment={comment}
              expanded={expandedThreads.has(comment.commentId)}
              key={comment.commentId}
              toggle={toggleThread}
            />
          ))}
        </ul>
      ) : null}
      {hiddenPrComments > 0 ? (
        <button
          className={rowStyles["action"]}
          type="button"
          onClick={() => showAll(group.id)}
        >
          Show {hiddenPrComments} more
        </button>
      ) : null}
    </section>
  );
}
