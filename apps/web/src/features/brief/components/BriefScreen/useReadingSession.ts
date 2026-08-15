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
import type { ChunkWindowRegistry } from "./chunkWindows";
import type { ReadingPositionStore } from "./readingPosition";
import type { LayoutMode } from "./Header/Header";
import {
  SupportingCollapseStates,
  type SupportingCollapseState,
} from "./ReadingToolbar/ReadingToolbar";
import {
  deriveBriefProgress,
  groupStartIndexes,
  SCROLL_ABORT_EVENTS,
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
  // A target inside a hidden kept-warm scope pane must no-op like
  // scrollIntoView does natively on box-less elements — its zero rect would
  // scroll to ~page top. Attribute check, not getClientRects: jsdom has no
  // layout, so a rect check would also veto every legitimate test scroll.
  if (element.closest("[hidden]") !== null) return;
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
  pollFrame: number | null;
  /** Tears down the active settle poll AND its abort listeners. */
  stopSettle: (() => void) | null;
}

/** Frames to wait for a window-jumped chunk to mount and the scroll to
 * settle before giving up (~1.5s at 60Hz — smooth long jumps take ~1s). */
const MOUNT_POLL_FRAMES = 90;
/** Below this landing miss, no correction — a nudge would read as jitter. */
const CORRECTION_THRESHOLD_PX = 8;
/** Consecutive still frames that count as "scroll stopped". */
const SETTLE_FRAMES = 3;

/** One instant nudge onto the real element after an estimate-guided jump. */
function correctLanding(element: HTMLElement, align: ChunkScrollAlign): void {
  if (element.closest("[hidden]") !== null) return;
  const desiredTop = align === "top" ? focusScrollOffset() : 0;
  const delta = element.getBoundingClientRect().top - desiredTop;
  if (Math.abs(delta) <= CORRECTION_THRESHOLD_PX) return;
  // "instant", not "auto" — "auto" defers to the page's smooth behavior.
  window.scrollBy({ behavior: "instant", top: delta });
}

