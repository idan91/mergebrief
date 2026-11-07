import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";

import { GroupViewKinds } from "../../../../../../../model/utils/remainder";
import {
  getCategoryLabel,
  hasChangedLines,
  type GroupView,
} from "../../../../../../../model/utils/view-model";
import { resolveGroupName } from "../../../../../../../model/utils/resolve-group-name";
import type { JumpFromSidebar } from "../../../types";
import { getChunkCountsLabel } from "./utils";
import styles from "./GroupRow.module.scss";

export interface GroupRowProps {
  group: GroupView;
  activeGroupId: string | null;
  conversationGroupIds?: ReadonlySet<string> | undefined;
  jumpToGroup: JumpFromSidebar;
}

export function GroupRow({
  group,
  activeGroupId,
  conversationGroupIds,
  jumpToGroup,
}: GroupRowProps) {
  const { t } = useTranslation();
  const current = group.id === activeGroupId;
  const hasConversation = conversationGroupIds?.has(group.id) ?? false;
  const attributed = group.kind === GroupViewKinds.ATTRIBUTED;

  const ordinal = group.index + 1;
  const name = resolveGroupName(t, group);
  const categoryLabel = attributed
    ? getCategoryLabel(t, group.group.dominantCategory)
    : undefined;
  const chunkCounts = attributed ? getChunkCountsLabel(t, group) : undefined;
  const added = attributed ? group.coreAdded : group.added;
  const deleted = attributed ? group.coreDeleted : group.deleted;
  const showsLines = attributed || hasChangedLines(group);

  return (
    // oxlint-disable-next-line house/no-raw-button -- two-line list row on an alignment grid: block content the shared Button does not model
    <button
      aria-current={current ? "true" : undefined}
      className={styles["row"]}
      data-current={current ? "" : undefined}
      type="button"
      onClick={(event) => jumpToGroup(group.id, event)}
    >
      <span aria-hidden="true" className={styles["ordinal"]}>
        {ordinal}
      </span>
      <span className={styles["name"]}>{name}</span>
      <span className={styles["meta"]}>
        {attributed ? (
          <span className={styles["facts"]}>
            <span>{categoryLabel}</span>
            <span>{chunkCounts}</span>
          </span>
        ) : null}
        {showsLines ? (
          <span className={styles["lines"]}>
            <LocSign sign={LocSigns.ADD} count={added} />{" "}
            <LocSign sign={LocSigns.DEL} count={deleted} />
            {attributed ? <> {t("brief.group.coreSuffix")}</> : null}
          </span>
        ) : null}
      </span>
      {hasConversation ? (
        <span className={styles["marker"]}>
          <ScreenReaderOnly>
            {t("brief.toc.srHasConversation")}
          </ScreenReaderOnly>
        </span>
      ) : null}
    </button>
  );
}
