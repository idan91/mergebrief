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
import {
  comparisonAvailability,
  resolveBriefSearch,
  type BriefSearchParams,
} from "../../compareState";
import { summarizeProgress } from "../../progress";
import {
  localBriefQueryOptions,
  localComparisonMarksQueryOptions,
  localRevisionNarrativeQueryOptions,
} from "../../queries";
import {
  buildChunkComparisonView,
  type ComparisonSource,
} from "../../comparison";
import type { ComparisonOverlayState } from "../../comparisonOverlay";
import { buildBriefTimeline } from "../../timeline";
import type {
  Brief,
  LocalBriefSummary,
  RevisionNarrativeArtifact,
} from "../../types";
import { useKeyboardShortcuts } from "../../useKeyboardShortcuts";
import { buildBriefViewModel, type RiskFlag } from "../../viewModel";
import { ChangesOnlyView } from "../ChangesOnlyView/ChangesOnlyView";
import { ConcernView } from "../ConcernView/ConcernView";
import { DeltaContext } from "../DeltaContext/DeltaContext";
import { DemoControls } from "../DemoControls/DemoControls";
import { GroupTocBar } from "../GroupTocBar/GroupTocBar";
import { Header, type LayoutMode, type ViewMode } from "../Header/Header";
import { ReadThroughProgress } from "../ReadThroughProgress/ReadThroughProgress";
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
  /** Raw View/Compare URL params (ADR 0024 plan step 6); undefined keys mean
   * "nothing chosen yet", resolved against comparison availability below. */
  searchParams: BriefSearchParams;
}

/** Per-brief page: mounts the Mind-Map store provider around the review screen. */
export function BriefPage({
  artifacts,
  briefId,
  searchParams,
}: BriefPageProps) {
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  const model = useMemo(() => buildBriefViewModel(brief), [brief]);
  return (
    <MindMapProvider briefId={briefId} model={model}>
      <BriefScreen
        artifacts={artifacts}
        brief={brief}
        briefId={briefId}
        model={model}
        searchParams={searchParams}
      />
    </MindMapProvider>
  );
}

interface BriefScreenProps {
  artifacts: LocalBriefSummary[];
  brief: Brief;
  briefId: string;
  model: ReturnType<typeof buildBriefViewModel>;
  searchParams: BriefSearchParams;
}

