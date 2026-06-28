import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Drawer } from "../components/Drawer/Drawer";
import { Markdown } from "../components/Markdown/Markdown";
import { ConcernView } from "../features/brief/components/ConcernView/ConcernView";
import { DeltaContext } from "../features/brief/components/DeltaContext/DeltaContext";
import { DemoControls } from "../features/brief/components/DemoControls/DemoControls";
import { Footer } from "../features/brief/components/Footer/Footer";
import { Header } from "../features/brief/components/Header/Header";
import { StoryView } from "../features/brief/components/StoryView/StoryView";
import {
  Toolbar,
  type LayoutMode,
  type ViewMode,
} from "../features/brief/components/Toolbar/Toolbar";
import { summarizeProgress } from "../features/brief/progress";
import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localRevisionChangesQueryOptions,
} from "../features/brief/queries";
import { buildChunkRevisionView } from "../features/brief/revisionChanges";
import type { RevisionOverlayState } from "../features/brief/revisionOverlay";
import { buildBriefTimeline } from "../features/brief/timeline";
import type { Brief, LocalBriefSummary } from "../features/brief/types";
import {
  buildBriefViewModel,
  type RiskFlag,
} from "../features/brief/viewModel";
import { useRevisionNavigation } from "../features/brief/useRevisionNavigation";
import { useLocalPreference } from "../hooks/useLocalPreference";
import { useScrollSpy } from "../hooks/useScrollSpy";
import {
  DismissModal,
  type DismissTarget,
} from "../features/review/components/DismissModal/DismissModal";
import {
  EvidenceModal,
  type EvidenceTarget,
} from "../features/review/components/EvidenceModal/EvidenceModal";
import { PreSubmitModal } from "../features/review/components/PreSubmitModal/PreSubmitModal";
import { ReceiptDrawer } from "../features/review/components/ReceiptDrawer/ReceiptDrawer";
import { SummaryPreview } from "../features/review/components/SummaryPreview/SummaryPreview";
import type { CommentAnchor } from "../features/review/comments";
import { buildReceipt } from "../features/review/receipt";
import {
  clearSnapshots,
  MindMapProvider,
  serializeSnapshot,
  useMindMap,
  useMindMapActions,
  type SessionSnapshot,
} from "../features/review/session";
import {
  deriveUnresolvedItems,
  type ReviewMode,
  type ReviewOutcome,
  type RiskEvidence,
} from "../features/review/state";

export const Route = createFileRoute("/briefs/$briefId")({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        localBriefQueryOptions(params.briefId),
      ),
      context.queryClient.ensureQueryData(localBriefsQueryOptions()),
      context.queryClient.ensureQueryData(
        localRevisionChangesQueryOptions(params.briefId),
      ),
    ]),
  component: BriefRoute,
  errorComponent: BriefError,
});

function BriefRoute() {
  const { briefId } = Route.useParams();
  const artifacts = useSuspenseQuery(localBriefsQueryOptions()).data;
  return <BriefApp artifacts={artifacts} briefId={briefId} key={briefId} />;
}

function BriefApp({
  artifacts,
  briefId,
}: {
  artifacts: LocalBriefSummary[];
  briefId: string;
}) {
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  const model = useMemo(() => buildBriefViewModel(brief), [brief]);
  return (
    <MindMapProvider briefId={briefId} model={model}>
      <BriefScreen
        artifacts={artifacts}
        brief={brief}
        briefId={briefId}
        model={model}
      />
    </MindMapProvider>
  );
}

