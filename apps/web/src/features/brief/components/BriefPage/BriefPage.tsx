import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { Drawer } from "../../../../components/Drawer/Drawer";
import { Markdown } from "../../../../components/Markdown/Markdown";
import { useLocalPreference } from "../../../../hooks/useLocalPreference";
import { useScrollSpy } from "../../../../hooks/useScrollSpy";
import type { CommentAnchor, ReviewComment } from "../../../review/comments";
import {
  DismissModal,
  type DismissTarget,
} from "../../../review/components/DismissModal/DismissModal";
import {
  EvidenceModal,
  type EvidenceTarget,
} from "../../../review/components/EvidenceModal/EvidenceModal";
import { PreSubmitModal } from "../../../review/components/PreSubmitModal/PreSubmitModal";
import { ReceiptDrawer } from "../../../review/components/ReceiptDrawer/ReceiptDrawer";
import { SummaryPreview } from "../../../review/components/SummaryPreview/SummaryPreview";
import { buildReceipt } from "../../../review/receipt";
import {
  clearSnapshots,
  deriveInitialState,
  MindMapProvider,
  serializeSnapshot,
  useMindMap,
  useMindMapActions,
  type SessionSnapshot,
} from "../../../review/session";
import {
  deriveUnresolvedItems,
  type RiskEvidenceKind,
  type ReviewMode,
  type ReviewOutcome,
  type RiskEvidence,
  type UnresolvedItem,
} from "../../../review/state";
import { summarizeProgress } from "../../progress";
import {
  localBriefQueryOptions,
  localRevisionChangesQueryOptions,
} from "../../queries";
import { buildChunkRevisionView } from "../../revisionChanges";
import type { RevisionOverlayState } from "../../revisionOverlay";
import { buildBriefTimeline } from "../../timeline";
import type { Brief, LocalBriefSummary } from "../../types";
import { useKeyboardShortcuts } from "../../useKeyboardShortcuts";
import { buildBriefViewModel, type RiskFlag } from "../../viewModel";
import { ConcernView } from "../ConcernView/ConcernView";
import { DeltaContext } from "../DeltaContext/DeltaContext";
import { DemoControls } from "../DemoControls/DemoControls";
import { GroupTocBar } from "../GroupTocBar/GroupTocBar";
import { Header, type LayoutMode, type ViewMode } from "../Header/Header";
import { ShortcutsModal } from "../ShortcutsModal/ShortcutsModal";
import { StoryView } from "../StoryView/StoryView";
import styles from "./BriefPage.module.scss";

