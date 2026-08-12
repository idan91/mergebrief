// The reading-session facade hook: per-brief Mind-Map store wiring, the
// progress/receipt derivation, and the scroll/nav machinery (chunk scroller,
// scroll-spy, focus mode, read-through). Exposes only the members the screen
// (or a sibling flow hook) consumes.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createI18n } from "i18n";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { useScrollSpy } from "@web/hooks/useScrollSpy";
import { prefersReducedMotion } from "@web/utils/motion";
import type { ReviewComment } from "@web/features/review/utils/comments";
import { buildReceipt, type Receipt } from "@web/features/review/utils/receipt";
import {
  serializeSnapshot,
  useMindMap,
  useMindMapActions,
  type MindMapActions,
  type SessionSnapshot,
} from "@web/features/review/session";
import {
  deriveUnresolvedItems,
  type ReviewOutcome,
  type UnresolvedItem,
} from "@web/features/review/utils/state";

const receiptArtifactI18n = createI18n();
import { summarizeProgress, type ProgressTotals } from "../../utils/progress";
import type { Brief } from "../../types";
import type { BriefViewModel, GroupView } from "../../utils/viewModel";
import type { RepoConfigContext } from "../../utils/repoConfig";
import type { LayoutMode, ViewMode } from "./Header/Header";
import {
  deriveBriefProgress,
  groupStartIndexes,
  toggleSetMember,
} from "./utils";

const EMPTY_CHUNK_IDS: string[] = [];

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

export type ChunkScrollAlign = "native" | "top";

