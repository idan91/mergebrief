import { memo, useMemo } from "react";

import { TokenPlanProvider } from "@web/hooks/useTokenPlan";
import { ExpansionProvider } from "../../../model/expansion/useExpansion";
import { ExpansionSourceProvider } from "../../../model/expansion/useExpansionSource";
import { FileRowsProvider } from "../../../model/file-rows/useFileRows";
import {
  attachChunkListRows,
  attachModelRows,
} from "../../../model/file-rows/cache";
import { ChunkLayoutProvider } from "../../../model/chunk-layout/useChunkLayout";
import { useHeldCardPosition } from "./reading/useHeldCardPosition";
import { ReviewPostureProvider } from "../../hooks/useReviewPosture";
import { ConversationSection } from "@web/features/conversation";
import { SubmitModal } from "@web/features/review";
import {
  ReviewFlowProvider,
  ReviewSessionProvider,
} from "@web/features/review/session";
import { MarkReadyModal } from "./MarkReadyModal";
import { ChunkWindowProvider } from "./reading/chunk-windows";
import { ChangesOnlyView } from "./ChangesOnlyView";
import { FocusIndicator } from "./FocusIndicator";
import { FocusPanel } from "./FocusPanel";
import { FocusShortcuts } from "./FocusShortcuts";
import { LargeTitle } from "./LargeTitle";
import { DiffTimeoutNotice } from "../DiffTimeoutNotice";
import { LineLinkNotice } from "./LineLinkNotice";
import { Masthead } from "./Masthead";
import { IntentBar } from "./IntentBar";
import { CarryOver } from "./CarryOver";
import { Header } from "./Header";
import { BriefControlsSheet } from "./BriefControlsSheet";
import { LandscapeRow } from "./LandscapeRow";
import { useRotationHold } from "./hooks/useRotationHold";
import { PhoneBar } from "./PhoneBar";
import { Toast } from "@web/components/Toast";
import { ReadingToolbar } from "./ReadingToolbar";
import { ReanchorBanner } from "./ReanchorBanner";
import { RiskFlagModals } from "./RiskFlagModals";
import { ShortcutsModal } from "@web/components/ShortcutsModal";
import { NoticeSurfaces, VersionNotice } from "@web/features/version";
import { BRIEF_SHORTCUT_SECTIONS } from "./consts";
import { Sidebar } from "./Sidebar";
import { StoryView } from "./StoryView";
import { CONTENT_START_ATTR, deriveChunkSizes } from "./utils";
import { buildLineOwnersByFile } from "../../../model/utils/line-owner";
import { CompareParams } from "../../../model/comparison/types";
import type { ChangesReviewWiring } from "./ChangesOnlyView/types";
import { ReadingPositionProvider } from "./reading/reading-position";
import styles from "./BriefView.module.scss";
import { useBriefViewFacade } from "./useBriefViewFacade";
import type { BriefViewProps, ScopePaneProps, StoryMainStyle } from "./types";

export { markReadyBatchFailureCopy } from "./utils";
export { POST_COMMENT_COPY_KEYS } from "./drafts/useOwnDraftFlow";
export { OWN_DRAFT_STALE_COMPOSER_REASON_KEY } from "./consts";
export type { BriefViewProps, OwnDraftPlan } from "./types";

const ScopePane = memo(
  function ScopePane({ children }: ScopePaneProps) {
    return children;
  },
  (_previous, next) => next.frozen,
);

export function BriefView({
  reading,
  address,
  pr,
  review,
  conversation,
}: BriefViewProps) {
  // Restored drafts resolve their lines against the rows; the screen keeps
  // the stable model, so a landed diff re-renders only the cards.
  const sessionModel = useMemo(
    () => attachModelRows(reading.model, reading.fileRows),
    [reading.model, reading.fileRows],
  );
  return (
    <ReviewSessionProvider
      briefId={reading.briefId}
      model={sessionModel}
      reads={review?.sessionReads}
      session={review?.session}
      writes={review?.writes}
    >
      <BriefViewContent
        reading={reading}
        address={address}
        pr={pr}
        review={review}
        conversation={conversation}
      />
    </ReviewSessionProvider>
  );
}

