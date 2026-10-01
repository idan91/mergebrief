import { memo, useMemo } from "react";

import { TokenPlanProvider } from "@web/hooks/useTokenPlan";
import { ExpansionSourceProvider } from "../../hooks/useExpansionSource";
import { FileRowsProvider } from "../../hooks/useFileRows";
import { ConversationSection } from "@web/features/conversation";
import { SubmitModal } from "@web/features/review";
import { ReviewFlowProvider } from "@web/features/review/session";
// Through the pulls COMPONENT entry, not the feature index: the index also
// exports the PrBrief tree, which renders BriefView, so importing it here
// would close a brief -> pulls -> brief module cycle.
import { MarkReadyModal } from "@web/features/pulls/components";
import { ChunkWindowProvider } from "./chunkWindows";
import { ChangesOnlyView } from "./ChangesOnlyView";
import { ConcernStrip } from "./ConcernStrip";
import { FocusIndicator } from "./FocusIndicator";
import { FocusPanel } from "./FocusPanel";
import { FocusShortcuts } from "./FocusShortcuts";
import { LineLinkNotice } from "./LineLinkNotice";
import { IntentBar } from "./IntentBar";
import { CarryOver } from "./CarryOver";
import { Header } from "./Header";
import { ReadingToolbar } from "./ReadingToolbar";
import { ReanchorBanner } from "./ReanchorBanner";
import { RiskFlagModals } from "./RiskFlagModals";
import { ShortcutsModal } from "@web/components/ShortcutsModal";
import { BRIEF_SHORTCUT_SECTIONS } from "./consts";
import { Sidebar } from "./Sidebar";
import { StoryView } from "./StoryView";
import { CONTENT_START_ATTR, deriveChunkSizes } from "./utils";
import { buildLineOwnersByFile } from "../../utils/lineOwner";
import type { ChangesReviewWiring } from "./ChangesOnlyView/types";
import { SummarySection } from "./SummarySection";
import { ReadingPositionProvider } from "./readingPosition";
import styles from "./BriefScreen.module.scss";
import {
  useBriefScreenFacade,
  OWN_DRAFT_STALE_COMPOSER_REASON_KEY,
} from "./useBriefScreenFacade";
import type { BriefScreenProps, LensPaneProps, StoryMainStyle } from "./types";

export type { BriefComparisonPlan } from "./useComparisonOverlay";
export { markReadyBatchFailureCopy } from "./utils";
export { POST_COMMENT_COPY_KEYS } from "./useOwnDraftFlow";
export { OWN_DRAFT_STALE_COMPOSER_REASON_KEY };
export type { BriefScreenProps, OwnDraftPlan, ScopeExitOptions } from "./types";

const LensPane = memo(
  function LensPane({ children }: LensPaneProps) {
    return children;
  },
  (_previous, next) => next.frozen,
);

