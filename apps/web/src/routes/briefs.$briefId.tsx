import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Markdown } from "../components/Markdown/Markdown";
import { DeltaCallout } from "../features/brief/components/DeltaCallout/DeltaCallout";
import { ConcernView } from "../features/brief/components/ConcernView/ConcernView";
import { DemoControls } from "../features/brief/components/DemoControls/DemoControls";
import { Footer } from "../features/brief/components/Footer/Footer";
import { Header } from "../features/brief/components/Header/Header";
import {
  Toolbar,
  type LayoutMode,
  type ViewMode,
} from "../features/brief/components/Toolbar/Toolbar";
import {
  summarizeProgress,
  type CheckBucket,
} from "../features/brief/progress";
import { toggleSet, rangeBetween } from "../lib/collections";
import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localRevisionChangesQueryOptions,
} from "../features/brief/queries";
import {
  reviewCommentMatchesDiffLine,
  reviewCommentsForChunk,
} from "../features/brief/reviewComments";
import {
  bindCallout,
  buildChunkRevisionView,
  type ChunkRevisionView,
  type RevisionRun,
} from "../features/brief/revisionChanges";
import type {
  AddressedReviewComment,
  Brief,
  BriefChunk,
  Category,
  Concern,
  LocalBriefSummary,
  RevisionChanges,
} from "../features/brief/types";
import {
  buildBriefTimeline,
  type BriefTimeline,
} from "../features/brief/timeline";
import {
  buildBriefViewModel,
  groupRiskByAttribute,
  type BriefViewModel,
  type GroupView,
  type RiskFlag,
} from "../features/brief/viewModel";
import { SummaryPreview } from "../features/review/SummaryPreview";
import {
  applyMarkdownWrap,
  buildSuggestionDiffRows,
  commentAnchorLabel,
  createCommentAnchor,
  parseSuggestionBlocks,
  replaceSelectionWithSuggestion,
  reviewCommentSubmitLabel,
  rowId,
  stripSuggestionBlocks,
  type CommentAnchor,
  type ReviewComment,
} from "../features/review/comments";
import {
  clearSnapshots,
  MindMapProvider,
  serializeSnapshot,
  useMindMap,
  useMindMapActions,
  type SessionSnapshot,
} from "../features/review/session";
import {
  commentLocation,
  deriveUnresolvedItems,
  riskEvidenceLabel,
  type FlagState,
  type FlagStatus,
  type ReviewMode,
  type ReviewOutcome,
  type RiskEvidence,
  type RiskEvidenceKind,
  type UnresolvedItem,
} from "../features/review/state";

type ComposerMode = "write" | "preview";

interface DismissTarget {
  flagIds: string[];
  label: string;
}

interface EvidenceTarget {
  flagIds: string[];
  label: string;
}

interface RevisionOverlayState {
  /** The sidecar to paint, or null when the overlay is unavailable or toggled off. */
  changes: RevisionChanges | null;
  /** The opportunistic (prevHead,head) delta for callout summaries, if loaded. */
  delta: Brief | null;
  available: boolean;
  enabled: boolean;
  /** Total runs across the brief — the jump-nav count. */
  runCount: number;
  setEnabled: (enabled: boolean) => void;
}

/**
 * Move focus to the next/prev rendered revision-change rail relative to the
 * reading line, wrapping at the ends. DOM-driven so it naturally steps only the
 * runs that are actually visible; focus carries the rail's accessible name.
 */
function jumpToRevisionChange(direction: 1 | -1): void {
  const rails = [
    ...document.querySelectorAll<HTMLButtonElement>("main .diff .railbtn"),
  ];
  if (rails.length === 0) return;
  const readingLine = window.scrollY + 160;
  const top = (rail: HTMLButtonElement): number =>
    rail.getBoundingClientRect().top + window.scrollY;
  const target =
    direction === 1
      ? (rails.find((rail) => top(rail) > readingLine + 1) ?? rails[0])
      : ([...rails].reverse().find((rail) => top(rail) < readingLine - 1) ??
        rails[rails.length - 1]);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus();
}

const REVISION_PREF_KEY = "revision-changes-overlay";

function readRevisionPref(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(REVISION_PREF_KEY) !== "off";
}

