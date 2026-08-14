import { useTranslation } from "react-i18next";
import type { DigestGroup } from "../../../utils/digest";
import { Button } from "@web/components/Button/Button";
import { LinkButton } from "@web/components/LinkButton/LinkButton";
import rowStyles from "../../../rows.module.scss";
import type { ThreadComposerWiring } from "../../../wiring";
import { ThreadRowView } from "../../ThreadRowView/ThreadRowView";
import { BotGroupRowView } from "./BotGroupRowView/BotGroupRowView";
import { PrCommentRow } from "./PrCommentRow/PrCommentRow";
import styles from "./DigestGroupView.module.scss";

/** Rows shown per digest group before "Show more". */
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
  /** Generation cutoff for PR-level rows only; thread rows carry their own. */
  briefGeneratedAt?: string | undefined;
}

/**
 * One digest group (a chunk's threads, or the PR-level bucket). Thread rows,
 * per-bot groups and PR-level comments share the group's row budget and the
 * same disclosure pattern.
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
  briefGeneratedAt,
}: DigestGroupViewProps) {
  const { t } = useTranslation();
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
          <LinkButton
            className={styles["groupJump"]}
            onClick={() => {
              if (group.chunkId !== undefined) jumpToChunk(group.chunkId);
            }}
          >
            {group.label}
          </LinkButton>
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
        <Button variant="quiet" onClick={() => showAll(group.id)}>
          {t("conversation.showMore", { count: hidden })}
        </Button>
      ) : null}
      {prComments.length > 0 ? (
        <ul className={rowStyles["rows"]}>
          {prComments.map((comment) => (
            <PrCommentRow
              briefGeneratedAt={briefGeneratedAt}
              comment={comment}
              expanded={expandedThreads.has(comment.commentId)}
              key={comment.commentId}
              toggle={toggleThread}
            />
          ))}
        </ul>
      ) : null}
      {hiddenPrComments > 0 ? (
        <Button variant="quiet" onClick={() => showAll(group.id)}>
          {t("conversation.showMore", { count: hiddenPrComments })}
        </Button>
      ) : null}
    </section>
  );
}
