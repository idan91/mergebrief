import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";

import type { ChangeGroupCategory } from "types";
import { resolveGroupName } from "../../../../model/utils/resolve-group-name";
import {
  isAttributedGroupView,
  type GroupView,
} from "../../../../model/utils/view-model";
import { InlineCodeText } from "../InlineCodeText";
import { CategoryFacts } from "./CategoryFacts";
import type { GroupFactsSurface } from "./types";
import { resolveGroupSummary } from "./utils";
import styles from "./GroupFacts.module.scss";

export interface GroupFactsProps {
  group: GroupView;
  surface: GroupFactsSurface;
  /** The reader's dominant category, resolved by the surface's facade. */
  dominant?: ChangeGroupCategory | undefined;
  isReclassified?: boolean;
  headingId?: string | undefined;
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** Trailing the title on its line. */
  titleAside?: ReactNode;
  /** A meta line directly under the title. */
  titleMeta?: ReactNode;
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
  titleAside,
  titleMeta,
  children,
}: GroupFactsProps) {
  const { t } = useTranslation();
  const attributed = isAttributedGroupView(group);
  const summary = resolveGroupSummary(t, group);
  const name = resolveGroupName(t, group);
  const attributedGroup = attributed ? group : undefined;
  const showCategories =
    attributedGroup !== undefined && dominant !== undefined;

  const heading = (
    <h2
      className={styles["title"]}
      data-variant={surface}
      id={headingId}
      ref={headingRef}
      tabIndex={-1}
    >
      {name}
    </h2>
  );

  return (
    <>
      {titleAside === undefined ? (
        heading
      ) : (
        <div className={styles["titleLine"]}>
          {heading}
          {titleAside}
        </div>
      )}
      {titleMeta}
      <p className={styles["summary"]}>
        <InlineCodeText text={summary} />
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
