import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import type { ValueOf } from "types";

import { Tabs } from "@web/components/Tabs/Tabs";
import { useBodyScrollLock } from "@web/hooks/useBodyScrollLock";
import { useFocusTrap } from "@web/hooks/useFocusTrap";
import type { GroupView } from "../../../../utils/viewModel";
import { SIDEBAR_PANEL_ID } from "../consts";
import { ThisPr } from "../Tabs/ThisPr/ThisPr";
import { SidebarTabs, type JumpFromSidebar, type SidebarTab } from "../types";
import { isSidebarTab } from "../utils";
import styles from "./Sheet.module.scss";

export const SheetHeights = {
  HALF: "half",
  FULL: "full",
} as const;

export type SheetHeight = ValueOf<typeof SheetHeights>;

export interface SheetProps {
  groups: GroupView[];
  activeGroupId: string | null;
  conversationGroupIds?: ReadonlySet<string> | undefined;
  tab: SidebarTab;
  selectTab: (tab: SidebarTab) => void;
  jumpToGroup: JumpFromSidebar;
  close: () => void;
}

/**
 * The expanded Sidebar below the tablet breakpoint: a modal sheet rising
 * from the bar, opening at half height with a handle to the full height.
 * Mounted = open; the caller owns the open state and Escape.
 */
export function Sheet({
  groups,
  activeGroupId,
  conversationGroupIds,
  tab,
  selectTab,
  jumpToGroup,
  close,
}: SheetProps) {
  const { t } = useTranslation();
  const [height, setHeight] = useState<SheetHeight>(SheetHeights.HALF);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onTrapKeyDown = useFocusTrap(dialogRef);
  useBodyScrollLock(true);

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
    // Focus lands once, on open; a later tab change moves it through the tabs row.
  }, []);

  const handleSelectTab = (value: string) => {
    if (isSidebarTab(value)) selectTab(value);
  };

  const full = height === SheetHeights.FULL;
  const toggleHeight = () =>
    setHeight(full ? SheetHeights.HALF : SheetHeights.FULL);

  return (
    <>
      {/* oxlint-disable-next-line house/no-raw-button -- full-viewport scrim: a tap target with no chrome */}
      <button
        aria-label={t("brief.sidebar.collapse")}
        className={styles["scrim"]}
        type="button"
        onClick={close}
      />
      {/* The keydown is the dialog's Tab trap, not an interaction of its own. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        aria-label={t("brief.sidebar.ariaLabel")}
        aria-modal="true"
        className={styles["sheet"]}
        data-height={height}
        data-testid="sidebar-sheet"
        id={SIDEBAR_PANEL_ID}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={onTrapKeyDown}
      >
        {/* oxlint-disable-next-line house/no-raw-button -- the sheet's grab handle: a pill, not a labelled control */}
        <button
          aria-expanded={full}
          aria-label={
            full
              ? t("brief.sidebar.sheet.shrinkToHalf")
              : t("brief.sidebar.sheet.expandToFull")
          }
          className={styles["handle"]}
          type="button"
          onClick={toggleHeight}
        />
        <Tabs value={tab} onValueChange={handleSelectTab}>
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
              jumpToGroup={jumpToGroup}
            />
          </Tabs.Panel>
        </Tabs>
      </div>
    </>
  );
}
