// The reading-session facade hook (BRIEF-44 split, plan decision 11): the
// per-brief Mind-Map store wiring, the progress/receipt derivation, and the
// scroll/nav machinery (chunk scroller, scroll-spy, focus mode,
// read-through). The screen wires props in and renders; this hook owns the
// session's state and hides the store selector fan-out — only the members the
// screen (or a sibling flow hook) actually consumes are exposed.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { useScrollSpy } from "@web/hooks/useScrollSpy";
import { prefersReducedMotion } from "@web/utils/motion";
import type { ReviewComment } from "@web/features/review/comments";
import { buildReceipt, type Receipt } from "@web/features/review/receipt";
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
} from "@web/features/review/state";
import { summarizeProgress, type ProgressTotals } from "../../progress";
import type { Brief } from "../../types";
import type { BriefViewModel, GroupView } from "../../viewModel";
import type { RepoConfigContext } from "../../repoConfig";
import type { LayoutMode, ViewMode } from "../Header/Header";

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

/**
 * Single consumer of the pending-scroll choreography — stays co-located with
 * the reading session (ADR 0037, plan decision 11).
 */
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
   * Own-draft state (BRIEF-43): flag dispositions are unreachable there
   * (read-only mirror), so progress is chunk read-through only.
   */
  ownDraftActive: boolean;
  repoConfig: RepoConfigContext | null | undefined;
}

export interface UseReadingSessionValue {
  // — store surface the screen still wires directly —
  actions: MindMapActions;
  reviewComments: ReviewComment[];
  replyDrafts: Record<string, string>;
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
  // Session/domain state lives in the per-brief Mind-Map store (ADR 0022).
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
  // Walk chunks in the rendered (grouped) order, not raw brief order — the
  // StoryView lays chunks out by group, so J/K must follow the same sequence or
  // it appears to jump backward and forward. Matches the openChunks seeding.
  // The digest's chunk axis is the RENDERED order (grouped reading order),
  // not raw brief order — same sequence J/K walks (codex round 1).
  const readingOrderedChunks = useMemo(
    () => model.groups.flatMap((group) => group.chunks),
    [model.groups],
  );

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
  // Mirror of Header's --top-bar-h: publish the focus banner strip's measured
  // height so sticky chunk headers (ChunkCard .head) and the focus rail can
  // stack below the strip instead of pinning behind it. 0px whenever focus
  // mode is off (the strip is unmounted).
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
  // Own-draft state: flag dispositions are unreachable (read-only mirror), so
  // counting them in the denominator would cap progress below 100% forever —
  // progress is chunk read-through only there.
  const totalWork = ownDraftActive
    ? brief.chunks.length
    : model.flags.length + brief.chunks.length;
  const progressDone = ownDraftActive
    ? totals.reviewed
    : totals.reviewed + totals.flagsResolved;
  const progress = totalWork === 0 ? 0 : (progressDone / totalWork) * 100;
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
    () => buildReceipt(snapshot, brief, model, repoConfig),
    [snapshot, brief, model, repoConfig],
  );

  useEffect(() => {
    document.getElementById("main-content")?.focus();
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
      const alreadyReviewed = reviewedChunks.has(chunkId);
      // In ANY focus mode (Z or Start read-through — the two are visually
      // identical, so gating on how it was entered read as broken), the
      // Viewed control means "confirmed viewed → next": it must never stall
      // the flow. An already-viewed chunk (viewed earlier in the session —
      // snapshots persist across reloads — or revisited via K) is re-affirmed
      // and advanced past, NOT un-checked; un-viewing stays available in the
      // normal scrolling view, where bulk-marking happens. Advance is the
      // strict next chunk in `chunkIds`; crossing a group boundary needs no
      // special handling — FocusGroupRail renders for whichever group holds
      // activeChunkId, so a plain chunk advance lands the reader on the next
      // group's rail too. Never wraps past the last chunk.
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
      // reviewChunk is a pure store toggle; the collapse-on-review coupling lives
      // here because openChunks is local UI — drop the chunk from it explicitly.
      actions.reviewChunk(chunkId);
      setOpenChunks((current) => {
        const next = new Set(current);
        next.delete(chunkId);
        return next;
      });
    },
    [actions, chunkIds, focusModeRef, reviewedChunks, scrollToChunk],
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
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  // Read-through entry point: always starts at step 1 (the first chunk of
  // the first group in Reading order — or source order without one),
  // regardless of where the reader currently is. Distinct from Z/toggleFocus,
  // which re-anchors focus mode onto whatever chunk is already active.
  const startReadThrough = useCallback(() => {
    if (!firstChunkId) return;
    setViewMode("story");
    setFocusMode(true);
    setActiveChunkId(firstChunkId);
    // See toggleFocusMode: align="top" reserves the focus banner's height so
    // it doesn't overlap the chunk we just entered focus mode on.
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

  // The intent-bar landing path (BRIEF-54 PR 4): the bar lives in the
  // full-compare story view, so leave focus mode and return to story first.
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
    replyDrafts,
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
