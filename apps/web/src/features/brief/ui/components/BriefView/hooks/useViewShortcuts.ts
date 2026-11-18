import { useStore } from "zustand";

import { getComposerHost } from "@web/features/review/session";
import { ViewportBands } from "@web/hooks/useViewportBoundary";
import { useKeyboardShortcuts } from "../../../hooks/useKeyboardShortcuts";
import type { UseViewShortcutsInput } from "../types";

export function useViewShortcuts(input: UseViewShortcutsInput): void {
  const { t, session, readingPosition, layout, flow, lineSelection } = input;
  const { regions, focusPanel, focusPanelShown, sidebar } = layout;
  const flowActions = flow.flowStore.getState().actions;

  const composerOpen = useStore(
    flow.flowStore,
    (state) => getComposerHost(state.composer) !== undefined,
  );
  const sheetOpen =
    layout.band === ViewportBands.NARROW && regions.sidebar && sidebar.expanded;
  const clearLineSelectionFromShortcut = () => {
    flowActions.clearLineSelection();
    flowActions.announceQuietly(t("review.announce.lineSelectionCleared"));
  };
  const shortcutsDisabled =
    flow.submitOpen ||
    input.markReady.gateOpen ||
    session.shortcutsOpen ||
    input.riskModalOpen ||
    composerOpen ||
    input.pendingShown;
  const conversationJumpShown =
    input.props.conversation !== undefined && regions.conversation;

  useKeyboardShortcuts({
    chunkIds: session.chunkIds,
    groupBoundaries: session.groupBoundaries,
    getActiveChunkId: () => readingPosition.getState().activeChunkId,
    disabled: shortcutsDisabled,
    sheetOpen,
    focusModeActive: session.focusMode,
    jumpToChunk: session.jumpToChunkFromShortcut,
    toggleFocusMode: session.toggleFocusMode,
    toggleHelp: session.toggleShortcuts,
    markViewed: input.markViewedFromShortcut,
    markViewedAvailable: input.scope === "full",
    lineSelected: lineSelection !== null,
    clearLineSelection: clearLineSelectionFromShortcut,
    reanchorArmed: input.reanchorArmed,
    cancelReanchor: flowActions.cancelReanchor,
    focusPanelOpen: focusPanelShown && focusPanel.open,
    toggleFocusPanel: focusPanelShown ? focusPanel.toggle : undefined,
    closeFocusPanel: focusPanel.close,
    jumpToConversation: conversationJumpShown
      ? input.conversationWiring.jumpToConversation
      : undefined,
    toggleSidebar: regions.sidebar ? sidebar.toggleInstantly : undefined,
    toggleDiffView: input.toggleDiffView,
  });
}