export function BriefScreen({
  livePrState,
  artifacts,
  brief,
  repoConfig,
  briefId,
  repoId,
  comparisonPlan,
  fileRows,
  model,
  searchParams,
  conversation,
  conversationFocusThreadId,
  conversationFilter,
  onConversationFilterChange,
  headerControls,
  openDeltaLens,
  exitChangesScope,
  clearDiffParam,
  link,
  navigateLink,
  ownDraft,
  readOnly,
  reviewSession,
  revisionPending,
  revisions,
  staleHead,
  submitReview,
}: BriefScreenProps) {
  const {
    t,
    focusPanel,
    focusPanelShown,
    attributeRail,
    pendingShown,
    overlay,
    sinceMarkers,
    ownDraftActive,
    writesDisabled,
    writesDisabledReason,
    session,
    regions,
    band,
    sidebar,
    sidebarLayout,
    inChangesScope,
    changesEverShownRef,
    storyEverShownRef,
    chunkWindowsRef,
    queueJumpFromChanges,
    queueChunkJumpFromChanges,
    submitOpen,
    toast,
    liveMessage,
    reanchorLocation,
    cancelReanchorFromBanner,
    conversationWiring,
    revisionNav,
    submitFlow,
    liveSubmit,
    markReady,
    intentBarRef,
    flowStore,
    readingPosition,
    openSubmit,
    draftCommentCount,
    closeSubmit,
    submitFromModal,
    jumpToSubmitItem,
    conversationReadOnly,
    announce,
    diffView,
    toggleDiffView,
    cardTrack,
    conversationPlan,
    expansionSource,
    lineLinkMissed,
    dismissLineLinkMiss,
    shareChunk,
  } = useBriefScreenFacade({
    livePrState,
    artifacts,
    brief,
    repoConfig,
    briefId,
    repoId,
    fileRows,
    comparisonPlan,
    model,
    searchParams,
    conversation,
    conversationFocusThreadId,
    conversationFilter,
    onConversationFilterChange,
    headerControls,
    openDeltaLens,
    exitChangesScope,
    clearDiffParam,
    link,
    navigateLink,
    ownDraft,
    readOnly,
    reviewSession,
    revisionPending,
    staleHead,
    submitReview,
  });

  // The provider memoizes on this identity, so it has to be stable itself.
  const chunkSizes = useMemo(
    () => deriveChunkSizes(brief.chunks),
    [brief.chunks],
  );
  // Per file, shared by both scopes: a story card frames a sibling span with
  // its owner, a Changes guest table anchors a row to it.
  const lineOwnersByFile = useMemo(
    () => buildLineOwnersByFile(model, t),
    [model, t],
  );
  const changesReview = useMemo<ChangesReviewWiring>(
    () => ({
      lineOwnersByFile,
      lineThreadsByFile: conversationWiring.lineThreadsByFile,
      conversationComposer: conversationWiring.conversationComposer,
    }),
    [
      lineOwnersByFile,
      conversationWiring.lineThreadsByFile,
      conversationWiring.conversationComposer,
    ],
  );
  const readThroughAvailable =
    overlay.compareState.view === "full" && session.chunkIds.length > 0;
  const focusPanelState = focusPanel.open ? "open" : "closed";
  const focusPanelAttr = focusPanelShown ? focusPanelState : undefined;
  const mainStyle: StoryMainStyle =
    cardTrack.track === undefined
      ? {}
      : { "--story-card-track": `${cardTrack.track}px` };

  return (
    <ReviewFlowProvider store={flowStore}>
      <TokenPlanProvider briefKey={briefId} chunkSizes={chunkSizes}>
        <ExpansionSourceProvider source={expansionSource}>
          <FileRowsProvider cache={fileRows}>
            <ReadingPositionProvider store={readingPosition}>
              <Header
                toggleShortcuts={session.toggleShortcuts}
                focusMode={session.focusMode}
                brief={brief}
                livePrState={livePrState}
                repoConfig={repoConfig}
                briefId={briefId}
                repoId={repoId}
                model={model}
                totals={session.totals}
                progress={session.progress}
                openSubmit={openSubmit}
                draftCommentCount={draftCommentCount}
                availability={overlay.availability}
                compareState={overlay.compareState}
                controlsSlot={headerControls}
                revisionPending={pendingShown}
                jumpToGroup={(groupId) => queueJumpFromChanges(groupId, false)}
                jumpToGroupHeading={(groupId) =>
                  queueJumpFromChanges(groupId, true)
                }
                ownDraft={
                  ownDraftActive
                    ? {
                        markReady: markReady.request,
                        pending: markReady.pending,
                        unavailable: !markReady.available,
                      }
                    : undefined
                }
              />
              {lineLinkMissed ? (
                <LineLinkNotice onDismiss={dismissLineLinkMiss} />
              ) : null}
              {session.focusMode ? (
                <FocusIndicator
                  indicatorRef={session.focusIndicatorRef}
                  groups={model.groups}
                  jumpToChunk={session.jumpToChunk}
                  exitFocusMode={session.toggleFocusMode}
                />
              ) : null}
              {reanchorLocation !== undefined ? (
                <ReanchorBanner
                  cancel={cancelReanchorFromBanner}
                  location={reanchorLocation}
                />
              ) : null}
              <main
                className="main"
                style={mainStyle}
                data-diff-view={diffView}
                id="main-content"
                tabIndex={-1}
                data-zen={session.focusMode ? "on" : undefined}
                data-focus-panel={focusPanelAttr}
                data-pending={pendingShown ? "" : undefined}
                data-sidebar={regions.sidebar ? sidebarLayout : undefined}
                data-sidebar-motion={sidebar.motionReady ? "" : undefined}
                aria-busy={pendingShown || undefined}
                inert={pendingShown || undefined}
              >
                {regions.carryOver && reviewSession !== undefined ? (
                  <CarryOver
                    headSha={brief.pr.sha}
                    jumpToItem={jumpToSubmitItem}
                    model={model}
                    session={reviewSession}
                  />
                ) : null}

                {regions.summary ? (
                  <>
                    <SummarySection brief={brief} />
                    {brief.intentCheck ? (
                      <IntentBar
                        groupTitles={Object.fromEntries(
                          brief.changeGroups.map((group) => [
                            group.id,
                            group.title,
                          ]),
                        )}
                        key={`intent-${briefId}`}
                        intentCheck={brief.intentCheck}
                        jumpToGroup={(groupId) =>
                          queueJumpFromChanges(groupId, false)
                        }
                        ref={intentBarRef}
                      />
                    ) : null}
                  </>
                ) : null}

                {regions.summary && brief.concernView.length >= 2 ? (
                  <ConcernStrip
                    remainder={model.unattributed}
                    rollup={brief.concernView}
                  />
                ) : null}

                {regions.toolbar ? (
                  <ReadingToolbar
                    key={`toolbar-${briefId}`}
                    comparison={overlay.comparison}
                    revisionNav={revisionNav}
                    startReadThrough={
                      readThroughAvailable
                        ? session.startReadThrough
                        : undefined
                    }
                    filter={
                      conversation !== undefined &&
                      onConversationFilterChange !== undefined &&
                      conversationWiring.conversationFilterFacets !== undefined
                        ? {
                            filter:
                              conversationWiring.conversationFilterFacets
                                .applied,
                            hiddenInlineThreads:
                              conversationWiring.conversationFilterFacets
                                .hiddenInlineThreads,
                            reviewers:
                              conversationWiring.conversationFilterFacets
                                .reviewers,
                            verdicts:
                              conversationWiring.conversationFilterFacets
                                .verdicts,
                            onChange: onConversationFilterChange,
                          }
                        : undefined
                    }
                    jumpToGroup={session.jumpToGroup}
                    rail={attributeRail}
                    supportingCollapse={session.supportingCollapse}
                    toggleCollapseSupporting={session.toggleCollapseSupporting}
                  />
                ) : null}

                {regions.conversation && conversationPlan !== undefined ? (
                  <ConversationSection
                    key={`conversation-${briefId}`}
                    {...conversationReadOnly}
                    chunks={session.readingOrderedChunks}
                    filter={conversationFilter}
                    focusThreadId={conversationFocusThreadId}
                    jumpToChunk={conversationWiring.jumpToChunkFromConversation}
                    localComments={session.reviewComments}
                    markCommentsSubmitted={(ids) =>
                      session.actions.markCommentsSubmitted(ids)
                    }
                    open={conversationWiring.open}
                    onToggle={conversationWiring.toggleOpen}
                    plan={conversationPlan}
                    submittedReviewIds={session.submittedReviewIds}
                  />
                ) : null}

                <div aria-hidden="true" {...{ [CONTENT_START_ATTR]: "" }} />
                <ChunkWindowProvider registry={chunkWindowsRef.current}>
                  {changesEverShownRef.current ? (
                    <div hidden={!inChangesScope || undefined}>
                      <LensPane frozen={!inChangesScope}>
                        <ChangesOnlyView
                          key={`changes-${briefId}`}
                          compare={
                            overlay.activeCompare === "last-review"
                              ? "last-review"
                              : "previous-brief"
                          }
                          brief={brief}
                          model={model}
                          narrative={overlay.narrative}
                          marks={overlay.marks}
                          skipReason={overlay.skipReason}
                          delta={overlay.delta}
                          rawSpanDiff={overlay.activeRawSpanDiff}
                          deltaSpan={overlay.deltaSpanStatus}
                          narrativeSpanRows={overlay.narrativeSpanRows}
                          jumpToChunk={queueChunkJumpFromChanges}
                          review={changesReview}
                        />
                      </LensPane>
                    </div>
                  ) : null}
                  {storyEverShownRef.current ? (
                    <div hidden={inChangesScope || undefined}>
                      <LensPane frozen={inChangesScope}>
                        <StoryView
                          brief={brief}
                          diffView={diffView}
                          model={model}
                          lineOwnersByFile={lineOwnersByFile}
                          comparison={overlay.comparison}
                          focusMode={session.focusMode}
                          sidebar={sidebarLayout}
                          cardTrack={cardTrack}
                          openDeltaLens={openDeltaLens}
                          sinceMarkers={sinceMarkers}
                          openChunks={session.openChunks}
                          addressedReviewComments={brief.reviewComments}
                          conversationByChunk={
                            conversationWiring.conversationByChunk
                          }
                          hiddenThreadsByFile={
                            conversationWiring.hiddenThreadsByFile
                          }
                          lineThreadsByFile={
                            conversationWiring.lineThreadsByFile
                          }
                          jumpToLine={
                            conversationWiring.jumpToChunkFromConversation
                          }
                          shareChunk={shareChunk}
                          conversationComposer={
                            conversationWiring.conversationComposer
                          }
                          jumpToChunk={session.jumpToChunk}
                          markReviewed={session.markReviewed}
                          marksDisabled={writesDisabled}
                          toggleChunk={session.toggleChunk}
                        />
                      </LensPane>
                    </div>
                  ) : null}
                </ChunkWindowProvider>
              </main>
              {regions.sidebar ? (
                <Sidebar
                  key={`sidebar-${briefId}`}
                  band={band}
                  conversationGroupIds={conversationWiring.conversationGroupIds}
                  groups={model.groups}
                  jumpToGroup={session.jumpToGroup}
                  jumpToGroupHeading={session.jumpToGroupHeading}
                  pending={pendingShown}
                  state={sidebar}
                  toggleShortcuts={session.toggleShortcuts}
                  diffView={diffView}
                  toggleDiffView={toggleDiffView}
                  revisions={revisions}
                />
              ) : null}
              {ownDraftActive ? null : (
                <>
                  <SubmitModal
                    receipt={session.receipt}
                    open={submitOpen}
                    close={closeSubmit}
                    outcome={session.reviewOutcome}
                    setOutcome={(outcome) => {
                      if (writesDisabledReason !== undefined) {
                        announce(writesDisabledReason);
                        return;
                      }
                      session.actions.setOutcome(outcome);
                    }}
                    submit={submitFromModal}
                    unresolvedItems={session.unresolvedItems}
                    jumpToItem={jumpToSubmitItem}
                    submitPending={
                      liveSubmit && !writesDisabled ? submitFlow.pending : false
                    }
                    blockedReasonOverride={writesDisabledReason}
                    blockedReasonWith={
                      liveSubmit ? submitFlow.blockedReasonWith : undefined
                    }
                    submitError={
                      liveSubmit && !writesDisabled ? submitFlow.error : null
                    }
                    submitNote={liveSubmit ? submitFlow.note : null}
                    staleHead={staleHead === true}
                  />
                </>
              )}
              {ownDraftActive ? null : (
                <RiskFlagModals flagsById={model.flagsById} />
              )}
              {ownDraftActive &&
              markReady.available &&
              (model.flags.length > 0 || markReady.unpostedDraftCount > 0) ? (
                <MarkReadyModal
                  open={markReady.gateOpen}
                  flags={model.flags}
                  unpostedDraftCount={markReady.unpostedDraftCount}
                  close={markReady.closeGate}
                  markReadyAnyway={markReady.markReadyAnyway}
                  jumpToFlag={markReady.jumpToFlag}
                  jumpToDrafts={markReady.jumpToDrafts}
                  intentGapCount={markReady.intentGapCount}
                  intentTensionCount={markReady.intentTensionCount}
                  jumpToIntentGaps={markReady.jumpToIntentGaps}
                  postDrafts={markReady.postDraftsOnReady}
                  setPostDrafts={markReady.setPostDraftsOnReady}
                  busyLabel={markReady.batchBusyLabel}
                />
              ) : null}
              <ShortcutsModal
                open={session.shortcutsOpen}
                close={session.closeShortcuts}
                sections={BRIEF_SHORTCUT_SECTIONS}
              />
              {focusPanelShown ? (
                <FocusPanel
                  model={model}
                  jumpToChunk={session.jumpToChunk}
                  open={focusPanel.open}
                  setOpen={focusPanel.setOpen}
                />
              ) : null}
              {session.focusMode ? <FocusShortcuts /> : null}
              <div
                className={styles["toast"]}
                data-testid="brief-toast"
                data-state={toast ? "visible" : "hidden"}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {toast}
              </div>
              <div
                className="sr-only"
                data-testid="brief-live"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {liveMessage}
              </div>
            </ReadingPositionProvider>
          </FileRowsProvider>
        </ExpansionSourceProvider>
      </TokenPlanProvider>
    </ReviewFlowProvider>
  );
}