interface PendingChunkScroll {
  timeout: number | null;
  firstFrame: number | null;
  secondFrame: number | null;
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

export interface UseReadingSessionInput {
  brief: Brief;
  briefId: string;
  /** Whether the FULL-brief view is active (gates scroll-spy). */
  compareViewFull: boolean;
  model: BriefViewModel;
  /**
   * Own-draft state: flag dispositions are unreachable there (read-only
   * mirror), so progress is chunk read-through only.
   */
  ownDraftActive: boolean;
  repoConfig: RepoConfigContext | null | undefined;
}

export interface UseReadingSessionValue {
  // — store surface the screen still wires directly —
  actions: MindMapActions;
  reviewComments: ReviewComment[];
  submittedReviewIds: number[];
  reviewOutcome: ReviewOutcome;
  // — progress / receipt derivation —
  totals: ProgressTotals;
  progress: number;
  unresolvedItems: UnresolvedItem[];
  snapshot: SessionSnapshot;
  receipt: Receipt;
  // — reading order —
  /** Chunks in the RENDERED (grouped) order — the sequence J/K walks. */
  readingOrderedChunks: GroupView["chunks"];
  chunkIds: string[];
  /** Index into `chunkIds` where each group starts (Shift+J/Shift+K). */
  groupBoundaries: number[];
  // — view / focus state —
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  layoutMode: LayoutMode;
  focusMode: boolean;
  /** The focus banner strip's measurement target (publishes --focus-banner-h). */
  focusBannerRef: RefObject<HTMLDivElement | null>;
  activeChunkId: string | null;
  /** Active group derived from the active chunk — no second scroll listener. */
  activeGroupId: string | null;
  openChunks: Set<string>;
  collapseSupporting: boolean;
  setCollapseSupporting: (collapse: boolean) => void;
  shortcutsOpen: boolean;
  toggleShortcuts: () => void;
  closeShortcuts: () => void;
  // — navigation —
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  jumpToChunk: (
    chunkId: string,
    behavior?: ScrollBehavior,
    align?: ChunkScrollAlign,
  ) => void;
  /** The keyboard-shortcut jump: align="top" while focus mode is on. */
  jumpToChunkFromShortcut: (chunkId: string) => void;
  jumpToGroup: (groupId: string) => void;
  toggleFocusMode: () => void;
  startReadThrough: () => void;
  /** Exit focus mode into the story view (the intent-bar landing path). */
  exitToStoryView: () => void;
}

export function useReadingSession(
  input: UseReadingSessionInput,
): UseReadingSessionValue {
  const { brief, briefId, compareViewFull, model, ownDraftActive, repoConfig } =
    input;
  // Session/domain state lives in the per-brief Mind-Map store.
  const dispositions = useMindMap((state) => state.dispositions);
  const dominants = useMindMap((state) => state.dominants);
  const reclassifiedGroups = useMindMap((state) => state.reclassifiedGroups);
  const reviewedChunks = useMindMap((state) => state.reviewedChunks);
  const reviewComments = useMindMap((state) => state.reviewComments);
  const submittedReviewIds = useMindMap((state) => state.submittedReviewIds);
  const replyDrafts = useMindMap((state) => state.replyDrafts);
  const reviewOutcome = useMindMap((state) => state.reviewOutcome);
  const actions = useMindMapActions();
  const scrollToChunk = useChunkScroller();
  // RENDERED (grouped) order, not raw brief order — the StoryView lays chunks
  // out by group, so J/K must follow the same sequence.
  const readingOrderedChunks = useMemo(
    () => model.groups.flatMap((group) => group.chunks),
    [model.groups],
  );

  const chunkIds = useMemo(
    () =>
      model.groups.flatMap((group) => group.chunks.map((chunk) => chunk.id)),
    [model.groups],
  );
  const groupBoundaries = useMemo(
    () => groupStartIndexes(model.groups),
    [model.groups],
  );

  // Transient UI state stays local and colocated.
  const [viewMode, setViewMode] = useState<ViewMode>("story");
  const [layoutMode] = useState<LayoutMode>("split");
  const [collapseSupporting, setCollapseSupporting] = useState(false);
  const [openChunks, setOpenChunks] = useState<Set<string>>(
    () => new Set(chunkIds),
  );
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const activeChunkIdRef = useLatestRef(activeChunkId);
  const focusModeRef = useLatestRef(focusMode);
  // markReviewed is a ChunkCard memo-boundary prop: reading reviewedChunks
  // through a ref keeps its identity stable across review actions (a Set dep
  // would re-render every memoized card per click).
  const reviewedChunksRef = useLatestRef(reviewedChunks);
  // Publishes --focus-banner-h so sticky chunk headers and the focus rail
  // stack below the strip; 0px whenever focus mode is off (strip unmounted).
  const focusBannerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const setBannerHeight = (value: string) =>
      document.documentElement.style.setProperty("--focus-banner-h", value);
    const el = focusBannerRef.current;
    if (!focusMode || !el) {
      setBannerHeight("0px");
      return;
    }
    const apply = () => setBannerHeight(`${el.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      setBannerHeight("0px");
    };
  }, [focusMode]);
  const firstChunkId = chunkIds[0] ?? null;

  const totals = useMemo(
    () => summarizeProgress(model, reviewedChunks, dispositions),
    [dispositions, model, reviewedChunks],
  );
  const progress = deriveBriefProgress({
    ownDraftActive,
    totals,
    flagCount: model.flags.length,
    chunkCount: brief.chunks.length,
  });
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
        reviewComments,
        reviewOutcome,
        submittedReviewIds,
        replyDrafts,
      }),
    [
      briefId,
      dispositions,
      dominants,
      reclassifiedGroups,
      reviewComments,
      replyDrafts,
      reviewOutcome,
      reviewedChunks,
      submittedReviewIds,
    ],
  );
  const receipt = useMemo(
    () =>
      buildReceipt(receiptArtifactI18n.t, snapshot, brief, model, repoConfig),
    [snapshot, brief, model, repoConfig],
  );

  // Only anchor when nothing else holds focus: a reviewer who switched brief
  // from a live control must keep it. Never scrolls.
  useEffect(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.isConnected
    ) {
      return;
    }
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [briefId]);

  // activeChunkId has two write sources: scroll-spy (below) and explicit nav
  // (toggleChunk/jumpToChunk). Scroll-spy only runs in the split story view.
  const scrollActiveChunkId = useScrollSpy(
    viewMode === "story" &&
      layoutMode === "split" &&
      !focusMode &&
      compareViewFull
      ? chunkIds
      : EMPTY_CHUNK_IDS,
  );
  useEffect(() => {
    if (scrollActiveChunkId) setActiveChunkId(scrollActiveChunkId);
  }, [scrollActiveChunkId]);

  const toggleChunk = useCallback((chunkId: string) => {
    setOpenChunks((current) => toggleSetMember(current, chunkId));
    setActiveChunkId(chunkId);
  }, []);

  const markReviewed = useCallback(
    (chunkId: string) => {
      const alreadyReviewed = reviewedChunksRef.current.has(chunkId);
      // In ANY focus mode, Viewed means "confirmed viewed → next" and must
      // never stall: an already-viewed chunk is re-affirmed and advanced past,
      // NOT un-checked (un-viewing stays in the normal scrolling view).
      // Advance is the strict next chunk in `chunkIds`; never wraps.
      if (focusModeRef.current) {
        if (!alreadyReviewed) {
          actions.reviewChunk(chunkId);
          setOpenChunks((current) => {
            const next = new Set(current);
            next.delete(chunkId);
            return next;
          });
        }
        const index = chunkIds.indexOf(chunkId);
        const next = index >= 0 ? chunkIds[index + 1] : undefined;
        if (next) {
          setActiveChunkId(next);
          scrollToChunk(next, "smooth", "top");
        }
        return;
      }
      // Collapse-on-review lives here because openChunks is local UI.
      actions.reviewChunk(chunkId);
      setOpenChunks((current) => {
        const next = new Set(current);
        next.delete(chunkId);
        return next;
      });
    },
    [actions, chunkIds, focusModeRef, reviewedChunksRef, scrollToChunk],
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
    // Concerns+focus does not exist: focus implies Story. This snap is the
    // entry half; the other half is the header lens control greying while
    // focus is on (`modeLegality`'s CONCERNS_FOCUS_LENS_REASON), so the lens
    // can never leave Story mid-focus.
    setViewMode("story");
    // align="top" required: the focus banner only mounts once `focusMode`
    // flips true, so the scroll must pre-reserve its height via
    // focusScrollOffset() or the banner covers the chunk.
    const target = activeChunkIdRef.current ?? firstChunkId;
    if (!target) return;
    setActiveChunkId(target);
    scrollToChunk(target, "smooth", "top");
  }, [activeChunkIdRef, firstChunkId, focusModeRef, scrollToChunk]);
  const toggleShortcuts = useCallback(
    () => setShortcutsOpen((current) => !current),
    [],
  );
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  // Always starts at step 1, unlike Z/toggleFocus which re-anchors on the
  // active chunk. align="top": see toggleFocusMode.
  const startReadThrough = useCallback(() => {
    if (!firstChunkId) return;
    setViewMode("story");
    setFocusMode(true);
    setActiveChunkId(firstChunkId);
    scrollToChunk(firstChunkId, "smooth", "top");
  }, [firstChunkId, scrollToChunk]);

  // The TOC bar jumps by Change-group; land on the group's first chunk.
  const jumpToGroup = useCallback(
    (groupId: string) => {
      const group = model.groups.find((candidate) => candidate.id === groupId);
      const target = group?.chunks[0];
      if (target) jumpToChunk(target.id);
    },
    [jumpToChunk, model.groups],
  );

  // The intent bar lives in the full-compare story view, so leave focus mode
  // and return to story first.
  const exitToStoryView = useCallback(() => {
    setFocusMode(false);
    setViewMode("story");
  }, []);

  // Active group derived from the active chunk — no second scroll listener.
  const activeGroupId = activeChunkId
    ? (model.chunkToGroup.get(activeChunkId) ?? null)
    : null;

  return {
    actions,
    reviewComments,
    submittedReviewIds,
    reviewOutcome,
    totals,
    progress,
    unresolvedItems,
    snapshot,
    receipt,
    readingOrderedChunks,
    chunkIds,
    groupBoundaries,
    viewMode,
    setViewMode,
    layoutMode,
    focusMode,
    focusBannerRef,
    activeChunkId,
    activeGroupId,
    openChunks,
    collapseSupporting,
    setCollapseSupporting,
    shortcutsOpen,
    toggleShortcuts,
    closeShortcuts,
    toggleChunk,
    markReviewed,
    jumpToChunk,
    jumpToChunkFromShortcut,
    jumpToGroup,
    toggleFocusMode,
    startReadThrough,
    exitToStoryView,
  };
}