function BriefScreen({
  artifacts,
  brief,
  briefId,
  model,
}: {
  artifacts: LocalBriefSummary[];
  brief: Brief;
  briefId: string;
  model: ReturnType<typeof buildBriefViewModel>;
}) {
  const timeline = useMemo(
    () => buildBriefTimeline(artifacts, briefId),
    [artifacts, briefId],
  );

  // Revision-changes overlay (ADR 0021): the shared, per-revision marks plus the
  // opportunistic (prevHead,head) delta for callout text.
  const revisionChanges = useSuspenseQuery(
    localRevisionChangesQueryOptions(briefId),
  ).data;
  const revisionAvailable =
    brief.artifactKind === "brief" &&
    Boolean(revisionChanges && revisionChanges.files.length > 0);
  const [revisionEnabled, setRevisionEnabled] = useLocalPreference(
    "revision-changes-overlay",
    true,
  );
  const revisionDeltaId = useMemo(
    () =>
      revisionChanges
        ? artifacts.find(
            (artifact) =>
              artifact.artifactKind === "delta" &&
              artifact.baselineSha === revisionChanges.prevHeadSha &&
              artifact.headSha === revisionChanges.headSha,
          )?.id
        : undefined,
    [artifacts, revisionChanges],
  );
  const revisionDelta =
    useQuery({
      ...localBriefQueryOptions(revisionDeltaId ?? ""),
      enabled: revisionAvailable && revisionEnabled && Boolean(revisionDeltaId),
    }).data ?? null;
  const effectiveRevisionChanges =
    revisionAvailable && revisionEnabled ? revisionChanges : null;
  const revisionRunCount = useMemo(
    () =>
      effectiveRevisionChanges
        ? brief.chunks.reduce(
            (total, chunk) =>
              total +
              buildChunkRevisionView(chunk, effectiveRevisionChanges).runs
                .length,
            0,
          )
        : 0,
    [brief.chunks, effectiveRevisionChanges],
  );
  const revision: RevisionOverlayState = {
    changes: effectiveRevisionChanges,
    delta: revisionDelta,
    available: revisionAvailable,
    enabled: revisionEnabled,
    runCount: revisionRunCount,
    setEnabled: setRevisionEnabled,
  };

  // Session/domain state lives in the per-brief Mind-Map store (ADR 0022).
  const dispositions = useMindMap((state) => state.dispositions);
  const dominants = useMindMap((state) => state.dominants);
  const reclassifiedGroups = useMindMap((state) => state.reclassifiedGroups);
  const reviewedChunks = useMindMap((state) => state.reviewedChunks);
  const checkedItems = useMindMap((state) => state.checkedItems);
  const reviewComments = useMindMap((state) => state.reviewComments);
  const reviewOutcome = useMindMap((state) => state.reviewOutcome);
  const actions = useMindMapActions();

  // Transient UI state stays local and colocated.
  const [reviewMode, setReviewMode] = useState<ReviewMode>("reviewer");
  const [viewMode, setViewMode] = useState<ViewMode>("story");
  const [layoutMode] = useState<LayoutMode>("split");
  const [collapseSupporting, setCollapseSupporting] = useState(true);
  const [openChunks, setOpenChunks] = useState<Set<string>>(
    () =>
      new Set(
        model.groups.flatMap((group) =>
          group.carrierChunks.map((chunk) => chunk.id),
        ),
      ),
  );
  const [selectedRiskFlags, setSelectedRiskFlags] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [summaryPreviewOpen, setSummaryPreviewOpen] = useState(false);
  const [preSubmitOpen, setPreSubmitOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<DismissTarget | null>(
    null,
  );
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(
    null,
  );
  const [dismissReason, setDismissReason] = useState("");
  const [dismissWarned, setDismissWarned] = useState(false);
  const [activeCommentAnchor, setActiveCommentAnchor] =
    useState<CommentAnchor | null>(null);
  const [toast, setToast] = useState("");

  const totals = useMemo(
    () => summarizeProgress(model, reviewedChunks, dispositions),
    [dispositions, model, reviewedChunks],
  );
  const totalWork = model.flags.length + brief.chunks.length;
  const progress =
    totalWork === 0
      ? 0
      : ((totals.reviewed + totals.flagsResolved) / totalWork) * 100;
  const unresolvedItems = useMemo(
    () =>
      deriveUnresolvedItems({
        chunks: brief.chunks,
        flags: model.flags,
        dispositions,
        reviewedChunkIds: reviewedChunks,
        comments: reviewComments,
      }),
    [brief.chunks, dispositions, model.flags, reviewComments, reviewedChunks],
  );
  // Frozen snapshot + Receipt: the inputs the drawer and summary preview render.
  const snapshot = useMemo(
    () =>
      serializeSnapshot(briefId, {
        dispositions,
        dominants,
        reclassifiedGroups,
        reviewedChunks,
        checkedItems,
        reviewComments,
        reviewOutcome,
      }),
    [
      briefId,
      checkedItems,
      dispositions,
      dominants,
      reclassifiedGroups,
      reviewComments,
      reviewOutcome,
      reviewedChunks,
    ],
  );
  const receipt = useMemo(
    () => buildReceipt(snapshot, brief, model),
    [snapshot, brief, model],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.getElementById("brief-content")?.focus();
  }, [briefId]);

  // activeChunkId has two write sources: scroll-spy (below) and explicit nav
  // (toggleChunk/jumpToChunk). Scroll-spy only runs in the split story view.
  const scrollActiveChunkId = useScrollSpy(
    viewMode === "story" && layoutMode === "split"
      ? brief.chunks.map((chunk) => chunk.id)
      : [],
  );
  useEffect(() => {
    if (scrollActiveChunkId) setActiveChunkId(scrollActiveChunkId);
  }, [scrollActiveChunkId]);

  function toggleChunk(chunkId: string) {
    setOpenChunks((current) => {
      const next = new Set(current);
      if (next.has(chunkId)) next.delete(chunkId);
      else next.add(chunkId);
      return next;
    });
    setActiveChunkId(chunkId);
  }

  function markReviewed(chunkId: string) {
    // reviewChunk is a pure store toggle; the collapse-on-review coupling lives
    // here because openChunks is local UI — drop the chunk from it explicitly.
    actions.reviewChunk(chunkId);
    setOpenChunks((current) => {
      const next = new Set(current);
      next.delete(chunkId);
      return next;
    });
  }

  function jumpToChunk(chunkId: string) {
    setViewMode("story");
    setOpenChunks((current) => new Set(current).add(chunkId));
    setActiveChunkId(chunkId);
    window.setTimeout(
      () =>
        document
          .getElementById(chunkId)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }

  function clearSelection(flagIds: string[]) {
    setSelectedRiskFlags((current) => {
      const next = new Set(current);
      for (const flagId of flagIds) next.delete(flagId);
      return next;
    });
  }

  function toggleRiskFlag(flagId: string) {
    setSelectedRiskFlags((current) => {
      const next = new Set(current);
      if (next.has(flagId)) next.delete(flagId);
      else next.add(flagId);
      return next;
    });
  }

  function toggleRiskGroup(flagIds: string[]) {
    setSelectedRiskFlags((current) => {
      const allSelected =
        flagIds.length > 0 && flagIds.every((flagId) => current.has(flagId));
      const next = new Set(current);
      for (const flagId of flagIds) {
        if (allSelected) next.delete(flagId);
        else next.add(flagId);
      }
      return next;
    });
  }

  function addressWithEvidence(
    flagIds: string[],
    evidenceForFlag: (flag: RiskFlag) => RiskEvidence,
  ) {
    const flagsById = new Map(model.flags.map((flag) => [flag.id, flag]));
    const presentIds = flagIds.filter((flagId) => flagsById.has(flagId));
    if (presentIds.length === 0) return;
    actions.addressFlags(presentIds, (flagId) =>
      evidenceForFlag(flagsById.get(flagId)!),
    );
    clearSelection(presentIds);
    setToast(
      presentIds.length === 1
        ? "Risk marked addressed with evidence."
        : `${presentIds.length} risks marked addressed with evidence.`,
    );
  }

  function confirmDismiss() {
    if (!dismissTarget) return;
    const reason = dismissReason.trim();
    if (reason.length < 12 && !dismissWarned) {
      setDismissWarned(true);
      return;
    }
    actions.disposeFlag(dismissTarget.flagIds, {
      kind: "dismissed",
      reason: reason || "(no reason given)",
    });
    clearSelection(dismissTarget.flagIds);
    const dismissedCount = dismissTarget.flagIds.length;
    setDismissTarget(null);
    setDismissReason("");
    setDismissWarned(false);
    setToast(
      dismissedCount === 1
        ? "Dismissed. Reason recorded verbatim on the receipt."
        : `${dismissedCount} flags dismissed. Reason recorded verbatim on the receipt.`,
    );
  }

  function saveReviewComment(anchor: CommentAnchor, body: string) {
    const trimmed = body.trim();
    if (!trimmed) {
      setToast("Comment cannot be empty.");
      return;
    }
    actions.saveComment({
      id: `${anchor.chunkId}-${anchor.side}-${anchor.startLine}-${anchor.endLine}-${reviewComments.length + 1}`,
      anchor,
      body: trimmed,
      status: "draft",
      collapsed: false,
    });
    setActiveCommentAnchor(null);
    setToast("Draft comment added to this review.");
  }

  function updateReviewComment(commentId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) {
      setToast("Comment cannot be empty.");
      return;
    }
    actions.updateComment(commentId, trimmed);
    setToast("Draft comment updated.");
  }

  function deleteReviewComment(commentId: string) {
    actions.deleteComment(commentId);
    setToast("Draft comment deleted.");
  }

  return (
    <>
      <Header
        brief={brief}
        briefId={briefId}
        timeline={timeline}
        model={model}
        totals={totals}
        progress={progress}
        locOpen={locOpen}
        reviewMode={reviewMode}
        setLocOpen={setLocOpen}
        openReceipt={() => setPreSubmitOpen(true)}
        clearDrafts={clearSnapshots}
      />
      <main
        className={
          layoutMode === "split" && viewMode === "story"
            ? "main split-main"
            : "main"
        }
        id="brief-content"
        tabIndex={-1}
      >
        <section className="pr-summary reveal">
          <div className="eyebrow">
            {brief.artifactKind === "delta"
              ? "Delta brief"
              : reviewMode === "author"
                ? "Author self-review"
                : "Brief"}
          </div>
          <Markdown content={brief.summary} />
          {brief.artifactKind === "delta" ? (
            <DeltaContext brief={brief} />
          ) : null}
          <button
            className="description-toggle"
            type="button"
            onClick={() => setDescriptionOpen(!descriptionOpen)}
          >
            {descriptionOpen
              ? "Hide original PR description"
              : "Show original PR description"}
          </button>
          {descriptionOpen ? (
            <div className="pr-description">
              <div className="eyebrow">Original PR description</div>
              <Markdown
                content={
                  brief.pr.description || "_No PR description provided._"
                }
              />
            </div>
          ) : null}
        </section>

        <DemoControls reviewMode={reviewMode} setReviewMode={setReviewMode} />

        <Toolbar viewMode={viewMode} setViewMode={setViewMode} />

        {viewMode === "story" ? (
          <StoryView
            brief={brief}
            model={model}
            revision={revision}
            activeChunkId={activeChunkId}
            collapseSupporting={collapseSupporting}
            openChunks={openChunks}
            selectedRiskFlags={selectedRiskFlags}
            activeCommentAnchor={activeCommentAnchor}
            cancelCommentComposer={() => setActiveCommentAnchor(null)}
            deleteReviewComment={deleteReviewComment}
            jumpToChunk={jumpToChunk}
            markReviewed={markReviewed}
            openCommentComposer={setActiveCommentAnchor}
            saveReviewComment={saveReviewComment}
            setCollapseSupporting={setCollapseSupporting}
            setDismissTarget={(target) => {
              setDismissTarget(target);
              setDismissReason("");
              setDismissWarned(false);
            }}
            setEvidenceTarget={setEvidenceTarget}
            setToast={setToast}
            toggleChunk={toggleChunk}
            toggleRiskFlag={toggleRiskFlag}
            toggleRiskGroup={toggleRiskGroup}
            toggleReviewComment={actions.toggleComment}
            updateReviewComment={updateReviewComment}
          />
        ) : (
          <ConcernView brief={brief} model={model} jumpToChunk={jumpToChunk} />
        )}
      </main>
      <Footer />
      <ReceiptDrawer
        receipt={receipt}
        reviewMode={reviewMode}
        open={receiptOpen}
        close={() => setReceiptOpen(false)}
        openSummaryPreview={() => setSummaryPreviewOpen(true)}
        submit={() => {
          setReceiptOpen(false);
          setToast(
            reviewMode === "author"
              ? "Mockup flow — this would mark the PR ready for review after self-review."
              : "Mockup flow — submit posts your review natively to GitHub with one signature line linking this receipt.",
          );
        }}
      />
      <SummaryPreviewDrawer
        brief={brief}
        mode={reviewMode}
        open={summaryPreviewOpen}
        snapshot={snapshot}
        close={() => setSummaryPreviewOpen(false)}
        setOutcome={actions.setOutcome}
      />
      <PreSubmitModal
        mode={reviewMode}
        open={preSubmitOpen}
        unresolvedItems={unresolvedItems}
        close={() => setPreSubmitOpen(false)}
        continueToReceipt={() => {
          setPreSubmitOpen(false);
          setReceiptOpen(true);
        }}
        jumpToItem={(item) => {
          setPreSubmitOpen(false);
          jumpToChunk(item.targetId);
        }}
      />
      <DismissModal
        target={dismissTarget}
        reason={dismissReason}
        warned={dismissWarned}
        cancel={() => setDismissTarget(null)}
        confirm={confirmDismiss}
        setReason={setDismissReason}
      />
      <EvidenceModal
        chunks={brief.chunks}
        comments={reviewComments}
        target={evidenceTarget}
        cancel={() => setEvidenceTarget(null)}
        confirm={(kind, commentId, note) => {
          if (!evidenceTarget) return;
          addressWithEvidence(evidenceTarget.flagIds, (flag) => {
            if (kind === "linked-comment")
              return commentId
                ? { kind, commentId }
                : { kind: "chunk-reviewed", chunkId: flag.chunkId };
            if (kind === "chunk-reviewed")
              return { kind, chunkId: flag.chunkId };
            return note ? { kind, note } : { kind };
          });
          setEvidenceTarget(null);
        }}
      />
      <div className={toast ? "toast show" : "toast"}>{toast}</div>
    </>
  );
}

function SummaryPreviewDrawer({
  brief,
  close,
  mode,
  open,
  setOutcome,
  snapshot,
}: {
  brief: Brief;
  close: () => void;
  mode: ReviewMode;
  open: boolean;
  setOutcome: (outcome: ReviewOutcome) => void;
  snapshot: SessionSnapshot;
}) {
  return (
    <Drawer
      open={open}
      closeLabel="Close summary preview"
      close={close}
      asideClassName="receipt summary-drawer"
    >
      <SummaryPreview
        brief={brief}
        mode={mode}
        snapshot={snapshot}
        setOutcome={setOutcome}
      />
    </Drawer>
  );
}

function BriefError({ error }: { error: Error }) {
  return (
    <main className="main">
      <section className="error-state">
        <h1>Brief failed to load</h1>
        <p>{error.message}</p>
      </section>
    </main>
  );
}
