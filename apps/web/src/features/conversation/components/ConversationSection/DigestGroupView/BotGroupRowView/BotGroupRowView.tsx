import { useTranslation } from "react-i18next";
import { RowButton } from "@web/components/RowButton/RowButton";
import { botGroupChip } from "../../../../utils/chips";
import type { DigestRow } from "../../../../utils/digest";
import rowStyles from "../../../../rows.module.scss";
import type { ThreadComposerWiring } from "../../../../wiring";
import { ThreadRowView } from "../../../ThreadRowView/ThreadRowView";

export interface BotGroupRowViewProps {
  row: Extract<DigestRow, { kind: "bot-group" }>;
  groupId: string;
  expandedGroups: ReadonlySet<string>;
  toggleGroup: (key: string) => void;
  expandedThreads: ReadonlySet<number>;
  toggleThread: (threadId: number) => void;
  jumpToChunk: (
    chunkId: string,
    target?: { rowId: string; threadId: number },
  ) => void;
  composer: ThreadComposerWiring;
}

/** One bot's collapsed thread group — collapsed per author, never hidden. */
export function BotGroupRowView({
  row,
  groupId,
  expandedGroups,
  toggleGroup,
  expandedThreads,
  toggleThread,
  jumpToChunk,
  composer,
}: BotGroupRowViewProps) {
  const { t } = useTranslation();
  const key = `${groupId}:${row.author}`;
  const expanded = expandedGroups.has(key);
  const groupChip = botGroupChip(row);
  return (
    <li className={rowStyles["row"]}>
      <RowButton aria-expanded={expanded} onClick={() => toggleGroup(key)}>
        <span className={rowStyles["chip"]} data-state={groupChip}>
          {groupChip}
        </span>
        <span className={rowStyles["rowAuthor"]}>
          @{row.author}
          <span className={rowStyles["botTag"]}>
            {t("conversation.botTag")}
          </span>
        </span>
        <span className={rowStyles["rowLine"]}>
          {t("conversation.threadsOpen", {
            threads: row.threads.length,
            open: row.openCount,
          })}
        </span>
      </RowButton>
      {expanded ? (
        <ul className={rowStyles["nested"]}>
          {row.threads.map((threadRow) => (
            <ThreadRowView
              composer={composer}
              expanded={expandedThreads.has(threadRow.thread.rootCommentId)}
              jumpToChunk={jumpToChunk}
              key={threadRow.thread.rootCommentId}
              row={threadRow}
              toggle={toggleThread}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
