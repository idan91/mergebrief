import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign";
import { resolveGroupName } from "../../../../utils/resolveGroupName";
import {
  isAttributedGroupView,
  type GroupView,
} from "../../../../utils/viewModel";
import { splitInlineCode } from "../utils";
import { CategoryFacts } from "./CategoryFacts";
import styles from "./GroupFacts.module.scss";

export interface GroupFactsProps {
  group: GroupView;
  flagCount: number;
  /** Takes focus when the reader opens the panel by pointer. */
  headingRef: Ref<HTMLHeadingElement>;
}

export function GroupFacts({ group, flagCount, headingRef }: GroupFactsProps) {
  const { t } = useTranslation();
  const attributed = isAttributedGroupView(group);
  const summary = attributed
    ? group.group.summary
    : t("brief.unattributed.remainderSummary");
  const segments = splitInlineCode(summary);
  const name = resolveGroupName(t, group);

  return (
    <>
      <h2 className={styles["title"]} ref={headingRef} tabIndex={-1}>
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
      {attributed ? <CategoryFacts group={group} /> : null}
      <div className={styles["stats"]}>
        <span>
          <LocSign sign={LocSigns.ADD} count={group.added} /> /{" "}
          <LocSign sign={LocSigns.DEL} count={group.deleted} />
        </span>
        {attributed ? (
          <span>{t("brief.focusPanel.flags", { count: flagCount })}</span>
        ) : null}
      </div>
    </>
  );
}