function BriefViewContent(props: BriefViewProps) {
  const { reading, pr, conversation } = props;
  const { brief, briefId, model, fileRows, repoConfig, chunkLayout } = reading;
  const {
    t,
    chunkFooter,
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
    changesPaneMounted,
    storyPaneMounted,
    chunkWindowsRef,
    scrollToTop,
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
    posture,
    readingPosition,
    expansion,
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
    jumpToChunkUnderStack,
    jumpToChunkFromSidebar,
    staleHead,
    largeTitle,
    attachLargeTitle,
    phoneChrome,
    riskAttrCycle,
  } = useBriefViewFacade(props);

  // The provider memoizes on this identity, so it has to be stable itself.
  const chunkSizes = useMemo(() => {
    const chunks = model.groups.flatMap((group) => group.chunks);
    const attachedChunks = attachChunkListRows(chunks, fileRows);
    return deriveChunkSizes(attachedChunks, chunkLayout?.counts);
  }, [model.groups, chunkLayout?.counts, fileRows]);
  useHeldCardPosition(
    chunkLayout?.codePending === true,
    chunkWindowsRef.current,
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
  const intentBar = brief.intentCheck ? (
    <IntentBar
      groupTitles={Object.fromEntries(
        brief.changeGroups.map((group) => [group.id, group.title]),
      )}
      key={`intent-${briefId}`}
      intentCheck={brief.intentCheck}
      jumpToGroup={(groupId) => queueJumpFromChanges(groupId, false)}
      ref={intentBarRef}
    />
  ) : null;
  const conversationSection =
    regions.conversation && conversationPlan !== undefined ? (
      <ConversationSection
        key={`conversation-${briefId}`}
        {...conversationReadOnly}
        chunks={session.readingOrderedChunks}
        filter={conversation?.filter}
        focusThreadId={conversation?.focusThreadId}
        jumpToChunk={conversationWiring.jumpToChunkFromConversation}
        localComments={session.reviewComments}
        markCommentsSubmitted={(ids) =>
          session.actions.markCommentsSubmitted(ids)
        }
        open={conversationWiring.open}
        onToggle={conversationWiring.toggleOpen}
        plan={conversationPlan}
        submittedReviewIds={session.submittedReviewIds}
        beginSmoothScroll={chunkWindowsRef.current.beginSmoothScroll}
      />
    ) : null;
  const readThroughAvailable =
    overlay.compareState.view === "full" && session.chunkIds.length > 0;
  const toolbarFilter =
    conversation !== undefined &&
    conversationWiring.conversationFilterFacets !== undefined
      ? {
          filter: conversationWiring.conversationFilterFacets.applied,
          hiddenInlineThreads:
            conversationWiring.conversationFilterFacets.hiddenInlineThreads,
          reviewers: conversationWiring.conversationFilterFacets.reviewers,
          verdicts: conversationWiring.conversationFilterFacets.verdicts,
          onChange: conversation.onFilterChange,
        }
      : undefined;
  const toolbarControls = {
    filter: toolbarFilter,
    rail: attributeRail,
    jumpToGroup: session.jumpToGroup,
    riskAttrCycle,
    supportingCollapse: session.supportingCollapse,
    toggleCollapseSupporting: session.toggleCollapseSupporting,
    startReadThrough: readThroughAvailable
      ? session.startReadThrough
      : undefined,
    comparison: overlay.comparison,
    revisionNav,
  };
  const ownDraftHeader = ownDraftActive
    ? {
        markReady: markReady.request,
        pending: markReady.pending,
        unavailable: !markReady.available,
      }
    : undefined;
  const sheetToolbarControls = regions.toolbar ? toolbarControls : undefined;
  const chunksSheetExpanded = regions.sidebar && sidebar.expanded;
  const openChunksSheet = regions.sidebar ? sidebar.toggle : undefined;
  useRotationHold(readingPosition, session.placeChunkUnderStack);
  const landscapeRow = regions.landscapeRow ? (
    <LandscapeRow
      key={`landscape-row-${briefId}`}
      brief={brief}
      chunkIds={session.chunkIds}
      controlsRef={phoneChrome.rowControlsRef}
      sidebarSheetOpen={chunksSheetExpanded}
      indicatorRef={phoneChrome.rowIndicatorRef}
      jumpToChunk={jumpToChunkUnderStack}
      markReviewed={session.markReviewed}
      marksDisabled={writesDisabled}
      model={model}
      openBriefControls={phoneChrome.openControls}
      openChunks={session.openChunks}
      placeChunkUnderStack={session.placeChunkUnderStack}
      openSidebarSheet={openChunksSheet}
      pending={pendingShown}
      scope={overlay.compareState.view}
      shareChunk={shareChunk}
      toggleChunk={session.toggleChunk}
    />
  ) : undefined;
  const focusPanelState = focusPanel.open ? "open" : "closed";
  const focusPanelBeside = focusPanelShown && !focusPanel.sheet;
  const focusPanelAttr = focusPanelBeside ? focusPanelState : undefined;
  const mainStyle: StoryMainStyle =
    cardTrack.track === undefined
      ? {}
      : { "--story-card-track": `${cardTrack.track}px` };

  return (
    <ReviewFlowProvider store={flowStore}>
      <ReviewPostureProvider posture={posture}>
        <TokenPlanProvider briefKey={briefId} chunkSizes={chunkSizes}>
          <ExpansionSourceProvider source={expansionSource}>
            <ExpansionProvider store={expansion}>
              <FileRowsProvider cache={fileRows}>
                <ChunkLayoutProvider state={chunkLayout}>
                  <ReadingPositionProvider store={readingPosition}>
                    <Header
                      toggleShortcuts={session.toggleShortcuts}
                      focusMode={session.focusMode}
                      largeTitle={largeTitle}
                      landscapeRow={landscapeRow}
                      brief={brief}
                      livePrState={pr?.livePrState}
                      authorLogin={pr?.authorLogin}
                      briefId={briefId}
                      repoId={pr?.repoId}
                      model={model}
                      totals={session.totals}
                      progress={session.progress}
                      openSubmit={openSubmit}
                      draftCommentCount={draftCommentCount}
                      availability={overlay.availability}
                      compareState={overlay.compareState}
                      controlsSlot={pr?.headerControls}
                      revisionPending={pendingShown}
                      jumpToGroup={(groupId) =>
                        queueJumpFromChanges(groupId, false)
                      }
                      jumpToGroupHeading={(groupId) =>
                        queueJumpFromChanges(groupId, true)
                      }
                      ownDraft={ownDraftHeader}
                    />
                    <VersionNotice surface={NoticeSurfaces.BRIEF} />
                    {lineLinkMissed ? (
                      <LineLinkNotice onDismiss={dismissLineLinkMiss} />
                    ) : null}
                    {pr?.diffTimeout === undefined ? null : (
                      <div className={styles["diffTimeoutBand"]}>
                        <DiffTimeoutNotice retry={pr.diffTimeout} />
                      </div>
                    )}
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
                      className={`main ${styles["readingColumn"]}`}
                      style={mainStyle}
                      data-diff-view={diffView}
                      id="main-content"
                      tabIndex={-1}
                      data-zen={session.focusMode ? "on" : undefined}
                      data-focus-panel={focusPanelAttr}
                      data-pending={pendingShown ? "" : undefined}
                      data-sidebar={regions.sidebar ? sidebarLayout : undefined}
                      data-phone-bar={regions.phoneBar ? "" : undefined}
                      data-sidebar-motion={sidebar.motionReady ? "" : undefined}
                      aria-busy={pendingShown || undefined}
                      inert={pendingShown || undefined}
                    >
                      {regions.summary ? (
                        <LargeTitle
                          ref={attachLargeTitle}
                          authorLogin={pr?.authorLogin}
                          brief={brief}
                          livePrState={pr?.livePrState}
                          model={model}
                          ownDraft={ownDraftActive}
                          repoConfig={repoConfig}
                          repoId={pr?.repoId}
                          totals={session.totals}
                        />
                      ) : null}
                      {regions.carryOver ? (
                        <CarryOver
                          headSha={brief.pr.sha}
                          jumpToItem={jumpToSubmitItem}
                          model={model}
                        />
                      ) : null}

                      {regions.summary ? (
                        <Masthead
                          brief={brief}
                          model={model}
                          repoConfig={repoConfig}
                        >
                          {intentBar}
                          {conversationSection}
                        </Masthead>
                      ) : null}

                      {regions.toolbar ? (
                        <ReadingToolbar
                          key={`toolbar-${briefId}`}
                          comparison={overlay.comparison}
                          revisionNav={revisionNav}
                          startReadThrough={toolbarControls.startReadThrough}
                          filter={toolbarControls.filter}
                          jumpToGroup={toolbarControls.jumpToGroup}
                          rail={toolbarControls.rail}
                          riskAttrCycle={toolbarControls.riskAttrCycle}
                          supportingCollapse={
                            toolbarControls.supportingCollapse
                          }
                          toggleCollapseSupporting={
                            toolbarControls.toggleCollapseSupporting
                          }
                        />
                      ) : null}

                      <div
                        aria-hidden="true"
                        {...{ [CONTENT_START_ATTR]: "" }}
                      />
                      <ChunkWindowProvider registry={chunkWindowsRef.current}>
                        {changesPaneMounted ? (
                          <div hidden={!inChangesScope || undefined}>
                            <ScopePane frozen={!inChangesScope}>
                              <ChangesOnlyView
                                key={`changes-${briefId}`}
                                compare={
                                  overlay.activeCompare ===
                                  CompareParams.LAST_REVIEW
                                    ? CompareParams.LAST_REVIEW
                                    : CompareParams.PREVIOUS_BRIEF
                                }
                                brief={brief}
                                model={model}
                                narrative={overlay.narrative}
                                marks={overlay.marks}
                                skipReason={overlay.skipReason}
                                narrativeUnchanged={overlay.narrativeUnchanged}
                                delta={overlay.delta}
                                deltaSkipped={overlay.deltaSkipped}
                                deltaUnchanged={overlay.deltaUnchanged}
                                rawSpanDiff={overlay.activeRawSpanDiff}
                                deltaSpan={overlay.deltaSpanStatus}
                                deltaSpanLanding={overlay.deltaSpanLanding}
                                narrativeSpanRows={overlay.narrativeSpanRows}
                                jumpToChunk={queueChunkJumpFromChanges}
                                review={changesReview}
                              />
                            </ScopePane>
                          </div>
                        ) : null}
                        {storyPaneMounted ? (
                          <div hidden={inChangesScope || undefined}>
                            <ScopePane frozen={inChangesScope}>
                              <StoryView
                                brief={brief}
                                chunkActionsFor={session.chunkActionsFor}
                                openChunkActions={session.openChunkActions}
                                closeChunkActions={session.closeChunkActions}
                                diffView={diffView}
                                model={model}
                                lineOwnersByFile={lineOwnersByFile}
                                comparison={overlay.comparison}
                                focusMode={session.focusMode}
                                sidebar={sidebarLayout}
                                cardTrack={cardTrack}
                                openComparison={pr?.openComparison}
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
                                jumpToChunk={jumpToChunkUnderStack}
                                markReviewed={session.markReviewed}
                                marksDisabled={writesDisabled}
                                toggleChunk={session.toggleChunk}
                                chunkFooter={chunkFooter}
                              />
                            </ScopePane>
                          </div>
                        ) : null}
                      </ChunkWindowProvider>
                    </main>
                    {regions.sidebar ? (
                      <Sidebar
                        key={`sidebar-${briefId}`}
                        band={band}
                        conversationGroupIds={
                          conversationWiring.conversationGroupIds
                        }
                        groups={model.groups}
                        jumpToGroup={session.jumpToGroup}
                        jumpToGroupHeading={session.jumpToGroupHeading}
                        jumpToChunk={jumpToChunkFromSidebar}
                        scrollToTop={scrollToTop}
                        pending={pendingShown}
                        state={sidebar}
                        toggleShortcuts={session.toggleShortcuts}
                        diffView={diffView}
                        toggleDiffView={toggleDiffView}
                        revisions={reading.revisions}
                        sheetTriggerRef={phoneChrome.sheetTriggerRef}
                      />
                    ) : null}
                    {regions.phoneBar ? (
                      <PhoneBar
                        chunkIds={session.chunkIds}
                        chunksExpanded={chunksSheetExpanded}
                        controlsRef={phoneChrome.barControlsRef}
                        indicatorRef={phoneChrome.barIndicatorRef}
                        jumpToChunk={jumpToChunkUnderStack}
                        openBriefControls={phoneChrome.openControls}
                        openChunks={openChunksSheet}
                        scope={overlay.compareState.view}
                      />
                    ) : null}
                    {phoneChrome.controlsOpen ? (
                      <BriefControlsSheet
                        availability={overlay.availability}
                        brief={brief}
                        briefId={briefId}
                        close={phoneChrome.closeControls}
                        compareState={overlay.compareState}
                        controlsSlot={pr?.headerControls}
                        draftCommentCount={draftCommentCount}
                        model={model}
                        openSubmit={openSubmit}
                        ownDraft={ownDraftHeader}
                        repoConfig={repoConfig}
                        toggleShortcuts={session.toggleShortcuts}
                        toolbar={sheetToolbarControls}
                        totals={session.totals}
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
                            liveSubmit && !writesDisabled
                              ? submitFlow.pending
                              : false
                          }
                          blockedReasonOverride={writesDisabledReason}
                          blockedReasonWith={
                            liveSubmit
                              ? submitFlow.blockedReasonWith
                              : undefined
                          }
                          submitError={
                            liveSubmit && !writesDisabled
                              ? submitFlow.error
                              : null
                          }
                          submitNote={liveSubmit ? submitFlow.note : null}
                          signatureLine={
                            liveSubmit ? submitFlow.signatureLine : undefined
                          }
                          staleHead={staleHead}
                          mentionSource={
                            conversationWiring.conversationComposer
                              ?.mentionSource
                          }
                        />
                      </>
                    )}
                    {ownDraftActive ? null : (
                      <RiskFlagModals flagsById={model.flagsById} />
                    )}
                    {ownDraftActive &&
                    markReady.available &&
                    (model.flags.length > 0 ||
                      markReady.unpostedDraftCount > 0) ? (
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
                        jumpToChunk={jumpToChunkUnderStack}
                        open={focusPanel.open}
                        sheet={focusPanel.sheet}
                        setOpen={focusPanel.setOpen}
                      />
                    ) : null}
                    {session.focusMode ? <FocusShortcuts /> : null}
                    <Toast message={toast} testId="brief-toast" />
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
                </ChunkLayoutProvider>
              </FileRowsProvider>
            </ExpansionProvider>
          </ExpansionSourceProvider>
        </TokenPlanProvider>
      </ReviewPostureProvider>
    </ReviewFlowProvider>
  );
}
