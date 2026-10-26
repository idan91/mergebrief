import { useTranslation } from "react-i18next";
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";

import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { IconButton } from "@web/components/IconButton";
import { Tabs } from "@web/components/Tabs";
import {
  ViewportBands,
  type ViewportBand,
} from "@web/hooks/useViewportBoundary";
import type { RevisionTimelinePlan } from "../../../../model/types";
import type { GroupView } from "../../../../model/utils/view-model";
import { useReadingPosition } from "../reading/reading-position";
import { SIDEBAR_PANEL_ID } from "./consts";
import { GroupLines } from "./GroupLines";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { NarrowBar } from "./NarrowBar";
import { Sheet } from "./Sheet";
import { Revisions } from "./Tabs/Revisions";
import { ThisPr } from "./Tabs/ThisPr";
import { SidebarTabs, type JumpFromSidebar } from "./types";
import type { SidebarState } from "./useSidebarState";
import { isSidebarTab, resolveShownTab } from "./utils";
import styles from "./Sidebar.module.scss";

/** The control names and shows the view a click switches to. */
const DIFF_VIEW_SWITCH_LABELS = {
  [DiffViews.SPLIT]: "brief.sidebar.diffViewToSplit",
  [DiffViews.UNIFIED]: "brief.sidebar.diffViewToUnified",
} as const;

export interface SidebarProps {
  groups: GroupView[];
  jumpToGroup: (groupId: string) => void;
  /** The keyboard scroll to target: scrolls to and focuses the group heading. */
  jumpToGroupHeading: (groupId: string) => void;
  scrollToTop: () => void;
  conversationGroupIds?: ReadonlySet<string> | undefined;
  state: SidebarState;
  band: ViewportBand;
  /** A revision load is pending: the aside goes inert with the content. */
  pending: boolean;
  toggleShortcuts: () => void;
  /** Rows unified or paired per hunk; the foot control toggles it. */
  diffView: DiffView;
  /** Absent where rows cannot split; the control stays out of the foot. */
  toggleDiffView?: (() => void) | undefined;
  /** The PR's revisions and the route's way to one; absent hides the tab. */
  revisions?: RevisionTimelinePlan | undefined;
}

/**
 * The Brief page's Sidebar: on desktop a right-edge column holding the group
 * lines, the expand control and the page's small utilities, plus the tabs
 * while expanded; below the tablet breakpoint a bottom bar and a sheet.
 * Rendered after `<main>` so the content comes first in the tab order.
 */