function BriefScreen({
  artifacts,
  brief,
  briefId,
  model,
  searchParams,
}: BriefScreenProps) {
  const timeline = useMemo(
    () => buildBriefTimeline(artifacts, briefId),
    [artifacts, briefId],
  );
  const availability = useMemo(
    () => comparisonAvailability(timeline.selectedPoint),
    [timeline.selectedPoint],
  );
  // View/Compare (ADR 0024 plan step 6): resolved, normalized state for the
  // selected timeline point. Overlay rendering for compare != off and the
  // Changes Only content are Stage 3 — this stage only wires the controls to
  // route state and keeps every existing rendering path working unchanged.
  const compareState = useMemo(
    () => resolveBriefSearch(searchParams, availability),
    [availability, searchParams],
  );

  // Comparison overlay (ADR 0024): the active Compare baseline drives both the
  // Full Brief highlights and the Changes Only content. Marks are mechanical —
  // the sole source of truth for highlights; the narrative/Delta only supplies
  // callout text and the changed-only summaries (highlights never derive from
  // them). One state machine parameterized by baseline, not two.
  const comparisons = timeline.selectedPoint?.comparisons;
  const activeCompare = compareState.compare;
  const previousBriefComparison = comparisons?.previousBrief;
  const lastReviewComparison = comparisons?.lastReview;

  const marksId =
    activeCompare === "previous-brief"
      ? previousBriefComparison?.marksId
      : activeCompare === "last-review"
        ? lastReviewComparison?.marksId
        : undefined;
  const narrativeId =
    activeCompare === "previous-brief"
      ? previousBriefComparison?.narrativeId
      : undefined;
  const deltaId =
    activeCompare === "last-review" ? lastReviewComparison?.deltaId : undefined;

  const marks =
    useQuery({
      ...localComparisonMarksQueryOptions(marksId ?? ""),
      enabled: Boolean(marksId),
    }).data ?? null;
  const narrativeArtifact: RevisionNarrativeArtifact | null =
    useQuery({
      ...localRevisionNarrativeQueryOptions(narrativeId ?? ""),
      enabled: Boolean(narrativeId),
    }).data ?? null;
  const delta =
    useQuery({
      ...localBriefQueryOptions(deltaId ?? ""),
      enabled: Boolean(deltaId),
    }).data ?? null;

  // narrativeId-present only means "an artifact exists"; discriminate on the
  // fetched kind — a skip stub is narrative-unavailable with a knowable reason.
  const narrative =
    narrativeArtifact !== null &&
    narrativeArtifact.artifactKind === "revisionNarrative"
      ? narrativeArtifact
      : null;
  const skipReason =
    narrativeArtifact !== null &&
    narrativeArtifact.artifactKind === "revisionNarrativeSkipped"
      ? narrativeArtifact.skipped
      : null;

  const comparisonSource: ComparisonSource = useMemo(
    () =>
      activeCompare === "last-review"
        ? { kind: "last-review", delta }
        : { kind: "previous-brief", brief, narrative },
    [activeCompare, brief, delta, narrative],
  );

  const comparison: ComparisonOverlayState = useMemo(() => {
    // The overlay only paints in Full Brief; Changes Only renders its own view.
    const available =
      compareState.view === "full" && activeCompare !== "off" && Boolean(marks);
    const effectiveMarks = available ? marks : null;
    const runCount = effectiveMarks
      ? brief.chunks.reduce(
          (total, chunk) =>
            total + buildChunkComparisonView(chunk, effectiveMarks).runs.length,
          0,
        )
      : 0;
    return {
      compare: activeCompare,
      marks: effectiveMarks,
      source: comparisonSource,
      skipReason,
      available,
      runCount,
    };
  }, [
    activeCompare,
    brief.chunks,
    compareState.view,
    comparisonSource,
    marks,
    skipReason,
  ]);

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
  // Index into `chunkIds` where each group starts, in the same order — feeds
  // Shift+J/Shift+K (Read-through: jump to the next/prev group's first chunk
  // in Reading order, or source order when no Reading order is present).
  const groupBoundaries = useMemo(() => {
    let offset = 0;
    const boundaries: number[] = [];
    for (const group of model.groups) {
      boundaries.push(offset);
      offset += group.chunks.length;
    }
    return boundaries;
  }, [model.groups]);

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
  // Read-through is a distinct sub-state of focus mode: only "Start
  // read-through" turns it on (auto-advance-on-viewed applies); plain Z/Esc
  // focus mode never does. Cleared whenever Z toggles focus mode, whether
  // that's entering plain focus or exiting either mode.
  const [readThroughActive, setReadThroughActive] = useState(false);
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
    viewMode === "story" &&
      layoutMode === "split" &&
      !focusMode &&
      compareState.view === "full"
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
      const becomingReviewed = !reviewedChunks.has(chunkId);
      actions.reviewChunk(chunkId);
      setOpenChunks((current) => {
        const next = new Set(current);
        next.delete(chunkId);
        return next;
      });
      // Read-through only, and only on the viewed-on edge (not un-checking):
      // advance to the strict next chunk in sequence. Crossing a group
      // boundary needs no special handling — FocusGroupRail already renders
      // for whichever group holds activeChunkId, so a plain chunk advance
      // lands the reader on the next group's rail too. Never wraps past the
      // last chunk.
      if (becomingReviewed && readThroughActive) {
        const index = chunkIds.indexOf(chunkId);
        const next = index >= 0 ? chunkIds[index + 1] : undefined;
        if (next) {
          setActiveChunkId(next);
          scrollToChunk(next, "smooth", "top");
        }
      }
    },
    [actions, chunkIds, readThroughActive, reviewedChunks, scrollToChunk],
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
    // Z always yields plain focus mode (no auto-advance), whether entering
    // fresh or re-toggled out of Read-through; Esc exiting Read-through must
    // clear it too, since Esc routes through this same toggle.
    setReadThroughActive(false);
    if (!entering) return;
    setViewMode("story");
    // Re-anchor onto the chunk being focused so entering focus mode is always
    // visible, even when that chunk was already at the top of the viewport.
    // align="top" is required here (not the default "native" scrollIntoView):
    // the focus banner only mounts once `focusMode` flips true, so the scroll
    // that lands us on the chunk must already reserve its height via
    // focusScrollOffset() — otherwise the banner renders on top of the chunk
    // we just scrolled to.
    const target = activeChunkIdRef.current ?? firstChunkId;
    if (!target) return;
    setActiveChunkId(target);
    scrollToChunk(target, "smooth", "top");
  }, [activeChunkIdRef, firstChunkId, focusModeRef, scrollToChunk]);
  const toggleShortcuts = useCallback(
    () => setShortcutsOpen((current) => !current),
    [],
  );

  // Read-through entry point: always starts at step 1 (the first chunk of
  // the first group in Reading order — or source order without one),
  // regardless of where the reader currently is. Distinct from Z/toggleFocus,
  // which re-anchors focus mode onto whatever chunk is already active.
  const startReadThrough = useCallback(() => {
    if (!firstChunkId) return;
    setViewMode("story");
    setFocusMode(true);
    setReadThroughActive(true);
    setActiveChunkId(firstChunkId);
    // See toggleFocusMode: align="top" reserves the focus banner's height so
    // it doesn't overlap the chunk we just entered focus mode on.
    scrollToChunk(firstChunkId, "smooth", "top");
  }, [firstChunkId, scrollToChunk]);

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
    groupBoundaries,
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
        availability={availability}
        compareState={compareState}
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
            <ReadThroughProgress
              activeChunkId={activeChunkId}
              groups={model.groups}
              jumpToChunk={jumpToChunk}
            />
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

        {compareState.view === "changes" ? (
          <ChangesOnlyView
            compare={
              activeCompare === "last-review" ? "last-review" : "previous-brief"
            }
            brief={brief}
            model={model}
            narrative={narrative}
            marks={marks}
            skipReason={skipReason}
            delta={delta}
          />
        ) : (
          <>
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
                comparison={comparison}
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
                {...(compareState.view === "full" && chunkIds.length > 0
                  ? { startReadThrough }
                  : {})}
              />
            ) : (
              <ConcernView
                brief={brief}
                model={model}
                jumpToChunk={jumpToChunk}
              />
            )}
          </>
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
