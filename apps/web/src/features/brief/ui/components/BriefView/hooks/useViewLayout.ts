import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import { useViewportBoundary } from "@web/hooks/useViewportBoundary";
import type { ViewParam } from "../../../../model/comparison/compare-state";
import { useFocusPanel } from "../FocusPanel/useFocusPanel";
import { deriveVisibleRegions } from "../reading/regions";
import { ScrollHistories } from "../scroll-to-target/types";
import { useSidebarState } from "../Sidebar/useSidebarState";
import type { BriefViewStore } from "../store";
import type { UseViewLayoutInput, ViewLayout } from "../types";
import { resolveSidebarLayout } from "../utils";

export function useViewLayout({
  viewStore,
  readingPosition,
  session,
  scope,
  briefId,
}: UseViewLayoutInput): ViewLayout {
  const { focusMode } = session;

  const regions = deriveVisibleRegions({ scope, focus: focusMode });
  const band = useViewportBoundary();
  const focusPanel = useFocusPanel({
    position: readingPosition,
    focusMode,
    band,
  });
  const sidebar = useSidebarState(band, regions.sidebar, briefId);
  const sidebarLayout = resolveSidebarLayout(band, sidebar.expanded);
  useSidebarFocusReturn(regions.sidebar);

  const inChangesScope = scope === "changes";
  const focusPanelShown = focusMode && !inChangesScope;
  const panes = useScopePanes(viewStore, scope);

  // A gesture from Changes scope leaves it with a history step and scrolls
  // to target once the story pane renders.
  const queueJumpFromChanges = (groupId: string, heading: boolean) => {
    if (heading) {
      session.jumpToGroupHeading(groupId, ScrollHistories.PUSH);
      return;
    }
    session.jumpToGroup(groupId, ScrollHistories.PUSH);
  };

  return {
    regions,
    band,
    focusPanel,
    focusPanelShown,
    sidebar,
    sidebarLayout,
    inChangesScope,
    changesPaneMounted: panes.changesPaneMounted,
    storyPaneMounted: panes.storyPaneMounted,
    queueJumpFromChanges,
  };
}

function useSidebarFocusReturn(sidebarShown: boolean): void {
  const sidebarWasVisible = useRef(sidebarShown);
  useEffect(() => {
    const hidden = sidebarWasVisible.current && !sidebarShown;
    sidebarWasVisible.current = sidebarShown;
    const focusStranded = hidden && document.activeElement === document.body;
    if (!focusStranded) {
      return;
    }

    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [sidebarShown]);
}

/**
 * A pane stays mounted, hidden, once its scope has shown for this Brief, so
 * a flip back pays no remount.
 */
function useScopePanes(viewStore: BriefViewStore, scope: ViewParam) {
  const { markScopeShown } = viewStore.getState().actions;
  useEffect(() => {
    markScopeShown(scope);
  }, [markScopeShown, scope]);

  const inChangesScope = scope === "changes";
  const changesPaneMounted = useStore(viewStore, (state) => {
    const mounted = inChangesScope || state.shownScopes.has("changes");
    return mounted;
  });
  const storyPaneMounted = useStore(viewStore, (state) => {
    const mounted = !inChangesScope || state.shownScopes.has("full");
    return mounted;
  });

  return { changesPaneMounted, storyPaneMounted };
}
