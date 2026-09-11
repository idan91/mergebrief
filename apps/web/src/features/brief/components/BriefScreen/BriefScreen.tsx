import { memo } from "react";

import { Button } from "@web/components/Button/Button";
import { ConversationSection } from "@web/features/conversation";
import { SubmitModal } from "@web/features/review";
import { ReviewFlowProvider } from "@web/features/review/session";
// Through the pulls COMPONENT entry, not the feature index: the index also
// exports the PrBrief tree, which renders BriefView, so importing it here
// would close a brief -> pulls -> brief module cycle.
import { MarkReadyModal } from "@web/features/pulls/components";
import { ChunkWindowProvider } from "./chunkWindows";
import { ChangesOnlyView } from "./ChangesOnlyView/ChangesOnlyView";
import { ConcernStrip } from "./ConcernStrip/ConcernStrip";
import { FocusBanner } from "./FocusBanner/FocusBanner";
import { IntentBar } from "./IntentBar/IntentBar";
import { CarryOver } from "./CarryOver/CarryOver";
import { Header } from "./Header/Header";
import { ReadingToolbar } from "./ReadingToolbar/ReadingToolbar";
import { RiskFlagModals } from "./RiskFlagModals/RiskFlagModals";
import { ShortcutsModal } from "./ShortcutsModal/ShortcutsModal";
import { Sidebar } from "./Sidebar";
import { StoryView } from "./StoryView/StoryView";
import { CONTENT_START_ATTR } from "./utils";
import { SummarySection } from "./SummarySection/SummarySection";
import { ReadingPositionProvider } from "./readingPosition";
import styles from "./BriefScreen.module.scss";
import {
  useBriefScreenFacade,
  OWN_DRAFT_STALE_COMPOSER_REASON_KEY,
} from "./useBriefScreenFacade";
import type { BriefScreenProps, LensPaneProps } from "./types";

export type { BriefComparisonPlan } from "./useComparisonOverlay";
export { markReadyBatchFailureCopy } from "./utils";
export { POST_COMMENT_COPY_KEYS } from "./useOwnDraftFlow";
export { OWN_DRAFT_STALE_COMPOSER_REASON_KEY };
export type { BriefScreenProps, OwnDraftPlan } from "./types";

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
  model,
  searchParams,
  conversation,
  conversationFocusThreadId,
  conversationFilter,
  onConversationFilterChange,
  headerControls,
  openDeltaLens,
  exitChangesScope,
  ownDraft,
  readOnly,
  reviewSession,
  revisionPending,
  staleHead,
  submitReview,
}: BriefScreenProps) {
  const {
    t,
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
    submitOpen,
    toast,
    conversationWiring,
    revisionNav,
    submitFlow,
    liveSubmit,
    markReady,
    intentBarRef,
    flowStore,
    readingPosition,
    openSubmit,
    closeSubmit,
    submitFromModal,
    jumpToSubmitItem,
    conversationReadOnly,
    announce,
  } = useBriefScreenFacade({
    livePrState,
    artifacts,
    brief,
    repoConfig,
    briefId,
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
    ownDraft,
    readOnly,
    reviewSession,
    revisionPending,
    staleHead,
    submitReview,
  });

  return (
    <ReviewFlowProvider store={flowStore}>
      <ReadingPositionProvider store={readingPosition}>
        <Header
          brief={brief}
          livePrState={livePrState}
          repoConfig={repoConfig}
          briefId={briefId}
          repoId={repoId}
          timeline={overlay.timeline}
          model={model}
          totals={session.totals}
          progress={session.progress}
          openSubmit={openSubmit}
          availability={overlay.availability}
          compareState={overlay.compareState}
          controlsSlot={headerControls}
          revisionPending={pendingShown}
          jumpToGroup={(groupId) => queueJumpFromChanges(groupId, false)}
          jumpToGroupHeading={(groupId) => queueJumpFromChanges(groupId, true)}
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
        {session.focusMode ? (
          <FocusBanner
            bannerRef={session.focusBannerRef}
            groups={model.groups}
            jumpToChunk={session.jumpToChunk}
            toggleFocusMode={session.toggleFocusMode}
          />
        ) : null}
        <main
          className={
            session.layoutMode === "split" ? "main split-main" : "main"
          }
          id="main-content"
          tabIndex={-1}
          data-zen={session.focusMode ? "on" : undefined}
          data-pending={pendingShown ? "" : undefined}
          data-sidebar={regions.sidebar ? sidebarLayout : undefined}
          data-sidebar-motion={sidebar.motionReady ? "" : undefined}
          aria-busy={pendingShown || undefined}
          inert={pendingShown || undefined}
        >
          {reviewSession !== undefined ? (
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
                    brief.changeGroups.map((group) => [group.id, group.title]),
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
              filter={
                conversation !== undefined &&
                onConversationFilterChange !== undefined &&
                conversationWiring.conversationFilterFacets !== undefined
                  ? {
                      filter:
                        conversationWiring.conversationFilterFacets.applied,
                      hiddenInlineThreads:
                        conversationWiring.conversationFilterFacets
                          .hiddenInlineThreads,
                      reviewers:
                        conversationWiring.conversationFilterFacets.reviewers,
                      verdicts:
                        conversationWiring.conversationFilterFacets.verdicts,
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

          {regions.conversation && conversation !== undefined ? (
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
              plan={conversation}
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
                  />
                </LensPane>
              </div>
            ) : null}
            {storyEverShownRef.current ? (
              <div hidden={inChangesScope || undefined}>
                <LensPane frozen={inChangesScope}>
                  <StoryView
                    brief={brief}
                    model={model}
                    comparison={overlay.comparison}
                    focusMode={session.focusMode}
                    openDeltaLens={openDeltaLens}
                    sinceMarkers={sinceMarkers}
                    openChunks={session.openChunks}
                    addressedReviewComments={brief.reviewComments}
                    conversationByChunk={conversationWiring.conversationByChunk}
                    conversationComposer={
                      conversationWiring.conversationComposer
                    }
                    jumpToChunk={session.jumpToChunk}
                    markReviewed={session.markReviewed}
                    marksDisabled={writesDisabled}
                    toggleChunk={session.toggleChunk}
                    {...(overlay.compareState.view === "full" &&
                    session.chunkIds.length > 0
                      ? { startReadThrough: session.startReadThrough }
                      : {})}
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
        {ownDraftActive ? null : <RiskFlagModals flagsById={model.flagsById} />}
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
        />
        {session.focusMode ? (
          <div className={styles["focusExit"]}>
            <Button onClick={session.toggleFocusMode}>
              {t("brief.screen.exitFocus")}
            </Button>
          </div>
        ) : null}
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
      </ReadingPositionProvider>
    </ReviewFlowProvider>
  );
}