const EMPTY_CHUNK_IDS: string[] = [];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function numericCssVar(name: string): number {
  if (typeof window === "undefined") return 0;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function focusScrollOffset(): number {
  const topBarHeight = numericCssVar("--top-bar-h");
  const focusBannerHeight =
    document
      .querySelector<HTMLElement>("[data-focus-banner]")
      ?.getBoundingClientRect().height ?? 0;
  return topBarHeight + focusBannerHeight + 40;
}

function scrollElementToTop(
  element: HTMLElement,
  behavior: ScrollBehavior,
): void {
  const top = Math.max(
    0,
    window.scrollY + element.getBoundingClientRect().top - focusScrollOffset(),
  );
  window.scrollTo({ behavior, top });
}

type ChunkScrollAlign = "native" | "top";

interface PendingChunkScroll {
  timeout: number | null;
  firstFrame: number | null;
  secondFrame: number | null;
}

function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

function useChunkScroller(): (
  chunkId: string,
  behavior?: ScrollBehavior,
  align?: ChunkScrollAlign,
) => void {
  const pending = useRef<PendingChunkScroll>({
    timeout: null,
    firstFrame: null,
    secondFrame: null,
  });

  const cancelPendingScroll = useCallback(() => {
    const current = pending.current;
    if (current.timeout !== null) {
      window.clearTimeout(current.timeout);
      current.timeout = null;
    }
    if (current.firstFrame !== null) {
      window.cancelAnimationFrame(current.firstFrame);
      current.firstFrame = null;
    }
    if (current.secondFrame !== null) {
      window.cancelAnimationFrame(current.secondFrame);
      current.secondFrame = null;
    }
  }, []);

  useEffect(() => cancelPendingScroll, [cancelPendingScroll]);

  return useCallback(
    (
      chunkId: string,
      behavior: ScrollBehavior = "smooth",
      align: ChunkScrollAlign = "native",
    ) => {
      cancelPendingScroll();
      pending.current.timeout = window.setTimeout(() => {
        pending.current.timeout = null;
        const resolvedBehavior = prefersReducedMotion() ? "auto" : behavior;
        if (align === "top") {
          pending.current.firstFrame = window.requestAnimationFrame(() => {
            pending.current.firstFrame = null;
            pending.current.secondFrame = window.requestAnimationFrame(() => {
              pending.current.secondFrame = null;
              const element = document.getElementById(chunkId);
              if (element) scrollElementToTop(element, resolvedBehavior);
            });
          });
          return;
        }
        const element = document.getElementById(chunkId);
        if (!element) return;
        element.scrollIntoView({
          behavior: resolvedBehavior,
          block: "start",
        });
      }, 0);
    },
    [cancelPendingScroll],
  );
}

export interface BriefPageProps {
  artifacts: LocalBriefSummary[];
  briefId: string;
}

/** Per-brief page: mounts the Mind-Map store provider around the review screen. */
export function BriefPage({ artifacts, briefId }: BriefPageProps) {
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

interface BriefScreenProps {
  artifacts: LocalBriefSummary[];
  brief: Brief;
  briefId: string;
  model: ReturnType<typeof buildBriefViewModel>;
}

function BriefScreen({ artifacts, brief, briefId, model }: BriefScreenProps) {
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
  const revision: RevisionOverlayState = useMemo(
    () => ({
      changes: effectiveRevisionChanges,
      delta: revisionDelta,
      available: revisionAvailable,
      enabled: revisionEnabled,
      runCount: revisionRunCount,
      setEnabled: setRevisionEnabled,
    }),
    [
      effectiveRevisionChanges,
      revisionAvailable,
      revisionDelta,
      revisionEnabled,
      revisionRunCount,
      setRevisionEnabled,
    ],
  );

  // Session/domain state lives in the per-brief Mind-Map store (ADR 0022).
  const dispositions = useMindMap((state) => state.dispositions);
  const dominants = useMindMap((state) => state.dominants);
  const reclassifiedGroups = useMindMap((state) => state.reclassifiedGroups);
  const reviewedChunks = useMindMap((state) => state.reviewedChunks);
  const checkedItems = useMindMap((state) => state.checkedItems);
  const reviewComments = useMindMap((state) => state.reviewComments);
  const reviewOutcome = useMindMap((state) => state.reviewOutcome);
  const actions = useMindMapActions();
  const scrollToChunk = useChunkScroller();
  // Walk chunks in the rendered (grouped) order, not raw brief order — the
  // StoryView lays chunks out by group, so J/K must follow the same sequence or
  // it appears to jump backward and forward. Matches the openChunks seeding.
  const chunkIds = useMemo(
    () =>
      model.groups.flatMap((group) => group.chunks.map((chunk) => chunk.id)),
    [model.groups],
  );

  // Transient UI state stays local and colocated.
  const [reviewMode, setReviewMode] = useState<ReviewMode>("reviewer");
  const [viewMode, setViewMode] = useState<ViewMode>("story");
  const [layoutMode] = useState<LayoutMode>("split");
  const [collapseSupporting, setCollapseSupporting] = useState(false);
  const [openChunks, setOpenChunks] = useState<Set<string>>(
    () => new Set(chunkIds),
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
  const [focusMode, setFocusMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const activeChunkIdRef = useLatestRef(activeChunkId);
  const focusModeRef = useLatestRef(focusMode);
  const firstChunkId = chunkIds[0] ?? null;

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
  const commentsByChunk = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const comment of reviewComments) {
      const comments = map.get(comment.anchor.chunkId) ?? [];
      comments.push(comment);
      map.set(comment.anchor.chunkId, comments);
    }
    return map;
  }, [reviewComments]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.getElementById("main-content")?.focus();
  }, [briefId]);

  // activeChunkId has two write sources: scroll-spy (below) and explicit nav
  // (toggleChunk/jumpToChunk). Scroll-spy only runs in the split story view.
  const scrollActiveChunkId = useScrollSpy(
    viewMode === "story" && layoutMode === "split" && !focusMode
      ? chunkIds
      : EMPTY_CHUNK_IDS,
  );
  useEffect(() => {
    if (scrollActiveChunkId) setActiveChunkId(scrollActiveChunkId);
  }, [scrollActiveChunkId]);

  const toggleChunk = useCallback((chunkId: string) => {
    setOpenChunks((current) => {
      const next = new Set(current);
      if (next.has(chunkId)) next.delete(chunkId);
      else next.add(chunkId);
      return next;
    });
    setActiveChunkId(chunkId);
  }, []);

  const markReviewed = useCallback(
    (chunkId: string) => {
      // reviewChunk is a pure store toggle; the collapse-on-review coupling lives
      // here because openChunks is local UI — drop the chunk from it explicitly.
      actions.reviewChunk(chunkId);
      setOpenChunks((current) => {
        const next = new Set(current);
        next.delete(chunkId);
        return next;
      });
    },
    [actions],
  );

  const jumpToChunk = useCallback(
    (
      chunkId: string,
      behavior: ScrollBehavior = "smooth",
      align: ChunkScrollAlign = "native",
    ) => {
      setViewMode("story");
      setOpenChunks((current) => new Set(current).add(chunkId));
      setActiveChunkId(chunkId);
      scrollToChunk(chunkId, behavior, align);
    },
    [scrollToChunk],
  );
  const jumpToChunkFromShortcut = useCallback(
    (chunkId: string) => {
      const focusActive =
        document.getElementById("main-content")?.dataset["zen"] === "on";
      jumpToChunk(chunkId, "auto", focusActive ? "top" : "native");
    },
    [jumpToChunk],
  );

  const toggleFocusMode = useCallback(() => {
    const entering = !focusModeRef.current;
    setFocusMode(entering);
    if (!entering) return;
    setViewMode("story");
    // Re-anchor onto the chunk being focused so entering focus mode is always
    // visible, even when that chunk was already at the top of the viewport.
    const target = activeChunkIdRef.current ?? firstChunkId;
    if (!target) return;
    setActiveChunkId(target);
    scrollToChunk(target);
  }, [activeChunkIdRef, firstChunkId, focusModeRef, scrollToChunk]);
  const toggleShortcuts = useCallback(
    () => setShortcutsOpen((current) => !current),
    [],
  );

  // Shortcuts stand down whenever an overlay holds focus (drawers/modals use
  // `inert`, which doesn't stop a window-level keydown listener on its own).
  const shortcutsDisabled =
    receiptOpen ||
    summaryPreviewOpen ||
    preSubmitOpen ||
    shortcutsOpen ||
    dismissTarget !== null ||
    evidenceTarget !== null ||
    activeCommentAnchor !== null;
  useKeyboardShortcuts({
    chunkIds,
    activeChunkId,
    disabled: shortcutsDisabled,
    focusModeActive: focusMode,
    jumpToChunk: jumpToChunkFromShortcut,
    toggleFocusMode,
    toggleHelp: toggleShortcuts,
  });

  // The TOC bar jumps by Change-group; land on the group's first chunk.
  const jumpToGroup = useCallback(
    (groupId: string) => {
      const group = model.groups.find((candidate) => candidate.id === groupId);
      const target = group?.chunks[0];
      if (target) jumpToChunk(target.id);
    },
    [jumpToChunk, model.groups],
  );

  // Active group derived from the active chunk — no second scroll listener.
  const activeGroupId = activeChunkId
    ? (model.chunkToGroup.get(activeChunkId) ?? null)
    : null;

  const clearSelection = useCallback((flagIds: string[]) => {
    setSelectedRiskFlags((current) => {
      const next = new Set(current);
      for (const flagId of flagIds) next.delete(flagId);
      return next;
    });
  }, []);

  const toggleRiskFlag = useCallback((flagId: string) => {
    setSelectedRiskFlags((current) => {
      const next = new Set(current);
      if (next.has(flagId)) next.delete(flagId);
      else next.add(flagId);
      return next;
    });
  }, []);

  const toggleRiskGroup = useCallback((flagIds: string[]) => {
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
  }, []);

  const addressWithEvidence = useCallback(
    (flagIds: string[], evidenceForFlag: (flag: RiskFlag) => RiskEvidence) => {
      const evidenceByFlagId = new Map<string, RiskEvidence>();
      for (const flagId of flagIds) {
        const flag = model.flagsById.get(flagId);
        if (flag) evidenceByFlagId.set(flag.id, evidenceForFlag(flag));
      }
      if (evidenceByFlagId.size === 0) return;
      actions.addressFlags(evidenceByFlagId);
      const addressedIds = [...evidenceByFlagId.keys()];
      clearSelection(addressedIds);
      setToast(
        addressedIds.length === 1
          ? "Risk marked addressed with evidence."
          : `${addressedIds.length} risks marked addressed with evidence.`,
      );
    },
    [actions, clearSelection, model.flagsById],
  );

  const confirmDismiss = useCallback(() => {
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
  }, [actions, clearSelection, dismissReason, dismissTarget, dismissWarned]);

  const saveReviewComment = useCallback(
    (anchor: CommentAnchor, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) {
        setToast("Comment cannot be empty.");
        return;
      }
      actions.saveComment({
        anchor,
        body: trimmed,
        status: "draft",
        collapsed: false,
      });
      setActiveCommentAnchor(null);
      setToast("Draft comment added to this review.");
    },
    [actions],
  );

  const updateReviewComment = useCallback(
    (commentId: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) {
        setToast("Comment cannot be empty.");
        return;
      }
      actions.updateComment(commentId, trimmed);
      setToast("Draft comment updated.");
    },
    [actions],
  );

  const deleteReviewComment = useCallback(
    (commentId: string) => {
      actions.deleteComment(commentId);
      setToast("Draft comment deleted.");
    },
    [actions],
  );

  const openCommentComposer = useCallback((anchor: CommentAnchor) => {
    setActiveCommentAnchor(anchor);
  }, []);
  const cancelCommentComposer = useCallback(() => {
    setActiveCommentAnchor(null);
  }, []);
  const toggleReviewComment = useCallback(
    (commentId: string) => actions.toggleComment(commentId),
    [actions],
  );
  const openPreSubmit = useCallback(() => setPreSubmitOpen(true), []);
  const closeReceipt = useCallback(() => setReceiptOpen(false), []);
  const openSummaryPreview = useCallback(() => setSummaryPreviewOpen(true), []);
  const submitReceipt = useCallback(() => {
    setReceiptOpen(false);
    setToast(
      reviewMode === "author"
        ? "Mockup flow — this would mark the PR ready for review after self-review."
        : "Mockup flow — submit posts your review natively to GitHub with one signature line linking this receipt.",
    );
  }, [reviewMode]);
  const closeSummaryPreview = useCallback(
    () => setSummaryPreviewOpen(false),
    [],
  );
  const closePreSubmit = useCallback(() => setPreSubmitOpen(false), []);
  const continuePreSubmitToReceipt = useCallback(() => {
    setPreSubmitOpen(false);
    setReceiptOpen(true);
  }, []);
  const jumpToPreSubmitItem = useCallback(
    (item: UnresolvedItem) => {
      setPreSubmitOpen(false);
      jumpToChunk(item.targetId);
    },
    [jumpToChunk],
  );
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const clearDrafts = useCallback(() => {
    clearSnapshots();
    actions.reset(deriveInitialState(model));
  }, [actions, model]);
  const openDismissTarget = useCallback((target: DismissTarget) => {
    setDismissTarget(target);
    setDismissReason("");
    setDismissWarned(false);
  }, []);
  const toggleDescription = useCallback(
    () => setDescriptionOpen((current) => !current),
    [],
  );
  const cancelDismiss = useCallback(() => setDismissTarget(null), []);
  const cancelEvidence = useCallback(() => setEvidenceTarget(null), []);
  const confirmEvidence = useCallback(
    (
      kind: RiskEvidenceKind,
      commentId: string | undefined,
      note: string | undefined,
    ) => {
      if (!evidenceTarget) return;
      addressWithEvidence(evidenceTarget.flagIds, (flag) => {
        if (kind === "linked-comment")
          return commentId
            ? { kind, commentId }
            : { kind: "chunk-reviewed", chunkId: flag.chunkId };
        if (kind === "chunk-reviewed") return { kind, chunkId: flag.chunkId };
        return note ? { kind, note } : { kind };
      });
      setEvidenceTarget(null);
    },
    [addressWithEvidence, evidenceTarget],
  );

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
        viewMode={viewMode}
        setViewMode={setViewMode}
        setLocOpen={setLocOpen}
        openReceipt={openPreSubmit}
        clearDrafts={clearDrafts}
      />
      <main
        className={
          layoutMode === "split" && viewMode === "story"
            ? "main split-main"
            : "main"
        }
        id="main-content"
        tabIndex={-1}
        data-zen={focusMode ? "on" : undefined}
      >
        {/* Focus mode (Z) strips the page chrome and centers a single chunk in
            a narrow reading column — the visible payoff of "focus". */}
        {focusMode ? (
          <div
            className={styles["focusBanner"]}
            data-focus-banner=""
            role="status"
          >
            <span>
              <b>Focus mode</b> — one chunk at a time. <kbd>J</kbd>
              <kbd>K</kbd> to move, <kbd>Esc</kbd> to exit.
            </span>
            <button className="btn" type="button" onClick={toggleFocusMode}>
              Exit focus
            </button>
          </div>
        ) : null}
        {focusMode ? null : (
          <section className={`${styles["summary"]} reveal`}>
            <div className={styles["eyebrow"]}>
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
              className={styles["descriptionToggle"]}
              type="button"
              onClick={toggleDescription}
            >
              {descriptionOpen
                ? "Hide original PR description"
                : "Show original PR description"}
            </button>
            {descriptionOpen ? (
              <div className={styles["description"]}>
                <div className={styles["eyebrow"]}>Original PR description</div>
                <Markdown
                  content={
                    brief.pr.description || "_No PR description provided._"
                  }
                />
              </div>
            ) : null}
          </section>
        )}

        {focusMode ? null : (
          <DemoControls reviewMode={reviewMode} setReviewMode={setReviewMode} />
        )}

        {viewMode === "story" && !focusMode ? (
          <GroupTocBar
            activeGroupId={activeGroupId}
            groups={model.groups}
            jumpToGroup={jumpToGroup}
          />
        ) : null}

        {viewMode === "story" ? (
          <StoryView
            brief={brief}
            model={model}
            revision={revision}
            activeChunkId={activeChunkId}
            collapseSupporting={collapseSupporting}
            focusMode={focusMode}
            openChunks={openChunks}
            selectedRiskFlags={selectedRiskFlags}
            activeCommentAnchor={activeCommentAnchor}
            addressedReviewComments={brief.reviewComments}
            commentsByChunk={commentsByChunk}
            existingReviewCommentCount={reviewComments.length}
            cancelCommentComposer={cancelCommentComposer}
            deleteReviewComment={deleteReviewComment}
            jumpToChunk={jumpToChunk}
            markReviewed={markReviewed}
            openCommentComposer={openCommentComposer}
            saveReviewComment={saveReviewComment}
            setCollapseSupporting={setCollapseSupporting}
            setDismissTarget={openDismissTarget}
            setEvidenceTarget={setEvidenceTarget}
            setToast={setToast}
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
      <ReceiptDrawer
        receipt={receipt}
        reviewMode={reviewMode}
        open={receiptOpen}
        close={closeReceipt}
        openSummaryPreview={openSummaryPreview}
        submit={submitReceipt}
      />
      <SummaryPreviewDrawer
        brief={brief}
        mode={reviewMode}
        open={summaryPreviewOpen}
        snapshot={snapshot}
        close={closeSummaryPreview}
        setOutcome={actions.setOutcome}
      />
      <PreSubmitModal
        mode={reviewMode}
        open={preSubmitOpen}
        unresolvedItems={unresolvedItems}
        close={closePreSubmit}
        continueToReceipt={continuePreSubmitToReceipt}
        jumpToItem={jumpToPreSubmitItem}
      />
      <DismissModal
        target={dismissTarget}
        reason={dismissReason}
        warned={dismissWarned}
        cancel={cancelDismiss}
        confirm={confirmDismiss}
        setReason={setDismissReason}
      />
      <EvidenceModal
        chunks={brief.chunks}
        comments={reviewComments}
        target={evidenceTarget}
        cancel={cancelEvidence}
        confirm={confirmEvidence}
      />
      <ShortcutsModal open={shortcutsOpen} close={closeShortcuts} />
      <div className={styles["kbdHint"]}>
        {focusMode ? (
          <button className="btn" type="button" onClick={toggleFocusMode}>
            Exit focus (Z)
          </button>
        ) : null}
        <button
          aria-label="Keyboard shortcuts"
          className={styles["shortcutsTrigger"]}
          type="button"
          onClick={toggleShortcuts}
        >
          ?
        </button>
      </div>
      <div
        className={styles["toast"]}
        data-state={toast ? "visible" : "hidden"}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast}
      </div>
    </>
  );
}

interface SummaryPreviewDrawerProps {
  brief: Brief;
  close: () => void;
  mode: ReviewMode;
  open: boolean;
  setOutcome: (outcome: ReviewOutcome) => void;
  snapshot: SessionSnapshot;
}

function SummaryPreviewDrawer({
  brief,
  close,
  mode,
  open,
  setOutcome,
  snapshot,
}: SummaryPreviewDrawerProps) {
  return (
    <Drawer
      open={open}
      closeLabel="Close summary preview"
      close={close}
      asideClassName={styles["summaryDrawer"]}
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
