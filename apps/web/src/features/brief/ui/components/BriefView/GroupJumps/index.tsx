import { useTranslation } from "react-i18next";

import { IconButton, IconButtonVariants } from "@web/components/IconButton";
import styles from "./GroupJumps.module.scss";
import { listGroupJumps } from "./utils";

export interface GroupJumpsProps {
  groupIds: readonly string[];
  jumpToGroup: (groupId: string) => void;
  /** Change-group titles by id, for the buttons' names. An unknown id keeps the plain label. */
  groupTitles: Readonly<Record<string, string>>;
}

/**
 * The jumps from a row of an AI-read bar to the change-groups it names. An id
 * shows only where a row names several groups, the one place it tells two
 * buttons apart.
 */
export function GroupJumps({
  groupIds,
  jumpToGroup,
  groupTitles,
}: GroupJumpsProps) {
  const { t } = useTranslation();

  if (groupIds.length === 0) {
    return null;
  }

  const showsIds = groupIds.length > 1;
  const jumps = listGroupJumps(t, groupIds, groupTitles);
  return (
    <span className={styles["set"]}>
      {jumps.map(({ groupId, label }) => (
        <IconButton
          autoWidth={showsIds}
          callout="left"
          className={styles["jump"]}
          key={groupId}
          label={label}
          variant={IconButtonVariants.OUTLINE}
          onClick={() => jumpToGroup(groupId)}
        >
          ↳{showsIds ? <span className={styles["id"]}>{groupId}</span> : null}
        </IconButton>
      ))}
    </span>
  );
}