function useChunkScroller(
  chunkWindows: ChunkWindowRegistry | null,
): (
  chunkId: string,
  behavior?: ScrollBehavior,
  align?: ChunkScrollAlign,
) => void {
  const pending = useRef<PendingChunkScroll>({
    timeout: null,
    firstFrame: null,
    secondFrame: null,
    pollFrame: null,
    stopSettle: null,
  });

  const cancelPendingScroll = useCallback(() => {
    const current = pending.current;
    // First: a stale settle poll's abort listeners must not survive into
    // the next jump — one firing would kill the NEW jump's poll.
    current.stopSettle?.();
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
    if (current.pollFrame !== null) {
      window.cancelAnimationFrame(current.pollFrame);
      current.pollFrame = null;
    }
  }, []);

  useEffect(() => cancelPendingScroll, [cancelPendingScroll]);

  // After a far jump: wait until the card mounts AND the scroll stops, then
  // nudge once onto the real element. The user's own input aborts — a late
  // correction would hijack a scroll they already took over.
  const settleAndCorrect = useCallback(
    (chunkId: string, align: ChunkScrollAlign) => {
      const stop = () => {
        if (pending.current.pollFrame !== null) {
          window.cancelAnimationFrame(pending.current.pollFrame);
          pending.current.pollFrame = null;
        }
        for (const type of SCROLL_ABORT_EVENTS) {
          window.removeEventListener(type, stop);
        }
        pending.current.stopSettle = null;
      };

      let frames = 0;
      let stableFrames = 0;
      let lastY = window.scrollY;

      const scrollHasSettled = () => {
        stableFrames = window.scrollY === lastY ? stableFrames + 1 : 0;
        lastY = window.scrollY;
        return stableFrames >= SETTLE_FRAMES;
      };

      const poll = () => {
        pending.current.pollFrame = null;
        frames += 1;

        const element = document.getElementById(chunkId);
        const settled = scrollHasSettled();
        if (element && settled) {
          stop();
          correctLanding(element, align);
          return;
        }

        if (frames >= MOUNT_POLL_FRAMES) {
          stop();
          return;
        }
        pending.current.pollFrame = window.requestAnimationFrame(poll);
      };

      for (const type of SCROLL_ABORT_EVENTS) {
        window.addEventListener(type, stop, { once: true, passive: true });
      }
      pending.current.stopSettle = stop;
      pending.current.pollFrame = window.requestAnimationFrame(poll);
    },
    [],
  );

  return useCallback(
    (
      chunkId: string,
      behavior: ScrollBehavior = "smooth",
      align: ChunkScrollAlign = "native",
    ) => {
      cancelPendingScroll();
      pending.current.timeout = window.setTimeout(() => {
        pending.current.timeout = null;
        // Far jumps are instant, never smooth: windowed lists mount and
        // measure cards as the viewport passes, and every measurement
        // scroll-adjustment CANCELS an in-flight smooth animation — a
        // smooth far jump dies a few thousand px in. Near targets keep the
        // smooth glide (short flight, no mount churn to cancel it).
        const resolveJump = (align_: ChunkScrollAlign) => {
          const element = document.getElementById(chunkId);
          const farLimit = window.innerHeight * 3;
          if (
            element &&
            Math.abs(element.getBoundingClientRect().top) <= farLimit
          ) {
            const resolvedBehavior = prefersReducedMotion() ? "auto" : behavior;
            if (align_ === "top") scrollElementToTop(element, resolvedBehavior);
            else
              element.scrollIntoView({
                behavior: resolvedBehavior,
                block: "start",
              });
            return;
          }
          if (element) {
            if (element.closest("[hidden]") !== null) return;
            element.scrollIntoView({ behavior: "instant", block: "start" });
          } else if (!chunkWindows?.scrollToChunk(chunkId)) {
            // Unknown id or hidden pane: no-op, the pre-windowing contract
            // for missing targets.
            return;
          }
          settleAndCorrect(chunkId, align_);
        };
        if (align === "top") {
          pending.current.firstFrame = window.requestAnimationFrame(() => {
            pending.current.firstFrame = null;
            pending.current.secondFrame = window.requestAnimationFrame(() => {
              pending.current.secondFrame = null;
              resolveJump("top");
            });
          });
          return;
        }
        resolveJump("native");
      }, 0);
    },
    [cancelPendingScroll, chunkWindows, settleAndCorrect],
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
  /** Jump routing into windowed chunk lists; null = mounted DOM only. */
  chunkWindows?: ChunkWindowRegistry | null | undefined;
  /**
   * The reading-position store this session WRITES (scroll-spy + explicit
   * nav). Never subscribed here — position consumers subscribe themselves, so
   * a spy tick re-renders them and not the screen shell hosting this hook.
   */
  position: ReadingPositionStore;
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
  layoutMode: LayoutMode;
  focusMode: boolean;
  /** The focus banner strip's measurement target (publishes --focus-banner-h). */
  focusBannerRef: RefObject<HTMLDivElement | null>;
  openChunks: Set<string>;
  /** Bulk action over `openChunks`, never an override — derived state. */
  supportingCollapse: SupportingCollapseState;
  toggleCollapseSupporting: () => void;
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
  /** Ensure-open for row-target jumps; wayfinding jumps never call it. */
  openChunk: (chunkId: string) => void;
  jumpToGroup: (groupId: string) => void;
  toggleFocusMode: () => void;
  startReadThrough: () => void;
  /** Exit focus mode into the story view (the intent-bar landing path). */
  exitToStoryView: () => void;
}

export function useReadingSession(
  input: UseReadingSessionInput,
): UseReadingSessionValue {
  const {
    brief,
    briefId,
    compareViewFull,
    model,
    ownDraftActive,
    repoConfig,
    chunkWindows,
    position,
  } = input;
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
  const scrollToChunk = useChunkScroller(chunkWindows ?? null);
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
  const [layoutMode] = useState<LayoutMode>("split");
  const [openChunks, setOpenChunks] = useState<Set<string>>(
    () => new Set(chunkIds),
  );

  // Derived, never stored: mirrors openChunks, so collapse-on-review and
  // manual toggles keep it honest.
  const supportingChunkIds = useMemo(
    () =>
      readingOrderedChunks
        .filter((chunk) => chunk.role === "supporting")
        .map((chunk) => chunk.id),
    [readingOrderedChunks],
  );
  const collapsedSupportingCount = supportingChunkIds.filter(
    (id) => !openChunks.has(id),
  ).length;
  let supportingCollapse: SupportingCollapseState =
    SupportingCollapseStates.NONE;
  if (collapsedSupportingCount > 0) {
    supportingCollapse =
      collapsedSupportingCount === supportingChunkIds.length
        ? SupportingCollapseStates.ALL
        : SupportingCollapseStates.SOME;
  }
  const toggleCollapseSupporting = useCallback(() => {
    setOpenChunks((current) => {
      const next = new Set(current);
      const allCollapsed =
        supportingChunkIds.length > 0 &&
        supportingChunkIds.every((id) => !current.has(id));
      for (const id of supportingChunkIds) {
        if (allCollapsed) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, [supportingChunkIds]);
  const [focusMode, setFocusMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Brief switch without remount: reading posture is per-brief and used to
  // reset via the subtree remount — adjust during render so the new brief
  // never paints with the old brief's open set, active chunk, or focus mode.
  const [sessionBriefId, setSessionBriefId] = useState(briefId);
  if (sessionBriefId !== briefId) {
    setSessionBriefId(briefId);
    setOpenChunks(new Set(chunkIds));
    setFocusMode(false);
    setShortcutsOpen(false);
  }
  const focusModeRef = useLatestRef(focusMode);
  // The one write path into the reading-position store: chunk and derived
  // group land together, so subscribers never see them disagree.
  const chunkToGroup = model.chunkToGroup;
  const setActivePosition = useCallback(
    (chunkId: string) => {
      position
        .getState()
        .actions.setActive(chunkId, chunkToGroup.get(chunkId) ?? null);
    },
    [chunkToGroup, position],
  );
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

  // The position has two write sources: scroll-spy (below) and explicit nav
  // (toggleChunk/jumpToChunk). Scroll-spy only runs in the full-scope split
  // view outside focus mode.
  useScrollSpy(
    layoutMode === "split" && !focusMode && compareViewFull
      ? chunkIds
      : EMPTY_CHUNK_IDS,
    setActivePosition,
    undefined,
    briefId,
  );

  const toggleChunk = useCallback(
    (chunkId: string) => {
      setOpenChunks((current) => toggleSetMember(current, chunkId));
      setActivePosition(chunkId);
    },
    [setActivePosition],
  );

  const markReviewed = useCallback(
    (chunkId: string) => {
      const alreadyReviewed = reviewedChunksRef.current.has(chunkId);
      // Focus mode: checking collapses + advances (never wraps); un-checking
      // is a correction — reopen and stay put.
      if (focusModeRef.current) {
        if (alreadyReviewed) {
          actions.reviewChunk(chunkId);
          setOpenChunks((current) => new Set(current).add(chunkId));
          return;
        }
        actions.reviewChunk(chunkId);
        setOpenChunks((current) => {
          const next = new Set(current);
          next.delete(chunkId);
          return next;
        });
        const index = chunkIds.indexOf(chunkId);
        const next = index >= 0 ? chunkIds[index + 1] : undefined;
        if (next) {
          setActivePosition(next);
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
    [
      actions,
      chunkIds,
      focusModeRef,
      reviewedChunksRef,
      scrollToChunk,
      setActivePosition,
    ],
  );

  /** Ensure-open, never a toggle — row-target jumps (conversation threads,
   * revision rails, unresolved submit items) land INSIDE the diff, which
   * only exists on an open card. */
  const openChunk = useCallback((chunkId: string) => {
    setOpenChunks((current) =>
      current.has(chunkId) ? current : new Set(current).add(chunkId),
    );
  }, []);

  const jumpToChunk = useCallback(
    (
      chunkId: string,
      behavior: ScrollBehavior = "smooth",
      align: ChunkScrollAlign = "native",
    ) => {
      // Focus mode must open the target — every other card is display:none,
      // so a collapsed landing would show nothing. Outside focus mode a
      // collapsed card is the user's triage: wayfinding jumps (toc, group
      // stepper, risk attrs) land on it WITHOUT re-expanding.
      if (focusModeRef.current)
        setOpenChunks((current) => new Set(current).add(chunkId));
      setActivePosition(chunkId);
      scrollToChunk(chunkId, behavior, align);
    },
    [focusModeRef, scrollToChunk, setActivePosition],
  );
  // Plain handlers from here down: no consumer memoizes on their identity
  // (the memo boundaries live at ChunkCard/GroupCard, whose props stay the
  // stable callbacks above). closeShortcuts is the one exception below.
  const jumpToChunkFromShortcut = (chunkId: string) => {
    const focusActive =
      document.getElementById("main-content")?.dataset["zen"] === "on";
    jumpToChunk(chunkId, "auto", focusActive ? "top" : "native");
  };

  const toggleFocusMode = () => {
    const entering = !focusModeRef.current;
    setFocusMode(entering);
    if (!entering) return;
    // align="top" required: the focus banner only mounts once `focusMode`
    // flips true, so the scroll must pre-reserve its height via
    // focusScrollOffset() or the banner covers the chunk.
    const target = position.getState().activeChunkId ?? firstChunkId;
    if (!target) return;
    // Focus mode reads the active card; a collapsed one would show nothing.
    openChunk(target);
    setActivePosition(target);
    scrollToChunk(target, "smooth", "top");
  };
  const toggleShortcuts = () => setShortcutsOpen((current) => !current);
  // Stable: Modal's Escape-listener effect deps on `close` — an unstable
  // identity would re-bind a document listener on every session render
  // while the shortcuts modal is open.
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  // Always starts at step 1, unlike Z/toggleFocus which re-anchors on the
  // active chunk. align="top": see toggleFocusMode.
  const startReadThrough = () => {
    if (!firstChunkId) return;
    setFocusMode(true);
    openChunk(firstChunkId);
    setActivePosition(firstChunkId);
    scrollToChunk(firstChunkId, "smooth", "top");
  };

  // The TOC bar jumps by Change-group; land on the group's first chunk.
  const jumpToGroup = useCallback(
    (groupId: string) => {
      const group = model.groups.find((candidate) => candidate.id === groupId);
      const target = group?.chunks[0];
      if (target) jumpToChunk(target.id);
    },
    [jumpToChunk, model.groups],
  );

  // The intent bar lives in the full-compare story view, so leave focus
  // mode first.
  const exitToStoryView = useCallback(() => {
    setFocusMode(false);
  }, []);

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
    layoutMode,
    focusMode,
    focusBannerRef,
    openChunks,
    supportingCollapse,
    toggleCollapseSupporting,
    shortcutsOpen,
    toggleShortcuts,
    closeShortcuts,
    toggleChunk,
    markReviewed,
    jumpToChunk,
    jumpToChunkFromShortcut,
    openChunk,
    jumpToGroup,
    toggleFocusMode,
    startReadThrough,
    exitToStoryView,
  };
}
