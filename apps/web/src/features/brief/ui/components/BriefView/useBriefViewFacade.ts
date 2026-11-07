import { useTranslation } from "react-i18next";
import { useState } from "react";

import { useAddressSync } from "./address/useAddressSync";
import { useComparison } from "./comparison/useComparison";
import { useConversation } from "./conversation/useConversation";
import { useDiffViewPreference } from "./diff-view/useDiffViewPreference";
import { usePhoneChrome } from "./hooks/usePhoneChrome";
import { useReviewCommands } from "./hooks/useReviewCommands";
import { useReviewFlowState } from "./hooks/useReviewFlowState";
import { useRiskAttrCycle } from "./hooks/useRiskAttrCycle";
import { useViewLayout } from "./hooks/useViewLayout";
import { useViewShortcuts } from "./hooks/useViewShortcuts";
import { useReading } from "./reading/useReading";
import { useStoryCardTrack } from "./reading/useStoryCardTrack";
import type { ChunkFooterWiring } from "./StoryView/ChunkFooter";
import type { BriefViewProps } from "./types";
import { buildAnnouncedRevisionNav, resolveDiffViewToggle } from "./utils";

// Call order is effect order: each hook's effects run after the ones above
// it, so a move here is a behaviour change.
export function useBriefViewFacade(props: BriefViewProps) {
  const { t } = useTranslation();
  const [largeTitle, attachLargeTitle] = useState<HTMLDivElement | null>(null);
  const ownDraftActive = props.review?.ownDraft !== undefined;
  const staleHead = props.review?.staleHead === true;
  const phoneChrome = usePhoneChrome(props.reading.briefId);

  const comparison = useComparison(props);
  const scope = comparison.overlay.compareState.view;
  const { viewStore, ...readingState } = useReading({
    props,
    overlay: comparison.overlay,
    ownDraftActive,
  });
  const { session, readingPosition } = readingState;
  const layout = useViewLayout({
    viewStore,
    readingPosition,
    session,
    scope,
    briefId: props.reading.briefId,
  });
  const { inChangesScope } = layout;
  const riskAttrCycle = useRiskAttrCycle(viewStore, layout.regions.toolbar);
  const { lineSelection, reanchorArmed, riskModalOpen, ...flow } =
    useReviewFlowState({ t, props, viewStore, session, inChangesScope });
  const { conversationPlan, conversationWiring } = useConversation({
    conversation: props.conversation,
    model: props.reading.model,
    session,
  });
  const address = useAddressSync({
    t,
    props,
    readingState,
    scope,
    flow,
    lineSelection,
    conversationWiring,
  });
  const { markViewedFromShortcut, ...reviewCommands } = useReviewCommands({
    t,
    props,
    ownDraftActive,
    staleHead,
    viewStore,
    session,
    flow,
    riskModalOpen,
    conversationWiring,
    phoneControlsRef: phoneChrome.controlsRef,
  });
  const cardTrack = useStoryCardTrack();
  const diffPreference = useDiffViewPreference({
    search: props.address.searchParams.diff,
    clearDiffParam: props.address.clearDiffParam,
  });
  const diffView = diffPreference.view;
  const toggleDiffView = resolveDiffViewToggle({
    t,
    view: diffView,
    setView: diffPreference.setView,
    announce: flow.announce,
    inChangesScope,
  });
  useViewShortcuts({
    t,
    props,
    pendingShown: comparison.pendingShown,
    scope,
    readingPosition,
    session,
    layout,
    flow,
    lineSelection,
    reanchorArmed,
    riskModalOpen,
    markReady: reviewCommands.markReady,
    markViewedFromShortcut,
    conversationWiring,
    toggleDiffView,
  });
  const revisionNav = buildAnnouncedRevisionNav({
    t,
    revisionNav: readingState.revisionNav,
    announceQuietly: flow.flowStore.getState().actions.announceQuietly,
  });
  const chunkFooter: ChunkFooterWiring = {
    jumpToChunk: session.jumpToChunkFromShortcut,
    toggleViewed: markViewedFromShortcut,
  };

  return {
    t,
    ownDraftActive,
    staleHead,
    chunkFooter,
    phoneChrome,
    conversationPlan,
    conversationWiring,
    ...comparison,
    ...readingState,
    revisionNav,
    ...layout,
    ...flow,
    ...address,
    ...reviewCommands,
    cardTrack,
    diffView,
    toggleDiffView,
    largeTitle,
    attachLargeTitle,
    riskAttrCycle,
  };
}
