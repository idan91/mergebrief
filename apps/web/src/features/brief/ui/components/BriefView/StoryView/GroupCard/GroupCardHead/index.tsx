import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { ChangeGroupCategory } from "types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { GroupView } from "../../../../../../model/utils/view-model";
import { GroupFacts } from "../../../GroupFacts";
import { GroupLineTotal } from "../../../GroupFacts/GroupLineTotal";
import { GroupFactsSurfaces } from "../../../GroupFacts/types";
import { hasLineTotal } from "../../../GroupFacts/utils";
import styles from "./GroupCardHead.module.scss";

export interface GroupCardHeadProps {
  group: GroupView;
  /** How many groups the story holds. */
  total: number;
  headingId: string;
  /** The changed-since marker, when a checkpoint exists. */
  sinceMarker?: ReactNode;
  dominant?: ChangeGroupCategory | undefined;
  isReclassified?: boolean;
  /** The card's own parts under the chips. */
  children?: ReactNode;
}

/** The card's title with its place in the story, the line total under it, then the group's facts. */
export function GroupCardHead({
  group,
  total,
  headingId,
  sinceMarker,
  dominant,
  isReclassified = false,
  children,
}: GroupCardHeadProps) {
  const { t } = useTranslation();
  const ordinal = { index: group.index + 1, total };
  const showsMeta = hasLineTotal(group) || sinceMarker !== undefined;
  const position = (
    <span className={styles["position"]}>
      <span aria-hidden="true">{t("brief.group.position", ordinal)}</span>
      <ScreenReaderOnly>{t("brief.group.groupOf", ordinal)}</ScreenReaderOnly>
    </span>
  );
  const meta = showsMeta ? (
    <div className={styles["meta"]}>
      <GroupLineTotal className={styles["lines"]} group={group} />
      {sinceMarker}
    </div>
  ) : undefined;

  return (
    <GroupFacts
      dominant={dominant}
      group={group}
      headingId={headingId}
      isReclassified={isReclassified}
      surface={GroupFactsSurfaces.CARD}
      titleAside={position}
      titleMeta={meta}
    >
      {children}
    </GroupFacts>
  );
}