export function Sidebar({
  groups,
  jumpToGroup,
  jumpToGroupHeading,
  scrollToTop,
  conversationGroupIds,
  state,
  band,
  pending,
  toggleShortcuts,
  diffView,
  toggleDiffView,
  revisions,
}: SidebarProps) {
  const { t } = useTranslation();
  const otherDiffView =
    diffView === DiffViews.SPLIT ? DiffViews.UNIFIED : DiffViews.SPLIT;
  const activeGroupId = useReadingPosition(
    (position) => position.activeGroupId,
  );
  const chevronRef = useRef<HTMLButtonElement | null>(null);
  const currentRevisionRef = useRef<HTMLButtonElement | null>(null);
  const { expanded } = state;
  const narrow = band === ViewportBands.NARROW;
  const wasExpanded = useRef(expanded);
  const holdsFocus = useRef(false);

  // A collapse the Sidebar did not start (S) unmounts the focused control;
  // focus comes back to the chevron rather than dropping to the body. Only
  // when the aside held focus: a body-focused S must not summon the callout.
  useEffect(() => {
    const collapsed = wasExpanded.current && !expanded;
    wasExpanded.current = expanded;
    if (!collapsed || !holdsFocus.current) {
      return;
    }

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
    if (isSidebarTab(value)) {
      state.selectTab(value);
    }
  };

  const jumpFromSidebar: JumpFromSidebar = (groupId, event) => {
    if (narrow) {
      state.collapse();
    }
    if (event.detail !== 0) {
      jumpToGroup(groupId);
      if (narrow) {
        chevronRef.current?.focus();
      }
      return;
    }
    jumpToGroupHeading(groupId);
  };

  const collapseToChevron = () => {
    state.collapse();
    chevronRef.current?.focus();
  };

  // Same scroll to target as a group jump on the narrow band: the sheet
  // closes and focus returns to the bar. The column stays as it is.
  const afterRevision = () => {
    if (narrow) {
      collapseToChevron();
    }
  };
  const shownTab = resolveShownTab(state.tab, revisions !== undefined);
  const { requestRevisionRefocus, takeRevisionRefocus } = state;
  const revisionPlan =
    revisions === undefined
      ? undefined
      : {
          view: revisions.view,
          selectRevision: (key: string) => {
            requestRevisionRefocus();
            revisions.selectRevision(key);
          },
        };

  // A pick remounts this aside with the next brief, and the aside is inert
  // while it loads, so the picked control is gone either way. Once the aside
  // is live again, focus goes back where the reviewer was: the new current
  // row in the column, the chevron on the narrow band.
  useEffect(() => {
    if (pending || !takeRevisionRefocus()) {
      return;
    }
    const target = narrow ? chevronRef.current : currentRevisionRef.current;
    target?.focus();
  }, [pending, narrow, takeRevisionRefocus]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !expanded) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    collapseToChevron();
  };

  const chevronLabel = expanded
    ? t("brief.sidebar.collapse")
    : t("brief.sidebar.expand");

  if (narrow) {
    return (
      // The keydown is the sheet's Escape, not an interaction of its own.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <aside
        aria-label={t("brief.sidebar.ariaLabel")}
        className={styles["sidebar"]}
        data-state={expanded ? "expanded" : "collapsed"}
        data-testid="sidebar"
        data-variant="narrow"
        inert={pending || undefined}
        onBlur={trackFocus.onBlur}
        onFocus={trackFocus.onFocus}
        onKeyDown={handleKeyDown}
      >
        {expanded ? (
          <Sheet
            activeGroupId={activeGroupId}
            close={collapseToChevron}
            conversationGroupIds={conversationGroupIds}
            groups={groups}
            jumpToGroup={jumpFromSidebar}
            afterRevision={afterRevision}
            revisions={revisionPlan}
            selectTab={state.selectTab}
            tab={shownTab}
          />
        ) : null}
        <NarrowBar
          activeGroupId={activeGroupId}
          chevronRef={chevronRef}
          expanded={expanded}
          groups={groups}
          jumpToGroup={jumpToGroup}
          scrollToTop={scrollToTop}
          toggle={state.toggle}
          toggleShortcuts={toggleShortcuts}
        />
      </aside>
    );
  }

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
      data-variant="desktop"
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
          label={chevronLabel}
          ref={chevronRef}
          size="md"
          onClick={state.toggle}
        >
          <Icon
            name={IconNames.CARET_DOWN}
            rotation={
              expanded ? IconRotations.THREE_QUARTERS : IconRotations.QUARTER
            }
            size={IconSizes.MD}
          />
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
            onClick={scrollToTop}
          >
            <Icon name={IconNames.ARROW_UP} size={IconSizes.MD} />
          </IconButton>
          {toggleDiffView === undefined ? null : (
            <IconButton
              callout="left"
              data-target={otherDiffView}
              data-testid="sidebar-diff-view"
              label={t(DIFF_VIEW_SWITCH_LABELS[otherDiffView])}
              size="md"
              onClick={toggleDiffView}
            >
              <Icon
                name={IconNames.COLUMNS}
                rotation={
                  otherDiffView === "unified"
                    ? IconRotations.QUARTER
                    : IconRotations.NONE
                }
                size={IconSizes.MD}
              />
            </IconButton>
          )}
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
          <Tabs value={shownTab} onValueChange={selectTab}>
            <Tabs.List label={t("brief.sidebar.tabs.ariaLabel")}>
              <Tabs.Tab value={SidebarTabs.THIS_PR}>
                {t("brief.sidebar.tabs.thisPr")}
              </Tabs.Tab>
              {revisionPlan === undefined ? null : (
                <Tabs.Tab value={SidebarTabs.REVISIONS}>
                  {t("brief.sidebar.tabs.revisions")}
                </Tabs.Tab>
              )}
            </Tabs.List>
            <Tabs.Panel value={SidebarTabs.THIS_PR}>
              <ThisPr
                activeGroupId={activeGroupId}
                conversationGroupIds={conversationGroupIds}
                groups={groups}
                jumpToGroup={jumpFromSidebar}
              />
            </Tabs.Panel>
            {revisionPlan === undefined ? null : (
              <Tabs.Panel value={SidebarTabs.REVISIONS}>
                <Revisions
                  afterActivate={afterRevision}
                  currentRowRef={currentRevisionRef}
                  plan={revisionPlan}
                />
              </Tabs.Panel>
            )}
          </Tabs>
        ) : null}
      </div>
    </aside>
  );
}