function writeRevisionPref(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REVISION_PREF_KEY, enabled ? "on" : "off");
}

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
  model: BriefViewModel;
}) {
  const timeline = useMemo(
    () => buildBriefTimeline(artifacts, briefId),
    [artifacts, briefId],
  );

  // Revision-changes overlay (ADR 0021): the shared, per-revision marks for this
  // full brief, plus the opportunistic (prevHead,head) delta for callout text.
  const revisionChanges = useSuspenseQuery(
    localRevisionChangesQueryOptions(briefId),
  ).data;
  const revisionAvailable =
    brief.artifactKind === "brief" &&
    Boolean(revisionChanges && revisionChanges.files.length > 0);
  // Default-on; the stored preference is applied after hydration (browser-only).
  const [revisionEnabled, setRevisionEnabled] = useState(true);
  useEffect(() => setRevisionEnabled(readRevisionPref()), []);
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
    setEnabled: (next) => {
      setRevisionEnabled(next);
      writeRevisionPref(next);
    },
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

  // Legacy projections of the Disposition union back into the flagStates /
  // riskEvidence shapes the child tree still consumes. These collapse in Slice B
  // when children read the store via selectors directly.
  const flagStates = useMemo<Record<string, FlagState>>(() => {
    const projected: Record<string, FlagState> = {};
    for (const [flagId, disposition] of Object.entries(dispositions)) {
      projected[flagId] =
        disposition.kind === "dismissed"
          ? { status: "dismissed", reason: disposition.reason }
          : disposition.kind === "addressed"
            ? { status: "addressed", reason: "" }
            : { status: "open", reason: "" };
    }
    return projected;
  }, [dispositions]);
  const riskEvidence = useMemo<Record<string, RiskEvidence>>(() => {
    const projected: Record<string, RiskEvidence> = {};
    for (const [flagId, disposition] of Object.entries(dispositions)) {
      if (disposition.kind === "addressed" && disposition.evidence) {
        projected[flagId] = disposition.evidence;
      }
    }
    return projected;
  }, [dispositions]);

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
    () =>
      summarizeProgress(
        model,
        checkedItems,
        reviewedChunks,
        flagStates,
        dominants,
      ),
    [checkedItems, dominants, flagStates, model, reviewedChunks],
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.getElementById("brief-content")?.focus();
  }, [briefId]);

  useEffect(() => {
    if (viewMode !== "story" || layoutMode !== "split") return;
    const updateActive = () => {
      const readingLine = 150;
      const current = brief.chunks.find((chunk) => {
        const element = document.getElementById(chunk.id);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.top <= readingLine && rect.bottom > readingLine;
      });
      if (current) setActiveChunkId(current.id);
    };
    window.addEventListener("scroll", updateActive, { passive: true });
    updateActive();
    return () => window.removeEventListener("scroll", updateActive);
  }, [brief.chunks, layoutMode, viewMode]);

  function toggleCheck(bucket: CheckBucket, index: number) {
    actions.checkPlaybookItem(bucket, index);
  }

  function toggleChunk(chunkId: string) {
    setOpenChunks((current) => toggleSet(current, chunkId));
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

  function chooseDominant(groupId: string, category: Category) {
    // The store resets carrier:${groupId} checks inside reclassifyGroup.
    actions.reclassifyGroup(groupId, category);
    setToast(`Dominant category set to ${category} — recorded on the receipt.`);
  }

  function clearSelection(flagIds: string[]) {
    setSelectedRiskFlags((current) => {
      const next = new Set(current);
      for (const flagId of flagIds) next.delete(flagId);
      return next;
    });
  }

  function setFlagStatus(flag: RiskFlag, status: FlagStatus, reason = "") {
    setFlagStatuses([flag.id], status, reason);
  }

  function setFlagStatuses(flagIds: string[], status: FlagStatus, reason = "") {
    if (flagIds.length === 0) return;
    if (status === "addressed") {
      actions.addressFlags(flagIds, () => ({ kind: "manual-note" }));
    } else {
      actions.disposeFlag(
        flagIds,
        status === "dismissed"
          ? { kind: "dismissed", reason }
          : { kind: "open" },
      );
    }
    clearSelection(flagIds);
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

  function toggleRiskFlag(flagId: string) {
    setSelectedRiskFlags((current) => toggleSet(current, flagId));
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

  function openPreSubmit() {
    setPreSubmitOpen(true);
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

  function toggleReviewComment(commentId: string) {
    actions.toggleComment(commentId);
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
        openReceipt={openPreSubmit}
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
            checkedItems={checkedItems}
            collapseSupporting={collapseSupporting}
            dominants={dominants}
            flagStates={flagStates}
            openChunks={openChunks}
            reclassifiedGroups={reclassifiedGroups}
            reviewComments={reviewComments}
            reviewedChunks={reviewedChunks}
            riskEvidence={riskEvidence}
            selectedRiskFlags={selectedRiskFlags}
            activeCommentAnchor={activeCommentAnchor}
            cancelCommentComposer={() => setActiveCommentAnchor(null)}
            chooseDominant={chooseDominant}
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
            setFlagStatus={setFlagStatus}
            setFlagStatuses={setFlagStatuses}
            setToast={setToast}
            toggleCheck={toggleCheck}
            toggleChunk={toggleChunk}
            toggleRiskFlag={toggleRiskFlag}
            toggleRiskGroup={toggleRiskGroup}
            toggleReviewComment={toggleReviewComment}
            updateReviewComment={updateReviewComment}
          />
        ) : (
          <ConcernView brief={brief} model={model} jumpToChunk={jumpToChunk} />
        )}
      </main>
      <Footer />
      <ReceiptDrawer
        brief={brief}
        model={model}
        checkedItems={checkedItems}
        dominants={dominants}
        flagStates={flagStates}
        reviewMode={reviewMode}
        riskEvidence={riskEvidence}
        open={receiptOpen}
        reclassifiedGroups={reclassifiedGroups}
        reviewComments={reviewComments}
        reviewedChunks={reviewedChunks}
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
        snapshot={serializeSnapshot(briefId, {
          dispositions,
          dominants,
          reclassifiedGroups,
          reviewedChunks,
          checkedItems,
          reviewComments,
          reviewOutcome,
        })}
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

function DeltaContext({ brief }: { brief: Brief }) {
  return (
    <div className="delta-context">
      {brief.commentsAddressed ? (
        <section>
          <div className="eyebrow">Comments addressed</div>
          <Markdown content={brief.commentsAddressed} />
        </section>
      ) : null}
      {brief.wholePrImpact ? (
        <section>
          <div className="eyebrow">Whole-PR impact</div>
          <p>{brief.wholePrImpact}</p>
        </section>
      ) : null}
    </div>
  );
}

function StoryView(props: {
  brief: Brief;
  model: BriefViewModel;
  revision: RevisionOverlayState;
  activeChunkId: string | null;
  checkedItems: Record<CheckBucket, Set<number>>;
  collapseSupporting: boolean;
  dominants: Record<string, Category>;
  flagStates: Record<string, FlagState>;
  openChunks: Set<string>;
  reclassifiedGroups: Set<string>;
  reviewComments: ReviewComment[];
  reviewedChunks: Set<string>;
  riskEvidence: Record<string, RiskEvidence>;
  selectedRiskFlags: Set<string>;
  activeCommentAnchor: CommentAnchor | null;
  cancelCommentComposer: () => void;
  chooseDominant: (groupId: string, category: Category) => void;
  deleteReviewComment: (commentId: string) => void;
  jumpToChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  openCommentComposer: (anchor: CommentAnchor) => void;
  saveReviewComment: (anchor: CommentAnchor, body: string) => void;
  setCollapseSupporting: (value: boolean) => void;
  setDismissTarget: (target: DismissTarget) => void;
  setEvidenceTarget: (target: EvidenceTarget) => void;
  setFlagStatus: (flag: RiskFlag, status: FlagStatus, reason?: string) => void;
  setFlagStatuses: (
    flagIds: string[],
    status: FlagStatus,
    reason?: string,
  ) => void;
  setToast: (message: string) => void;
  toggleCheck: (bucket: CheckBucket, index: number) => void;
  toggleChunk: (chunkId: string) => void;
  toggleRiskFlag: (flagId: string) => void;
  toggleRiskGroup: (flagIds: string[]) => void;
  toggleReviewComment: (commentId: string) => void;
  updateReviewComment: (commentId: string, body: string) => void;
}) {
  return (
    <div className="story-view">
      <div className="chunks-label reveal">
        <span>{props.brief.chunks.length} chunks · grouped by intent</span>
        <span className="rule" />
        <label className="switch">
          <input
            checked={props.collapseSupporting}
            suppressHydrationWarning
            type="checkbox"
            onChange={(event) =>
              props.setCollapseSupporting(event.target.checked)
            }
          />
          <span className="track" />
          Collapse supporting
        </label>
        {props.revision.available ? (
          <label
            className="switch revision-switch"
            title="Highlight lines new in this revision (since the previous brief)"
          >
            <input
              checked={props.revision.enabled}
              suppressHydrationWarning
              type="checkbox"
              onChange={(event) =>
                props.revision.setEnabled(event.target.checked)
              }
            />
            <span className="track" />
            Revision changes
          </label>
        ) : null}
        {props.revision.enabled && props.revision.runCount > 0 ? (
          <span
            className="revision-jump"
            role="group"
            aria-label="Jump between revision changes"
          >
            <span className="count">
              {props.revision.runCount} revision change
              {props.revision.runCount === 1 ? "" : "s"}
            </span>
            <button
              aria-label="Previous revision change"
              type="button"
              onClick={() => jumpToRevisionChange(-1)}
            >
              ◂
            </button>
            <button
              aria-label="Next revision change"
              type="button"
              onClick={() => jumpToRevisionChange(1)}
            >
              ▸
            </button>
          </span>
        ) : null}
      </div>
      {props.model.groups.map((group) => (
        <section className="story-group reveal" key={group.id}>
          <div className="group-chunks">
            {group.chunks.map((chunk) => (
              <ChunkCard
                key={chunk.id}
                active={props.activeChunkId === chunk.id}
                chunk={chunk}
                revision={props.revision}
                forceCollapsed={
                  props.collapseSupporting &&
                  chunk.role === "supporting" &&
                  !props.openChunks.has(chunk.id)
                }
                open={props.openChunks.has(chunk.id)}
                reviewed={props.reviewedChunks.has(chunk.id)}
                activeCommentAnchor={
                  props.activeCommentAnchor?.chunkId === chunk.id
                    ? props.activeCommentAnchor
                    : null
                }
                addressedReviewComments={props.brief.reviewComments ?? []}
                cancelCommentComposer={props.cancelCommentComposer}
                comments={props.reviewComments.filter(
                  (comment) => comment.anchor.chunkId === chunk.id,
                )}
                deleteReviewComment={props.deleteReviewComment}
                existingReviewCommentCount={props.reviewComments.length}
                markReviewed={props.markReviewed}
                openCommentComposer={props.openCommentComposer}
                saveReviewComment={props.saveReviewComment}
                toggleChunk={props.toggleChunk}
                toggleReviewComment={props.toggleReviewComment}
                updateReviewComment={props.updateReviewComment}
              />
            ))}
          </div>
          <GroupCard {...props} group={group} />
        </section>
      ))}
    </div>
  );
}

function GroupCard({
  group,
  brief,
  checkedItems,
  dominants,
  flagStates,
  model,
  reclassifiedGroups,
  reviewComments,
  riskEvidence,
  selectedRiskFlags,
  chooseDominant,
  jumpToChunk,
  setDismissTarget,
  setEvidenceTarget,
  setFlagStatus,
  setFlagStatuses,
  setToast,
  toggleCheck,
  toggleRiskFlag,
  toggleRiskGroup,
}: {
  group: GroupView;
  brief: Brief;
  checkedItems: Record<CheckBucket, Set<number>>;
  dominants: Record<string, Category>;
  flagStates: Record<string, FlagState>;
  model: BriefViewModel;
  reclassifiedGroups: Set<string>;
  reviewComments: ReviewComment[];
  riskEvidence: Record<string, RiskEvidence>;
  selectedRiskFlags: Set<string>;
  chooseDominant: (groupId: string, category: Category) => void;
  jumpToChunk: (chunkId: string) => void;
  setDismissTarget: (target: DismissTarget) => void;
  setEvidenceTarget: (target: EvidenceTarget) => void;
  setFlagStatus: (flag: RiskFlag, status: FlagStatus, reason?: string) => void;
  setFlagStatuses: (
    flagIds: string[],
    status: FlagStatus,
    reason?: string,
  ) => void;
  setToast: (message: string) => void;
  toggleCheck: (bucket: CheckBucket, index: number) => void;
  toggleRiskFlag: (flagId: string) => void;
  toggleRiskGroup: (flagIds: string[]) => void;
}) {
  const dominant = dominants[group.id] ?? group.group.dominantCategory;
  const groupFlags = model.flags.filter((flag) => flag.groupId === group.id);
  const isReclassified = reclassifiedGroups.has(group.id);

  return (
    <article className="group-card reveal">
      <div className="group-head">
        <div className="group-eyebrow">
          <span className="gnum">
            Change-group {group.index + 1} of {model.groups.length}
          </span>
          <span className="gloc">
            <span className="green">+{group.added}</span> /{" "}
            <span className="red">−{group.deleted}</span> ·{" "}
            {group.carrierChunks.length} carrier ·{" "}
            {group.supportingChunks.length} supporting
          </span>
        </div>
        <h2 className="group-title">{group.group.title}</h2>
        <p className="group-summary">{group.group.summary}</p>
        <div className="cat-row">
          <span className="chip dominant">
            <em>dominant</em> {dominant}
          </span>
          {group.group.secondaryCategories.map((category) => (
            <span className="chip" key={category}>
              secondary {category}
            </span>
          ))}
          {group.group.uncertain && !isReclassified ? (
            <span className="chip uncertain">uncertain</span>
          ) : null}
          {isReclassified ? (
            <span className="reclass-note">
              set by you · recorded on receipt
            </span>
          ) : null}
        </div>
        {group.group.uncertain && !isReclassified ? (
          <div className="uncertain-panel">
            <span className="q">
              The categorizer is split on this group’s intent:{" "}
              <b>{group.group.uncertainBetween.join(" vs ")}</b>. Your call; the
              receipt records the override.
            </span>
            <span className="pick">
              {group.group.uncertainBetween.map((category) => (
                <button
                  className="pickbtn"
                  key={category}
                  type="button"
                  onClick={() => chooseDominant(group.id, category)}
                >
                  {category}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </div>
      <div className="group-body">
        <div className="flags">
          <div className="label risk-label">
            <span>
              Risk surface — {groupFlags.length} flags{" "}
              <span className="count">attributes, not verdicts</span>
            </span>
            <span className="risk-info">
              <button
                aria-describedby={`${group.id}-risk-help`}
                aria-label="Risk surface status meanings"
                className="info-button"
                type="button"
              >
                i
              </button>
              <span
                className="risk-info-popover"
                id={`${group.id}-risk-help`}
                role="tooltip"
              >
                <span>
                  <b>Addressed:</b> this risk was reviewed and handled.
                </span>
                <span>
                  <b>Dismissed:</b> this risk is not applicable, duplicate, or a
                  false positive.
                </span>
              </span>
            </span>
          </div>
          {groupFlags.length === 0 ? (
            <p className="empty">No risk-surface attributes on this group.</p>
          ) : null}
          {groupRiskByAttribute(groupFlags).map((riskGroup) => {
            const openRiskFlagIds = riskGroup.flags
              .filter(
                (flag) => (flagStates[flag.id]?.status ?? "open") === "open",
              )
              .map((flag) => flag.id);
            const selectedCount = openRiskFlagIds.filter((flagId) =>
              selectedRiskFlags.has(flagId),
            ).length;
            const allSelected =
              openRiskFlagIds.length > 0 &&
              selectedCount === openRiskFlagIds.length;
            const hasSelection = selectedCount > 0;
            return (
              <div className="risk-group" key={riskGroup.attr}>
                <div className="risk-group-head">
                  <label className="risk-check">
                    <input
                      checked={allSelected}
                      disabled={openRiskFlagIds.length === 0}
                      suppressHydrationWarning
                      type="checkbox"
                      onChange={() => toggleRiskGroup(openRiskFlagIds)}
                    />
                    <span className="risk-group-title">{riskGroup.attr}</span>
                  </label>
                  <div className="risk-bulk-actions">
                    <button
                      className="fbtn"
                      disabled={!hasSelection}
                      title="Mark selected risks as reviewed and handled"
                      type="button"
                      onClick={() => {
                        setEvidenceTarget({
                          flagIds: openRiskFlagIds.filter((flagId) =>
                            selectedRiskFlags.has(flagId),
                          ),
                          label: `${selectedCount} ${selectedCount === 1 ? "flag" : "flags"} in ${riskGroup.attr}`,
                        });
                      }}
                    >
                      Address selected
                    </button>
                    <button
                      className="fbtn"
                      disabled={!hasSelection}
                      title="Mark selected risks as not applicable"
                      type="button"
                      onClick={() => {
                        setDismissTarget({
                          flagIds: openRiskFlagIds.filter((flagId) =>
                            selectedRiskFlags.has(flagId),
                          ),
                          label: `${selectedCount} ${selectedCount === 1 ? "flag" : "flags"} in ${riskGroup.attr}`,
                        });
                      }}
                    >
                      Dismiss selected…
                    </button>
                  </div>
                </div>
                <div className="risk-files">
                  {riskGroup.flags.map((flag) => {
                    const state = flagStates[flag.id] ?? {
                      status: "open",
                      reason: "",
                    };
                    const isResolved = state.status !== "open";
                    return (
                      <div
                        className={`flag ${isResolved ? `resolved ${state.status}` : ""}`}
                        key={flag.id}
                      >
                        <div className="frow">
                          <input
                            aria-label={`Select ${flag.attr} flag for ${flag.file}`}
                            checked={
                              !isResolved && selectedRiskFlags.has(flag.id)
                            }
                            className="flag-check"
                            disabled={isResolved}
                            suppressHydrationWarning
                            type="checkbox"
                            onChange={() => toggleRiskFlag(flag.id)}
                          />
                          <button
                            className="floc full-path"
                            type="button"
                            onClick={() => jumpToChunk(flag.chunkId)}
                          >
                            {flag.file}
                          </button>
                          {isResolved ? (
                            <span className="fstate compact">
                              {state.status}
                            </span>
                          ) : null}
                        </div>
                        {!isResolved ? (
                          <>
                            <div className="fdesc">{flag.description}</div>
                            <div className="factions">
                              <button
                                className="fbtn"
                                title="Mark this risk as reviewed and handled"
                                type="button"
                                onClick={() => {
                                  setEvidenceTarget({
                                    flagIds: [flag.id],
                                    label: `${flag.attr} @ ${flag.file}`,
                                  });
                                }}
                              >
                                Addressed
                              </button>
                              <button
                                className="fbtn"
                                title="Mark this risk as not applicable"
                                type="button"
                                onClick={() =>
                                  setDismissTarget({
                                    flagIds: [flag.id],
                                    label: `${flag.attr} @ ${flag.file}`,
                                  })
                                }
                              >
                                Dismiss…
                              </button>
                            </div>
                          </>
                        ) : state.status === "addressed" ? (
                          <div className="fstate-detail">
                            {evidenceTextForFlag(
                              flag.id,
                              riskEvidence,
                              reviewComments,
                              brief.chunks,
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function ChunkCard({
  chunk,
  revision,
  active,
  open,
  reviewed,
  forceCollapsed,
  activeCommentAnchor,
  addressedReviewComments,
  cancelCommentComposer,
  comments,
  deleteReviewComment,
  existingReviewCommentCount,
  toggleChunk,
  markReviewed,
  openCommentComposer,
  saveReviewComment,
  toggleReviewComment,
  updateReviewComment,
}: {
  chunk: BriefChunk;
  revision: RevisionOverlayState;
  active: boolean;
  open: boolean;
  reviewed: boolean;
  forceCollapsed: boolean;
  activeCommentAnchor: CommentAnchor | null;
  addressedReviewComments: AddressedReviewComment[];
  cancelCommentComposer: () => void;
  comments: ReviewComment[];
  deleteReviewComment: (commentId: string) => void;
  existingReviewCommentCount: number;
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  openCommentComposer: (anchor: CommentAnchor) => void;
  saveReviewComment: (anchor: CommentAnchor, body: string) => void;
  toggleReviewComment: (commentId: string) => void;
  updateReviewComment: (commentId: string, body: string) => void;
}) {
  const expanded = open && !forceCollapsed;
  const revisionView = useMemo(
    () => buildChunkRevisionView(chunk, revision.changes),
    [chunk, revision.changes],
  );
  const chunkReviewComments = reviewCommentsForChunk(
    addressedReviewComments,
    chunk,
  );
  const hasLinkedAddressedComments = Boolean(chunk.addressesComments?.length);
  const topReviewComments = hasLinkedAddressedComments
    ? chunkReviewComments
    : chunkReviewComments.filter(
        (comment) => comment.outdated || comment.line == null,
      );
  const inlineReviewComments = hasLinkedAddressedComments
    ? chunkReviewComments
    : chunkReviewComments.filter(
        (comment) => !comment.outdated && comment.line != null,
      );
  return (
    <article
      className={`chunk ${expanded ? "open" : ""} ${reviewed ? "reviewed" : ""} ${active ? "current" : ""}`}
      id={chunk.id}
    >
      <button
        className="chunk-head"
        type="button"
        onClick={() => toggleChunk(chunk.id)}
      >
        <span className="tw">▶</span>
        <span className="cfile">{chunk.file}</span>
        <span className="cchips">
          {chunk.riskSurface.map((risk) => (
            <span className="cc risk" key={risk}>
              {risk}
            </span>
          ))}
          <span className={`cc concern-${chunk.concern}`}>
            <span className="dot" />
            {chunk.concern}
            {chunk.role === "carrier" ? " · carrier" : ""}
          </span>
          {comments.length > 0 ? (
            <span className="cc comments">
              {comments.length} comment{comments.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {chunkReviewComments.length > 0 ? (
            <span className="cc comments">
              {chunkReviewComments.length}{" "}
              {hasLinkedAddressedComments ? "addressed" : "review"}
            </span>
          ) : null}
          <span className="cc loc">
            <span className="a">+{chunk.loc.added}</span>{" "}
            <span className="d">−{chunk.loc.deleted}</span>
          </span>
        </span>
      </button>
      <div className="chunk-actions">
        <button
          className="markbtn"
          type="button"
          onClick={() => markReviewed(chunk.id)}
        >
          {reviewed ? "Reviewed ✓" : "Mark reviewed"}
        </button>
      </div>
      {!expanded ? (
        <div className="collapse-note">
          {chunk.role === "supporting"
            ? "supporting chunk — collapsed"
            : "collapsed"}
          {comments.length > 0
            ? ` · ${comments.length} draft comment${comments.length === 1 ? "" : "s"}`
            : ""}
        </div>
      ) : null}
      {expanded ? (
        <div className="chunk-body">
          {chunk.summary ||
          chunk.addressesComments?.length ||
          topReviewComments.length > 0 ? (
            <div className="chunk-delta-summary">
              {chunk.summary ? <p>{chunk.summary}</p> : null}
              {chunk.addressesComments?.length ? (
                <AddressedComments chunk={chunk} comments={topReviewComments} />
              ) : null}
              {!chunk.addressesComments?.length &&
              topReviewComments.length > 0 ? (
                <ReviewComments
                  comments={topReviewComments}
                  label="review comment"
                />
              ) : null}
            </div>
          ) : null}
          <DiffTable
            activeCommentAnchor={activeCommentAnchor}
            addressedComments={inlineReviewComments}
            cancelCommentComposer={cancelCommentComposer}
            chunk={chunk}
            revisionView={revisionView}
            revisionDelta={revision.delta}
            comments={comments}
            deleteReviewComment={deleteReviewComment}
            existingReviewCommentCount={existingReviewCommentCount}
            openCommentComposer={openCommentComposer}
            reviewCommentLabel={
              hasLinkedAddressedComments ? "addressed" : "review comment"
            }
            saveReviewComment={saveReviewComment}
            toggleReviewComment={toggleReviewComment}
            updateReviewComment={updateReviewComment}
          />
        </div>
      ) : null}
    </article>
  );
}

function AddressedComments({
  chunk,
  comments,
}: {
  chunk: BriefChunk;
  comments: AddressedReviewComment[];
}) {
  const ids = chunk.addressesComments ?? [];
  if (ids.length === 0) return null;
  if (comments.length === 0) {
    return <span>addresses comments {ids.join(", ")}</span>;
  }
  return <ReviewComments comments={comments} label="comment" />;
}

function ReviewComments({
  comments,
  label,
}: {
  comments: AddressedReviewComment[];
  label: string;
}) {
  return (
    <div className="addressed-comments">
      {comments.map((comment) => (
        <details className="addressed-comment" key={comment.id}>
          <summary>
            <span>@{comment.author}</span>
            <b>
              {comment.file}
              {addressedCommentRange(comment)}
            </b>
            <em>
              {label} {comment.id}
            </em>
          </summary>
          <Markdown content={comment.body} />
          {comment.inReplyToId ? (
            <div className="reply-note">reply to {comment.inReplyToId}</div>
          ) : null}
        </details>
      ))}
    </div>
  );
}

function DiffTable({
  chunk,
  revisionView,
  revisionDelta,
  activeCommentAnchor,
  addressedComments,
  cancelCommentComposer,
  comments,
  deleteReviewComment,
  existingReviewCommentCount,
  openCommentComposer,
  reviewCommentLabel,
  saveReviewComment,
  toggleReviewComment,
  updateReviewComment,
}: {
  chunk: BriefChunk;
  revisionView: ChunkRevisionView;
  revisionDelta: Brief | null;
  activeCommentAnchor: CommentAnchor | null;
  addressedComments: AddressedReviewComment[];
  cancelCommentComposer: () => void;
  comments: ReviewComment[];
  deleteReviewComment: (commentId: string) => void;
  existingReviewCommentCount: number;
  openCommentComposer: (anchor: CommentAnchor) => void;
  reviewCommentLabel: string;
  saveReviewComment: (anchor: CommentAnchor, body: string) => void;
  toggleReviewComment: (commentId: string) => void;
  updateReviewComment: (commentId: string, body: string) => void;
}) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const [railHover, setRailHover] = useState<{
    run: RevisionRun;
    pos: { top: number; left: number };
  } | null>(null);

  useEffect(() => {
    if (!railHover) return;
    const close = () => setRailHover(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [railHover]);

  const handleRailEnter = (run: RevisionRun, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setRailHover({ run, pos: { top: rect.top, left: rect.right + 8 } });
  };
  const handleRailLeave = () => setRailHover(null);

  if (!chunk.diff || chunk.diff.length === 0) {
    return (
      <div className="metadata-diff">
        <span>diff unavailable</span>
        <p>
          The brief loaded, but no matching raw diff was available for this
          chunk. The durable fix is to emit chunk-level hunk rows from the
          categorizer.
        </p>
      </div>
    );
  }

  const dragIndexes =
    dragStart === null || dragCurrent === null
      ? []
      : rangeBetween(dragStart, dragCurrent);
  const activeRowIds = new Set(activeCommentAnchor?.rowIds ?? []);
  const overlayActive = revisionView.runs.length > 0;
  const metaColSpan = overlayActive ? 4 : 3;

  function finishSelection(rowIndex: number) {
    const indexes =
      dragStart === null ? [rowIndex] : rangeBetween(dragStart, rowIndex);
    setDragStart(null);
    setDragCurrent(null);
    const anchor = createCommentAnchor(
      chunk.id,
      chunk.file,
      chunk.diff ?? [],
      indexes,
    );
    if (anchor) openCommentComposer(anchor);
  }

  return (
    <>
      <table className="diff">
        <tbody>
          {chunk.diff.map((line, index) => {
            if (line.kind === "hunk" || line.kind === "note") {
              return (
                <tr className={line.kind} key={`${line.kind}-${index}`}>
                  <td colSpan={metaColSpan}>{line.content}</td>
                </tr>
              );
            }
            const sign =
              line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
            const id = rowId(chunk.id, index);
            const revRun = overlayActive
              ? revisionView.runByRow.get(index)
              : undefined;
            const revMark = overlayActive
              ? revisionView.marks.get(index)
              : undefined;
            const isRevStart =
              revRun !== undefined && revRun.rowIndexes[0] === index;
            const isRevEnd =
              revRun !== undefined && revRun.rowIndexes.at(-1) === index;
            const rowComments = comments.filter(
              (comment) => comment.anchor.rowIds.at(-1) === id,
            );
            const rowAddressedComments = addressedComments.filter((comment) =>
              reviewCommentMatchesDiffLine(
                comment,
                chunk.file,
                line,
                chunk.diff,
              ),
            );
            const isSelected =
              dragIndexes.includes(index) || activeRowIds.has(id);
            const showComposer =
              activeCommentAnchor?.chunkId === chunk.id &&
              activeCommentAnchor.rowIds.at(-1) === id;
            return (
              <Fragment key={`${line.kind}-${index}`}>
                <tr
                  className={`${line.kind} commentable ${isSelected ? "selected" : ""} ${revMark ? `rev-${revMark}` : ""}`}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") finishSelection(index);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setDragStart(index);
                    setDragCurrent(index);
                  }}
                  onMouseEnter={() => {
                    if (dragStart !== null) setDragCurrent(index);
                  }}
                  onMouseUp={() => finishSelection(index)}
                  tabIndex={0}
                >
                  {overlayActive ? (
                    <RevisionGutterCell
                      run={revRun}
                      isStart={isRevStart}
                      isEnd={isRevEnd}
                      chunk={chunk}
                      onRailEnter={handleRailEnter}
                      onRailLeave={handleRailLeave}
                    />
                  ) : null}
                  <td className="ln">{line.oldLine ?? ""}</td>
                  <td className="ln">{line.newLine ?? ""}</td>
                  <td className="code">
                    <span className="sign">{sign}</span>
                    {line.content}
                    {isRevStart && revRun ? (
                      <span className={`newtag ${revRun.kind}`}>
                        {revRun.kind === "removed" ? "removed" : "new"}
                      </span>
                    ) : null}
                  </td>
                </tr>
                {showComposer ? (
                  <tr className="comment-row">
                    <td colSpan={metaColSpan}>
                      <CommentComposer
                        anchor={activeCommentAnchor}
                        cancel={cancelCommentComposer}
                        existingReviewCommentCount={existingReviewCommentCount}
                        save={saveReviewComment}
                      />
                    </td>
                  </tr>
                ) : null}
                {rowComments.map((comment) => (
                  <tr className="comment-row" key={comment.id}>
                    <td colSpan={metaColSpan}>
                      <CommentThread
                        comment={comment}
                        deleteComment={deleteReviewComment}
                        toggle={toggleReviewComment}
                        update={updateReviewComment}
                      />
                    </td>
                  </tr>
                ))}
                {rowAddressedComments.map((comment) => (
                  <tr className="comment-row" key={`addressed-${comment.id}`}>
                    <td colSpan={metaColSpan}>
                      <AddressedDiffComment
                        comment={comment}
                        label={reviewCommentLabel}
                      />
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {railHover && (
        <DeltaCallout
          pos={railHover.pos}
          run={railHover.run}
          chunk={chunk}
          delta={revisionDelta}
        />
      )}
    </>
  );
}

function RevisionGutterCell({
  run,
  isStart,
  isEnd,
  onRailEnter,
  onRailLeave,
}: {
  run: RevisionRun | undefined;
  isStart: boolean;
  isEnd: boolean;
  chunk: BriefChunk;
  onRailEnter: (run: RevisionRun, el: HTMLElement) => void;
  onRailLeave: () => void;
}) {
  if (!run) return <td className="gut" />;
  const count = run.rowIndexes.length;
  const verb = run.kind === "removed" ? "Removed" : "New";
  const railClass = ["rail", isStart && "rail-first", isEnd && "rail-last"]
    .filter(Boolean)
    .join(" ");
  return (
    <td
      className={`gut rev ${run.kind}`}
      onMouseEnter={(e) => onRailEnter(run, e.currentTarget)}
      onMouseLeave={onRailLeave}
    >
      {isStart ? (
        <button
          className="railbtn-focus"
          type="button"
          aria-label={`${verb} this revision. ${count} line${count === 1 ? "" : "s"}.`}
          onFocus={(e) => onRailEnter(run, e.currentTarget)}
          onBlur={onRailLeave}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
      ) : null}
      <span className={railClass} aria-hidden="true" />
    </td>
  );
}

function AddressedDiffComment({
  comment,
  label,
}: {
  comment: AddressedReviewComment;
  label: string;
}) {
  return (
    <details className="comment-thread addressed-diff-comment">
      <summary className="comment-thread-head">
        <span>
          @{comment.author} {label}
        </span>
        <span>
          {comment.file}
          {addressedCommentRange(comment)}
        </span>
      </summary>
      <div className="comment-preview">
        <Markdown content={comment.body} />
      </div>
      {comment.inReplyToId ? (
        <div className="reply-note">reply to {comment.inReplyToId}</div>
      ) : null}
    </details>
  );
}

function CommentComposer({
  anchor,
  cancel,
  existingReviewCommentCount,
  save,
}: {
  anchor: CommentAnchor;
  cancel: () => void;
  existingReviewCommentCount: number;
  save: (anchor: CommentAnchor, body: string) => void;
}) {
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<ComposerMode>("write");
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function applyTextEdit(
    edit: (
      text: string,
      start: number,
      end: number,
    ) => { text: string; selectionStart: number; selectionEnd: number },
  ) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const next = edit(body, start, end);
    setBody(next.text);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        next.selectionStart,
        next.selectionEnd,
      );
    }, 0);
  }

  function insertLinePrefix(prefix: string) {
    applyTextEdit((text, start, end) => {
      const selected = text.slice(start, end) || "list item";
      const replacement = selected
        .split("\n")
        .map((line) => `${prefix}${line}`)
        .join("\n");
      return {
        text: `${text.slice(0, start)}${replacement}${text.slice(end)}`,
        selectionStart: start,
        selectionEnd: start + replacement.length,
      };
    });
  }

  function insertLink() {
    applyTextEdit((text, start, end) => {
      const selected = text.slice(start, end) || "link text";
      const replacement = `[${selected}](https://example.com)`;
      return {
        text: `${text.slice(0, start)}${replacement}${text.slice(end)}`,
        selectionStart: start + 1,
        selectionEnd: start + 1 + selected.length,
      };
    });
  }

  function insertSuggestion() {
    applyTextEdit((text, start, end) =>
      replaceSelectionWithSuggestion(
        text,
        start,
        end,
        text.slice(start, end) || anchor.selectedText,
      ),
    );
  }

  function submit() {
    if (!body.trim()) {
      setError("Comment cannot be empty.");
      return;
    }
    save(anchor, body);
  }

  return (
    <div className="comment-composer">
      <div className="comment-meta">
        <span>{commentAnchorLabel(anchor)}</span>
        <span>
          {anchor.rowIds.length} line{anchor.rowIds.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="comment-tabs">
        <button
          className={mode === "write" ? "active" : ""}
          type="button"
          onClick={() => setMode("write")}
        >
          Write
        </button>
        <button
          className={mode === "preview" ? "active" : ""}
          type="button"
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
      </div>
      {mode === "write" ? (
        <>
          <div className="comment-toolbar">
            <button
              type="button"
              onClick={() =>
                applyTextEdit((text, start, end) =>
                  applyMarkdownWrap(text, start, end, "**"),
                )
              }
            >
              B
            </button>
            <button
              type="button"
              onClick={() =>
                applyTextEdit((text, start, end) =>
                  applyMarkdownWrap(text, start, end, "_"),
                )
              }
            >
              I
            </button>
            <button
              type="button"
              onClick={() =>
                applyTextEdit((text, start, end) =>
                  applyMarkdownWrap(text, start, end, "`"),
                )
              }
            >
              Code
            </button>
            <button type="button" onClick={() => insertLinePrefix("> ")}>
              Quote
            </button>
            <button type="button" onClick={() => insertLinePrefix("- ")}>
              List
            </button>
            <button type="button" onClick={() => insertLinePrefix("1. ")}>
              1.
            </button>
            <button type="button" onClick={() => insertLinePrefix("- [ ] ")}>
              Task
            </button>
            <button type="button" onClick={insertLink}>
              Link
            </button>
            <button type="button" onClick={insertSuggestion}>
              Suggestion
            </button>
          </div>
          <textarea
            ref={textareaRef}
            autoFocus
            onChange={(event) => {
              setBody(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "b"
              ) {
                event.preventDefault();
                applyTextEdit((text, start, end) =>
                  applyMarkdownWrap(text, start, end, "**"),
                );
              }
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "i"
              ) {
                event.preventDefault();
                applyTextEdit((text, start, end) =>
                  applyMarkdownWrap(text, start, end, "_"),
                );
              }
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "k"
              ) {
                event.preventDefault();
                insertLink();
              }
            }}
            placeholder="Leave a comment"
            suppressHydrationWarning
            value={body}
          />
        </>
      ) : (
        <MarkdownPreview anchor={anchor} body={body} />
      )}
      {error ? <div className="comment-error">{error}</div> : null}
      <div className="comment-actions">
        <button className="btn primary" type="button" onClick={submit}>
          {reviewCommentSubmitLabel(existingReviewCommentCount)}
        </button>
        <button className="btn" type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CommentThread({
  comment,
  deleteComment,
  toggle,
  update,
}: {
  comment: ReviewComment;
  deleteComment: (commentId: string) => void;
  toggle: (commentId: string) => void;
  update: (commentId: string, body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);

  if (comment.collapsed) {
    return (
      <div className="comment-thread collapsed">
        <button type="button" onClick={() => toggle(comment.id)}>
          Draft comment on {comment.anchor.side === "new" ? "+" : "-"}
          {comment.anchor.startLine}
        </button>
      </div>
    );
  }

  return (
    <div className="comment-thread">
      <div className="comment-thread-head">
        <span>@you pending</span>
        <span>
          {comment.anchor.file}:{comment.anchor.startLine}
          {comment.anchor.endLine !== comment.anchor.startLine
            ? `-${comment.anchor.endLine}`
            : ""}
        </span>
      </div>
      {editing ? (
        <>
          <textarea
            suppressHydrationWarning
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="comment-actions">
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                update(comment.id, body);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setBody(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <MarkdownPreview anchor={comment.anchor} body={comment.body} />
      )}
      <div className="comment-thread-actions">
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" onClick={() => toggle(comment.id)}>
          Collapse
        </button>
        <button type="button" onClick={() => deleteComment(comment.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

function MarkdownPreview({
  anchor,
  body,
}: {
  anchor: CommentAnchor;
  body: string;
}) {
  const suggestions = parseSuggestionBlocks(body);
  const markdown = stripSuggestionBlocks(body);
  return (
    <div className="comment-preview">
      {markdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      ) : (
        <p className="preview-empty">Nothing to preview.</p>
      )}
      {suggestions.map((suggestion) => (
        <div className="suggestion-card" key={suggestion.index}>
          <div className="suggestion-title">Suggested change</div>
          <table
            className="diff suggestion-diff"
            aria-label="Suggested change diff"
          >
            <colgroup>
              <col className="suggestion-line-col" />
              <col className="suggestion-line-col" />
              <col />
            </colgroup>
            <tbody>
              {buildSuggestionDiffRows(anchor, suggestion.body).map(
                (row, index) => (
                  <tr className={row.kind} key={`${row.kind}-${index}`}>
                    <td className="ln">{row.oldLine ?? ""}</td>
                    <td className="ln">{row.newLine ?? ""}</td>
                    <td className="code">
                      <span className="sign">
                        {row.kind === "add" ? "+" : "−"}
                      </span>
                      {row.content}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <button disabled type="button">
            Apply suggestion unavailable in mockup
          </button>
        </div>
      ))}
    </div>
  );
}

function ReceiptDrawer(props: {
  brief: Brief;
  model: BriefViewModel;
  checkedItems: Record<CheckBucket, Set<number>>;
  dominants: Record<string, Category>;
  flagStates: Record<string, FlagState>;
  reviewMode: ReviewMode;
  riskEvidence: Record<string, RiskEvidence>;
  open: boolean;
  reclassifiedGroups: Set<string>;
  reviewComments: ReviewComment[];
  reviewedChunks: Set<string>;
  close: () => void;
  openSummaryPreview: () => void;
  submit: () => void;
}) {
  const totals = summarizeProgress(
    props.model,
    props.checkedItems,
    props.reviewedChunks,
    props.flagStates,
    props.dominants,
  );
  const dismissed = props.model.flags.filter(
    (flag) => props.flagStates[flag.id]?.status === "dismissed",
  );
  const addressed = props.model.flags.filter(
    (flag) => props.flagStates[flag.id]?.status === "addressed",
  );
  const open = props.model.flags.filter(
    (flag) => (props.flagStates[flag.id]?.status ?? "open") === "open",
  );

  return (
    <>
      <button
        aria-label="Close receipt"
        className={props.open ? "scrim show" : "scrim"}
        type="button"
        onClick={props.close}
      />
      <aside className={props.open ? "receipt show" : "receipt"}>
        <div className="receipt-inner">
          <div className="receipt-title">
            <h2>
              {props.reviewMode === "author"
                ? "Self-review summary"
                : "Verification receipt"}
            </h2>
            <span className="tag">not an approval</span>
          </div>
          <div className="receipt-sub">
            {props.reviewMode === "author"
              ? "Author-side preview · catches unresolved risk before requesting review"
              : "Frozen at submit · linked from a one-line signature on your normal GitHub review · the review itself stays yours"}
          </div>
          <pre className="receipt-body">{`Reviewed by @you (human) · ${props.brief.pr.repo} #${props.brief.pr.number} @ ${props.brief.pr.sha.slice(0, 7)}
Tool verification receipt — mechanical claims only

  ${totals.reviewed >= totals.chunkTotal ? "✓" : "•"} chunks read: ${totals.reviewed}/${totals.chunkTotal}
  ${addressed.length + dismissed.length >= props.model.flags.length ? "✓" : "•"} risk surface: ${addressed.length} addressed · ${dismissed.length} dismissed · ${open.length} open
  ${props.reviewComments.length > 0 ? "✓" : "•"} inline comments: ${props.reviewComments.length} draft
${props.reviewComments.map((comment) => `      comment: ${comment.anchor.file}:${comment.anchor.startLine}${comment.anchor.endLine !== comment.anchor.startLine ? `-${comment.anchor.endLine}` : ""} — ${comment.body.split("\n")[0] ?? ""}`).join("\n")}
${addressed.map((flag) => `      addressed: ${flag.attr} @ ${shortFile(flag.file)} — ${evidenceTextForFlag(flag.id, props.riskEvidence, props.reviewComments, props.brief.chunks)}`).join("\n")}
${dismissed.map((flag) => `      dismissed: ${flag.attr} @ ${shortFile(flag.file)} — "${props.flagStates[flag.id]?.reason ?? ""}"`).join("\n")}
${open.map((flag) => `      open: ${flag.attr} @ ${shortFile(flag.file)} — not addressed, not dismissed`).join("\n")}
${props.reclassifiedGroups.size > 0 ? `\n  ${props.reclassifiedGroups.size} group reclassified by reviewer` : ""}

  not checked: business intent · runtime behavior · performance under load · integration with downstream systems`}</pre>
          <div className="receipt-actions">
            <button
              className="btn primary"
              type="button"
              onClick={props.submit}
            >
              {props.reviewMode === "author"
                ? "Mark ready for review"
                : "Submit review to GitHub"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={props.openSummaryPreview}
            >
              Preview public summary
            </button>
            <button className="btn" type="button" onClick={props.close}>
              Keep reviewing
            </button>
            <span className="receipt-note">
              Scoped to mechanical claims. The approve / request-changes verdict
              is yours alone.
            </span>
          </div>
        </div>
      </aside>
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
    <>
      <button
        aria-label="Close summary preview"
        className={open ? "scrim show" : "scrim"}
        type="button"
        onClick={close}
      />
      <aside
        className={
          open ? "receipt summary-drawer show" : "receipt summary-drawer"
        }
      >
        <SummaryPreview
          brief={brief}
          mode={mode}
          snapshot={snapshot}
          setOutcome={setOutcome}
        />
      </aside>
    </>
  );
}

function PreSubmitModal({
  close,
  continueToReceipt,
  jumpToItem,
  mode,
  open,
  unresolvedItems,
}: {
  close: () => void;
  continueToReceipt: () => void;
  jumpToItem: (item: UnresolvedItem) => void;
  mode: ReviewMode;
  open: boolean;
  unresolvedItems: UnresolvedItem[];
}) {
  const title =
    mode === "author" ? "Before requesting review" : "Before the receipt";
  const primary =
    mode === "author"
      ? "Continue to self-review summary"
      : "Continue to receipt";
  return (
    <div className={open ? "modal show" : "modal"}>
      <div className="modal-box unresolved-box">
        <h3>{title}</h3>
        <p className="modal-copy">
          This is advisory. You can continue, but the summary will show
          unresolved items exactly as they are.
        </p>
        <div className="unresolved-list">
          {unresolvedItems.length === 0 ? (
            <div className="empty">No unresolved review items.</div>
          ) : null}
          {unresolvedItems.map((item) => (
            <button
              className="unresolved-item"
              key={item.id}
              type="button"
              onClick={() => jumpToItem(item)}
            >
              <span>{unresolvedKindLabel(item.kind)}</span>
              <b>{item.label}</b>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={close}>
            Keep reviewing
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={continueToReceipt}
          >
            {primary}
          </button>
        </div>
      </div>
    </div>
  );
}

function EvidenceModal({
  cancel,
  chunks,
  comments,
  confirm,
  target,
}: {
  cancel: () => void;
  chunks: BriefChunk[];
  comments: ReviewComment[];
  confirm: (
    kind: RiskEvidenceKind,
    commentId: string | undefined,
    note: string | undefined,
  ) => void;
  target: EvidenceTarget | null;
}) {
  const [kind, setKind] = useState<RiskEvidenceKind>("chunk-reviewed");
  const [commentId, setCommentId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!target) return;
    setKind(comments.length > 0 ? "linked-comment" : "chunk-reviewed");
    setCommentId(comments[0]?.id ?? "");
    setNote("");
  }, [comments, target]);

  const linkedCommentDisabled = kind === "linked-comment" && !commentId;
  return (
    <div className={target ? "modal show" : "modal"}>
      <div className="modal-box evidence-box">
        <h3>Address risk with evidence</h3>
        <div className="mattr">{target?.label}</div>
        <div className="evidence-options">
          <label>
            <input
              checked={kind === "linked-comment"}
              disabled={comments.length === 0}
              name="risk-evidence"
              type="radio"
              onChange={() => setKind("linked-comment")}
            />{" "}
            Linked comment
          </label>
          <label>
            <input
              checked={kind === "chunk-reviewed"}
              name="risk-evidence"
              type="radio"
              onChange={() => setKind("chunk-reviewed")}
            />{" "}
            Reviewed related chunk
          </label>
          <label>
            <input
              checked={kind === "manual-note"}
              name="risk-evidence"
              type="radio"
              onChange={() => setKind("manual-note")}
            />{" "}
            Manually verified
          </label>
        </div>
        {kind === "linked-comment" ? (
          <select
            value={commentId}
            onChange={(event) => setCommentId(event.target.value)}
          >
            {comments.map((comment) => (
              <option key={comment.id} value={comment.id}>
                {commentLocation(comment)}
              </option>
            ))}
          </select>
        ) : null}
        {kind === "chunk-reviewed" ? (
          <p className="modal-copy">
            Each selected risk will link to its related chunk. Reviewed chunks
            are shown as evidence in the receipt.
          </p>
        ) : null}
        {kind === "manual-note" ? (
          <textarea
            placeholder="What did you verify?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        ) : null}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={cancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={linkedCommentDisabled}
            type="button"
            onClick={() =>
              confirm(kind, commentId || undefined, note.trim() || undefined)
            }
          >
            Mark addressed
          </button>
        </div>
      </div>
    </div>
  );
}

function DismissModal({
  target,
  reason,
  warned,
  cancel,
  confirm,
  setReason,
}: {
  target: DismissTarget | null;
  reason: string;
  warned: boolean;
  cancel: () => void;
  confirm: () => void;
  setReason: (reason: string) => void;
}) {
  return (
    <div className={target ? "modal show" : "modal"}>
      <div className="modal-box">
        <h3>Dismiss flag</h3>
        <div className="mattr">{target?.label}</div>
        <textarea
          suppressHydrationWarning
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this flag not actionable here? Your reason lands on the receipt, verbatim."
        />
        <div className={warned ? "modal-warn show" : "modal-warn"}>
          Thin reason on a flag — it will appear on the receipt exactly as
          written. Dismiss anyway?
        </div>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={cancel}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={confirm}>
            {warned ? "Dismiss anyway" : "Dismiss with reason"}
          </button>
        </div>
      </div>
    </div>
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

function unresolvedKindLabel(kind: UnresolvedItem["kind"]): string {
  const labels: Record<UnresolvedItem["kind"], string> = {
    "open-risk": "Open risk",
    "missing-evidence": "Addressed without evidence",
    "unreviewed-carrier": "Unreviewed carrier chunk",
    "draft-comment": "Draft comment",
    "thin-dismissal": "Thin dismissal reason",
  };
  return labels[kind];
}

function evidenceTextForFlag(
  flagId: string,
  evidenceByFlag: Record<string, RiskEvidence>,
  comments: ReviewComment[],
  chunks: BriefChunk[],
): string {
  const evidence = evidenceByFlag[flagId];
  return evidence
    ? riskEvidenceLabel(evidence, comments, chunks)
    : "addressed without linked evidence";
}

function addressedCommentRange(comment: AddressedReviewComment): string {
  if (comment.startLine != null && comment.line != null)
    return `:${comment.startLine}-${comment.line}`;
  if (comment.line != null) return `:${comment.line}`;
  if (comment.originalStartLine != null && comment.originalLine != null)
    return `:original ${comment.originalStartLine}-${comment.originalLine}`;
  if (comment.originalLine != null) return `:original ${comment.originalLine}`;
  return "";
}

function shortFile(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}
