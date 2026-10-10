import { useTranslation } from "react-i18next";
import type { RefObject } from "react";

import { IconButton } from "@web/components/IconButton";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { GroupView } from "../../../../../model/utils/viewModel";
import { resolveGroupName } from "../../../../../model/utils/resolveGroupName";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { SIDEBAR_PANEL_ID } from "../consts";
import { resolveStepTarget } from "./utils";
import styles from "./NarrowBar.module.scss";

export interface NarrowBarProps {
  groups: GroupView[];
  activeGroupId: string | null;
  expanded: boolean;
  chevronRef: RefObject<HTMLButtonElement | null>;
  toggle: () => void;
  jumpToGroup: (groupId: string) => void;
  toggleShortcuts: () => void;
  scrollToTop: () => void;
}

/** The collapsed Sidebar below the tablet breakpoint: a bottom bar whose lines only show position. */
export function NarrowBar({
  groups,
  activeGroupId,
  expanded,
  chevronRef,
  toggle,
  jumpToGroup,
  toggleShortcuts,
  scrollToTop,
}: NarrowBarProps) {
  const { t } = useTranslation();
  const activeIndex = groups.findIndex((group) => group.id === activeGroupId);
  const activeGroup = groups[activeIndex];

  const step = (direction: 1 | -1) => {
    const target = resolveStepTarget(groups, activeGroupId, direction);
    if (target !== undefined) {
      jumpToGroup(target);
    }
  };

  return (
    <div className={styles["bar"]} data-testid="sidebar-bar">
      <IconButton
        callout="top"
        aria-controls={expanded ? SIDEBAR_PANEL_ID : undefined}
        aria-expanded={expanded}
        label={
          expanded ? t("brief.sidebar.collapse") : t("brief.sidebar.expand")
        }
        ref={chevronRef}
        size="md"
        onClick={toggle}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={expanded ? IconRotations.NONE : IconRotations.HALF}
          size={IconSizes.MD}
        />
      </IconButton>
      <IconButton
        callout="top"
        label={t("brief.toolbar.ariaLabelPreviousGroup")}
        size="md"
        onClick={() => step(-1)}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.QUARTER}
          size={IconSizes.MD}
        />
      </IconButton>
      <div className={styles["position"]}>
        <span aria-hidden="true" className={styles["lines"]}>
          {groups.map((group) => (
            <span
              className={styles["line"]}
              data-current={group.id === activeGroupId ? "" : undefined}
              key={group.id}
            />
          ))}
        </span>
        <span className={styles["name"]}>
          {activeGroup ? (
            <>
              <ScreenReaderOnly>
                {t("brief.toolbar.groupCount", {
                  current: activeIndex + 1,
                  total: groups.length,
                })}{" "}
              </ScreenReaderOnly>
              {resolveGroupName(t, activeGroup)}
            </>
          ) : null}
        </span>
      </div>
      <IconButton
        callout="top"
        label={t("brief.toolbar.ariaLabelNextGroup")}
        size="md"
        onClick={() => step(1)}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.THREE_QUARTERS}
          size={IconSizes.MD}
        />
      </IconButton>
      <IconButton
        callout="top"
        label={t("brief.sidebar.scrollToTop")}
        size="md"
        onClick={scrollToTop}
      >
        <Icon name={IconNames.ARROW_UP} size={IconSizes.MD} />
      </IconButton>
      <IconButton
        callout="top"
        className={styles["shortcutsTrigger"]}
        label={t("brief.screen.ariaLabelShortcuts")}
        size="md"
        onClick={toggleShortcuts}
      >
        ?
      </IconButton>
    </div>
  );
}
