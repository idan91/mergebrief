import { useTranslation } from "react-i18next";

import { BottomSheet } from "@web/components/BottomSheet";
import { Tabs } from "@web/components/Tabs";
import type { RevisionTimelinePlan } from "../../../../../model/types";
import type { GroupView } from "../../../../../model/utils/view-model";
import { SIDEBAR_PANEL_ID } from "../consts";
import { Revisions } from "../Tabs/Revisions";
import { ThisPr } from "../Tabs/ThisPr";
import {
  SidebarTabs,
  type JumpChunkFromSidebar,
  type JumpFromSidebar,
  type SidebarTab,
} from "../types";
import { isSidebarTab } from "../utils";

export interface SheetProps {
  groups: GroupView[];
  activeGroupId: string | null;
  groupThreadCounts?: ReadonlyMap<string, number> | undefined;
  tab: SidebarTab;
  selectTab: (tab: SidebarTab) => void;
  jumpToGroup: JumpFromSidebar;
  /** Lists each group's chunks under it; absent keeps the groups alone. */
  jumpToChunk?: JumpChunkFromSidebar | undefined;
  revisions?: RevisionTimelinePlan | undefined;
  /** Runs after a revision row activates; the caller closes the sheet. */
  afterRevision: () => void;
  close: () => void;
}

/** The expanded Sidebar below the tablet breakpoint: This PR with its chunks, and the revisions. */
export function Sheet({
  groups,
  activeGroupId,
  groupThreadCounts,
  tab,
  selectTab,
  jumpToGroup,
  jumpToChunk,
  revisions,
  afterRevision,
  close,
}: SheetProps) {
  const { t } = useTranslation();
  const thisPrSelected = tab === SidebarTabs.THIS_PR;

  const handleSelectTab = (value: string) => {
    if (isSidebarTab(value)) {
      selectTab(value);
    }
  };

  return (
    <BottomSheet
      close={close}
      closeLabel={t("brief.sidebar.collapse")}
      id={SIDEBAR_PANEL_ID}
      initialFocusSelector='[role="tab"][aria-selected="true"]'
      label={t("brief.sidebar.ariaLabel")}
      testId="sidebar-sheet"
    >
      <Tabs value={tab} onValueChange={handleSelectTab}>
        <Tabs.List label={t("brief.sidebar.tabs.ariaLabel")}>
          <Tabs.Tab value={SidebarTabs.THIS_PR}>
            {t("brief.sidebar.tabs.thisPr")}
          </Tabs.Tab>
          {revisions === undefined ? null : (
            <Tabs.Tab value={SidebarTabs.REVISIONS}>
              {t("brief.sidebar.tabs.revisions")}
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value={SidebarTabs.THIS_PR}>
          <ThisPr
            activeGroupId={activeGroupId}
            groupThreadCounts={groupThreadCounts}
            groups={groups}
            jumpToChunk={jumpToChunk}
            jumpToGroup={jumpToGroup}
            selected={thisPrSelected}
          />
        </Tabs.Panel>
        {revisions === undefined ? null : (
          <Tabs.Panel value={SidebarTabs.REVISIONS}>
            <Revisions afterActivate={afterRevision} plan={revisions} />
          </Tabs.Panel>
        )}
      </Tabs>
    </BottomSheet>
  );
}
