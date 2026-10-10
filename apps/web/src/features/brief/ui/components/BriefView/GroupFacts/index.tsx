import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";

import type { ChangeGroupCategory } from "types";
import { resolveGroupName } from "../../../../model/utils/resolveGroupName";
import {
  isAttributedGroupView,
  type GroupView,
} from "../../../../model/utils/viewModel";
import { CategoryFacts } from "./CategoryFacts";
import type { GroupFactsSurface } from "./types";
import { splitInlineCode } from "./utils";
import styles from "./GroupFacts.module.scss";

export interface GroupFactsProps {
  group: GroupView;
  surface: GroupFactsSurface;
  /** The reader's dominant category, resolved by the surface's facade. */
  dominant?: ChangeGroupCategory | undefined;
  isReclassified?: boolean;
  headingId?: string | undefined;
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** The surface's own parts under the chips. */
  children?: ReactNode;
}

/** One group's title, summary, reading-order why and category chips. */
export function GroupFacts({
  group,
  surface,
  dominant,
  isReclassified = false,
  headingId,
  headingRef,
  children,
}: GroupFactsProps) {
  const { t } = useTranslation();
  const attributed = isAttributedGroupView(group);
  const summary = attributed
    ? group.group.summary
    : t("brief.unattributed.remainderSummary");
  const segments = splitInlineCode(summary);
  const name = resolveGroupName(t, group);
  const attributedGroup = attributed ? group : undefined;
  const showCategories =
    attributedGroup !== undefined && dominant !== undefined;

  return (
    <>
      <h2
        className={styles["title"]}
        data-variant={surface}
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
      >
        {name}
      </h2>
      <p className={styles["summary"]}>
        {segments.map((segment) =>
          segment.code ? (
            <code key={segment.offset}>{segment.text}</code>
          ) : (
            <span key={segment.offset}>{segment.text}</span>
          ),
        )}
      </p>
      {showCategories ? (
        <CategoryFacts
          dominant={dominant}
          group={attributedGroup}
          isReclassified={isReclassified}
        />
      ) : null}
      {children}
    </>
  );
}
