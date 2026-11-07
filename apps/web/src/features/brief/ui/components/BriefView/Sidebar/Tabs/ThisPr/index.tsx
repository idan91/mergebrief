import { useEffect, useRef } from "react";

import type { GroupView } from "../../../../../../model/utils/view-model";
import type { JumpChunkFromSidebar, JumpFromSidebar } from "../../types";
import { ChunkRows } from "./ChunkRows";
import { CHUNK_ROW_SELECTOR } from "./ChunkRows/consts";
import { GroupRow } from "./GroupRow";
import { ViewedSummary } from "./ViewedSummary";
import styles from "./ThisPr.module.scss";

export interface ThisPrProps {
  groups: GroupView[];
  activeGroupId: string | null;
  conversationGroupIds?: ReadonlySet<string> | undefined;
  jumpToGroup: JumpFromSidebar;
  /** Lists each group's chunks under it, for the Sidebar sheet; absent keeps the groups alone. */
  jumpToChunk?: JumpChunkFromSidebar | undefined;
  /** True while This PR is the selected tab; the Sidebar sheet centres the chunk being read each time it turns true. */
  selected?: boolean;
}

/** The This PR tab's content: the change groups in Brief order, the current one marked, each row a jump. */
export function ThisPr({
  groups,
  activeGroupId,
  conversationGroupIds,
  jumpToGroup,
  jumpToChunk,
  selected,
}: ThisPrProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The Sidebar sheet shows This PR where you are, not at the first group.
  useEffect(() => {
    if (selected !== true) {
      return;
    }
    panelRef.current
      ?.querySelector(`${CHUNK_ROW_SELECTOR}[aria-current="true"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [selected]);

  return (
    <div className={styles["panel"]} ref={panelRef}>
      {jumpToChunk === undefined ? null : <ViewedSummary groups={groups} />}
      <ol className={styles["list"]}>
        {groups.map((group) => (
          <li key={group.id}>
            <GroupRow
              activeGroupId={activeGroupId}
              conversationGroupIds={conversationGroupIds}
              group={group}
              jumpToGroup={jumpToGroup}
            />
            {jumpToChunk === undefined ? null : (
              <ChunkRows chunks={group.chunks} jumpToChunk={jumpToChunk} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
