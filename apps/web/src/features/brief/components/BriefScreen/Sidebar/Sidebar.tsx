import { useTranslation } from "react-i18next";
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";

import { IconButton } from "@web/components/IconButton/IconButton";
import { Tabs } from "@web/components/Tabs/Tabs";
import { prefersReducedMotion } from "@web/utils/motion";
import type { GroupView } from "../../../utils/viewModel";
import { useReadingPosition } from "../readingPosition";
import { SIDEBAR_PANEL_ID } from "./consts";
import { GroupLines } from "./GroupLines/GroupLines";
import ArrowUpIcon from "./icons/arrow-up.svg?react";
import ChevronLeftIcon from "./icons/chevron-left.svg?react";
import { ThisPr } from "./Tabs/ThisPr/ThisPr";
import { SidebarTabs, type JumpFromSidebar } from "./types";
import type { SidebarState } from "./useSidebarState";
import { isSidebarTab } from "./utils";
import styles from "./Sidebar.module.scss";

function scrollWindowToTop(): void {
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

export interface SidebarProps {
  groups: GroupView[];
  jumpToGroup: (groupId: string) => void;
  /** The keyboard landing: scrolls to and focuses the group heading. */
  jumpToGroupHeading: (groupId: string) => void;
  conversationGroupIds?: ReadonlySet<string> | undefined;
  state: SidebarState;
  /** A revision load is pending: the aside goes inert with the content. */
  pending: boolean;
  toggleShortcuts: () => void;
}

/**
 * The Brief page's right-edge column: the group lines, the expand control and
 * the page's small utilities, plus the tabs while expanded. Rendered after
 * `<main>` so the content comes first in the tab order.
 */
export function Sidebar({
  groups,
  jumpToGroup,
  jumpToGroupHeading,
  conversationGroupIds,
  state,
  pending,
  toggleShortcuts,
}: SidebarProps) {
  const { t } = useTranslation();
  const activeGroupId = useReadingPosition(
    (position) => position.activeGroupId,
  );
  const chevronRef = useRef<HTMLButtonElement | null>(null);
  const { expanded } = state;
  const wasExpanded = useRef(expanded);
  const holdsFocus = useRef(false);

  // A collapse the Sidebar did not start (S) unmounts the focused control;
  // focus comes back to the chevron rather than dropping to the body. Only
  // when the aside held focus: a body-focused S must not summon the callout.
  useEffect(() => {
    const collapsed = wasExpanded.current && !expanded;
    wasExpanded.current = expanded;
    if (!collapsed || !holdsFocus.current) return;

    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      chevronRef.current?.focus();
    }
  }, [expanded]);

  const trackFocus = {
    onFocus: () => {
      holdsFocus.current = true;
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        holdsFocus.current = false;
      }
    },
  };

  // A pointer click keeps focus put; keyboard and AT activation land on the heading.
  const selectTab = (value: string) => {
    if (isSidebarTab(value)) state.selectTab(value);
  };

  const jumpFromSidebar: JumpFromSidebar = (groupId, event) => {
    if (event.detail !== 0) {
      jumpToGroup(groupId);
      return;
    }
    jumpToGroupHeading(groupId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !expanded) return;

    event.preventDefault();
    event.stopPropagation();
    state.collapse();
    chevronRef.current?.focus();
  };

  const chevronLabel = expanded
    ? t("brief.sidebar.collapse")
    : t("brief.sidebar.expand");

  return (
    // The keydown is the disclosure's Escape, not an interaction of its own:
    // the aside only collapses and re-homes focus among its own controls.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <aside
      aria-label={t("brief.sidebar.ariaLabel")}
      className={styles["sidebar"]}
      data-motion={state.motionReady ? "on" : undefined}
      data-state={expanded ? "expanded" : "collapsed"}
      data-testid="sidebar"
      inert={pending || undefined}
      onBlur={trackFocus.onBlur}
      onFocus={trackFocus.onFocus}
      onKeyDown={handleKeyDown}
    >
      <div className={styles["column"]}>
        <IconButton
          aria-controls={SIDEBAR_PANEL_ID}
          aria-expanded={expanded}
          callout="left"
          className={styles["chevron"]}
          label={chevronLabel}
          ref={chevronRef}
          size="md"
          onClick={state.toggle}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </IconButton>
        <GroupLines
          activeGroupId={activeGroupId}
          conversationGroupIds={conversationGroupIds}
          groups={groups}
          jumpToGroup={jumpFromSidebar}
        />
        <div className={styles["foot"]}>
          <IconButton
            callout="left"
            label={t("brief.sidebar.scrollToTop")}
            size="md"
            onClick={scrollWindowToTop}
          >
            <ArrowUpIcon aria-hidden="true" />
          </IconButton>
          <IconButton
            callout="left"
            className={styles["shortcutsTrigger"]}
            label={t("brief.screen.ariaLabelShortcuts")}
            size="md"
            onClick={toggleShortcuts}
          >
            ?
          </IconButton>
        </div>
      </div>
      <div className={styles["panel"]} hidden={!expanded} id={SIDEBAR_PANEL_ID}>
        {expanded ? (
          <Tabs value={state.tab} onValueChange={selectTab}>
            <Tabs.List label={t("brief.sidebar.tabs.ariaLabel")}>
              <Tabs.Tab value={SidebarTabs.THIS_PR}>
                {t("brief.sidebar.tabs.thisPr")}
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value={SidebarTabs.THIS_PR}>
              <ThisPr
                activeGroupId={activeGroupId}
                conversationGroupIds={conversationGroupIds}
                groups={groups}
                jumpToGroup={jumpFromSidebar}
              />
            </Tabs.Panel>
          </Tabs>
        ) : null}
      </div>
    </aside>
  );
}
