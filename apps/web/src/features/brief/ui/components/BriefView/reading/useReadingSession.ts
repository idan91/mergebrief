// The reading-session facade hook: per-brief Review Session store wiring, the
// progress/receipt derivation, and the scroll/nav machinery (scroll to target,
// scroll-spy, focus mode, read-through). Exposes only the members the screen
// (or a sibling flow hook) consumes.
import type { ReviewOutcome } from "types/reviews";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { createI18n } from "i18n";
import { useStore } from "zustand";

import { useLatestRef } from "@web/hooks/useLatestRef";
import { useScrollSpy } from "@web/hooks/useScrollSpy";
import {
  buildReceipt,
  deriveUnresolvedItems,
  type Receipt,
  type ReviewComment,
  type UnresolvedItem,
} from "@web/features/review/utils";
import {
  serializeSnapshot,
  useReviewSession,
  useReviewSessionActions,
  type ReviewSessionActions,
  type SessionSnapshot,
} from "@web/features/review/session";

const receiptArtifactI18n = createI18n();
import {
  summarizeProgress,
  type ProgressTotals,
} from "../../../utils/progress";
import type { Brief } from "../../../../model/types";
import { GroupViewKinds } from "../../../../model/utils/remainder";
import type {
  BriefViewModel,
  GroupView,
} from "../../../../model/utils/view-model";
import type { RepoConfigContext } from "../../../../model/utils/repo-config";
import type { ChunkWindowRegistry } from "./chunk-windows";
import type { ReadingPositionStore } from "./reading-position";
import type { BriefViewStore } from "../store";
import type { ScopeExitOptions } from "../types";
import {
  SupportingCollapseStates,
  type SupportingCollapseState,
} from "../ReadingToolbar";
import {
  deriveBriefProgress,
  deriveGroupHeadingId,
  groupStartIndexes,
  listChunkIds,
  toggleSetMember,
} from "../utils";
import { useScrollToTarget } from "../scroll-to-target";
import { deriveScrollMotion } from "../scroll-to-target/engine/plan";
import {
  ScrollMotions,
  ScrollPlacements,
  type ScrollPlacement,
} from "../scroll-to-target/engine/types";
import { readUnderStackTop } from "../scroll-to-target/targets";
import {
  ScrollHistories,
  ScrollTargetKinds,
  type ScrollHistory,
  type ScrollTargetOptions,
  type ScrollToTarget,
} from "../scroll-to-target/types";

const EMPTY_CHUNK_IDS: string[] = [];

const SMOOTH_UNDER_STACK: ScrollTargetOptions = {
  motion: ScrollMotions.SMOOTH,
  history: ScrollHistories.NONE,
  placement: ScrollPlacements.UNDER_STACK,
};

/** The spy reads the chunk at the line an under-stack jump parks a head on,
 * so a scroll never hands the position to the chunk above it. */
function readingLineOffset(): number {
  const lineOffset = readUnderStackTop() + 1;
  return lineOffset;
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
  /** The Brief's open chunks, focus mode and shortcuts overlay. */
  viewStore: BriefViewStore;
  /** Jump routing into windowed chunk lists; null = mounted DOM only. */
  chunkWindows?: ChunkWindowRegistry | null | undefined;
  /** Route-owned; a jump with a history mode leaves Changes scope through it. */
  exitChangesScope?: ((options: ScopeExitOptions) => void) | undefined;
  /**
   * The reading-position store this session WRITES (scroll-spy + explicit
   * nav). Never subscribed here, position consumers subscribe themselves, so
   * a spy tick re-renders them and not the screen shell hosting this hook.
   */
  position: ReadingPositionStore;
}

export interface UseReadingSessionValue {
  // store surface the screen still wires directly,
  actions: ReviewSessionActions;
  reviewComments: ReviewComment[];
  submittedReviewIds: number[];
  reviewOutcome: ReviewOutcome;
  // progress / receipt derivation,
  totals: ProgressTotals;
  progress: number;
  unresolvedItems: UnresolvedItem[];
  snapshot: SessionSnapshot;
  receipt: Receipt;
  // reading order,
  /** Chunks in the RENDERED (grouped) order, the sequence J/K walks. */
  readingOrderedChunks: GroupView["chunks"];
  chunkIds: string[];
  /** Index into `chunkIds` where each group starts (Shift+J/Shift+K). */
  groupBoundaries: number[];
  // view / focus state,
  focusMode: boolean;
  /** The focus pill's measurement target (publishes --focus-indicator-h). */
  focusIndicatorRef: RefObject<HTMLDivElement | null>;
  openChunks: ReadonlySet<string>;
  /** Bulk action over `openChunks`, never an override, derived state. */
  supportingCollapse: SupportingCollapseState;
  toggleCollapseSupporting: () => void;
  shortcutsOpen: boolean;
  toggleShortcuts: () => void;
  closeShortcuts: () => void;
  // navigation,
  toggleChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  jumpToChunk: (
    chunkId: string,
    behavior?: ScrollBehavior,
    placement?: ScrollPlacement,
    history?: ScrollHistory,
  ) => void;
  /** The page's one scroll to target, for callers past a chunk jump. */
  scrollToTarget: ScrollToTarget["scrollToTarget"];
  /** The reading position's one write path, for a scroll that names a chunk. */
  setActiveChunk: (chunkId: string) => void;
  /** The keyboard-shortcut jump: under the stack while focus mode is on. */
  jumpToChunkFromShortcut: (chunkId: string) => void;
  /** Ensure-open for row-target jumps; wayfinding jumps never call it. */
  openChunk: (chunkId: string) => void;
  jumpToGroup: (groupId: string, history?: ScrollHistory) => void;
  /** A keyboard jump to a group: scrolls and focuses the group heading. */
  jumpToGroupHeading: (groupId: string, history?: ScrollHistory) => void;
  toggleFocusMode: () => void;
  startReadThrough: () => void;
  /** Exit focus mode into the story view (the intent-bar scroll path). */
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
    exitChangesScope,
    position,
    viewStore,
  } = input;
  // Session/domain state lives in the per-brief Review Session store.
  const dispositions = useReviewSession((state) => state.dispositions);
  const dominants = useReviewSession((state) => state.dominants);
  const reclassifiedGroups = useReviewSession(
    (state) => state.reclassifiedGroups,
  );
  const reviewedChunks = useReviewSession((state) => state.reviewedChunks);
  const reviewComments = useReviewSession((state) => state.reviewComments);
  const submittedReviewIds = useReviewSession(
    (state) => state.submittedReviewIds,
  );
  const reviewOutcome = useReviewSession((state) => state.reviewOutcome);
  const actions = useReviewSessionActions();
  // RENDERED (grouped) order, not raw brief order, the StoryView lays chunks
  // out by group, so J/K must follow the same sequence.
  const readingOrderedChunks = useMemo(
    () => model.groups.flatMap((group) => group.chunks),
    [model.groups],
  );

  const chunkIds = useMemo(() => listChunkIds(model.groups), [model.groups]);
  const groupBoundaries = useMemo(
    () => groupStartIndexes(model.groups),
    [model.groups],
  );

  const openChunks = useStore(viewStore, (state) => state.openChunks);
  const focusMode = useStore(viewStore, (state) => state.focusMode);
  const shortcutsOpen = useStore(viewStore, (state) => state.shortcutsOpen);
  const { updateOpenChunks, setFocusMode, setShortcutsOpen } =
    viewStore.getState().actions;

  /** Ensure-open, never a toggle, row-target jumps (conversation threads,
   * revision rails, unresolved submit items) land INSIDE the diff, which
   * only exists on an open card. */
  const openChunk = useCallback(
    (chunkId: string) => {
      updateOpenChunks((current) =>
        current.has(chunkId) ? current : new Set(current).add(chunkId),
      );
    },
    [updateOpenChunks],
  );
  const { scrollToTarget } = useScrollToTarget({
    briefId,
    chunkWindows: chunkWindows ?? undefined,
    openChunk,
    inChangesScope: !compareViewFull,
    exitChangesScope,
  });

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
    updateOpenChunks((current) => {
      const next = new Set(current);
      const allCollapsed =
        supportingChunkIds.length > 0 &&
        supportingChunkIds.every((id) => !current.has(id));
      for (const id of supportingChunkIds) {
        if (allCollapsed) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }, [supportingChunkIds, updateOpenChunks]);
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
  // Publishes --focus-indicator-h so sticky chunk heads stack below the
  // pill; 0px whenever focus mode is off (pill unmounted).
  const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const setIndicatorHeight = (value: string) =>
      document.documentElement.style.setProperty("--focus-indicator-h", value);
    const el = focusIndicatorRef.current;
    if (!focusMode || !el) {
      setIndicatorHeight("0px");
      return;
    }
    const apply = () => setIndicatorHeight(`${el.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      setIndicatorHeight("0px");
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
  });
  const unresolvedItems = useMemo(() => {
    const remainderGroup = model.groups.find(
      (group) => group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER,
    );
    const remainderChunks = remainderGroup?.chunks ?? [];

    return deriveUnresolvedItems({
      chunks: brief.chunks,
      remainderChunks,
      flags: model.flags,
      dispositions,
      reviewedChunkIds: reviewedChunks,
      comments: reviewComments,
    });
  }, [
    brief.chunks,
    dispositions,
    model.flags,
    model.groups,
    reviewComments,
    reviewedChunks,
  ]);
  // Frozen snapshot + Receipt: the inputs the drawer renders.
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
      }),
    [
      briefId,
      dispositions,
      dominants,
      reclassifiedGroups,
      reviewComments,
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

  // Leaving focus mode unmounts its chrome; focus that sat on it lands on
  // the main landmark instead of the body.
  const wasFocusModeRef = useRef(focusMode);
  useEffect(() => {
    const leftFocusMode = wasFocusModeRef.current && !focusMode;
    wasFocusModeRef.current = focusMode;
    if (leftFocusMode && document.activeElement === document.body) {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
  }, [focusMode]);

  // The position has two write sources: scroll-spy (below) and explicit nav
  // (toggleChunk/jumpToChunk). Scroll-spy only runs on the full brief outside
  // focus mode.
  useScrollSpy(
    !focusMode && compareViewFull ? chunkIds : EMPTY_CHUNK_IDS,
    setActivePosition,
    readingLineOffset,
    briefId,
  );

  const toggleChunk = useCallback(
    (chunkId: string) => {
      updateOpenChunks((current) => toggleSetMember(current, chunkId));
      setActivePosition(chunkId);
    },
    [setActivePosition, updateOpenChunks],
  );

  const markReviewed = useCallback(
    (chunkId: string) => {
      const alreadyReviewed = reviewedChunksRef.current.has(chunkId);
      // Focus mode: checking collapses + advances (never wraps); un-checking
      // is a correction, reopen and stay put.
      if (focusModeRef.current) {
        if (alreadyReviewed) {
          actions.reviewChunk(chunkId);
          updateOpenChunks((current) => new Set(current).add(chunkId));
          return;
        }
        actions.reviewChunk(chunkId);
        updateOpenChunks((current) => {
          const next = new Set(current);
          next.delete(chunkId);
          return next;
        });
        const index = chunkIds.indexOf(chunkId);
        const next = index >= 0 ? chunkIds[index + 1] : undefined;
        if (next) {
          setActivePosition(next);
          scrollToTarget(
            { kind: ScrollTargetKinds.CHUNK, chunkId: next },
            SMOOTH_UNDER_STACK,
          );
        }
        return;
      }
      actions.reviewChunk(chunkId);
      updateOpenChunks((current) => {
        const next = new Set(current);
        next.delete(chunkId);
        return next;
      });
    },
    [
      actions,
      chunkIds,
      focusModeRef,
      scrollToTarget,
      reviewedChunksRef,
      setActivePosition,
      updateOpenChunks,
    ],
  );

  const jumpToChunk = useCallback(
    (
      chunkId: string,
      behavior: ScrollBehavior = "smooth",
      placement: ScrollPlacement = ScrollPlacements.VIEWPORT_TOP,
      history: ScrollHistory = ScrollHistories.NONE,
    ) => {
      setActivePosition(chunkId);
      // Focus mode must open the target, every other card is display:none,
      // so a collapsed target would show nothing. Outside focus mode a
      // collapsed card is the user's triage: wayfinding jumps (toc, group
      // stepper, risk attrs) scroll to it WITHOUT re-expanding.
      scrollToTarget(
        { kind: ScrollTargetKinds.CHUNK, chunkId },
        {
          motion: deriveScrollMotion(behavior),
          history,
          open: focusModeRef.current,
          placement,
        },
      );
    },
    [focusModeRef, scrollToTarget, setActivePosition],
  );
  // Plain handlers from here down: no consumer memoizes on their identity
  // (the memo boundaries live at ChunkCard/GroupCard, whose props stay the
  // stable callbacks above). closeShortcuts is the one exception below.
  const jumpToChunkFromShortcut = (chunkId: string) => {
    const focusActive =
      document.getElementById("main-content")?.dataset["zen"] === "on";
    const placement = focusActive
      ? ScrollPlacements.UNDER_STACK
      : ScrollPlacements.VIEWPORT_TOP;
    jumpToChunk(chunkId, "auto", placement);
  };

  const toggleFocusMode = () => {
    const entering = !focusModeRef.current;
    setFocusMode(entering);
    if (!entering) {
      return;
    }
    // Under the stack, required: the focus pill only mounts once `focusMode`
    // flips true, so the scroll must wait for it and rest below it or the
    // pill covers the chunk.
    const target = position.getState().activeChunkId ?? firstChunkId;
    if (!target) {
      return;
    }
    // Focus mode reads the active card; a collapsed one would show nothing.
    setActivePosition(target);
    scrollToTarget(
      { kind: ScrollTargetKinds.CHUNK, chunkId: target },
      { ...SMOOTH_UNDER_STACK, open: true },
    );
  };
  const toggleShortcuts = () =>
    setShortcutsOpen(!viewStore.getState().shortcutsOpen);
  // Stable: Modal's Escape-listener effect deps on `close`, an unstable
  // identity would re-bind a document listener on every session render
  // while the shortcuts modal is open.
  const closeShortcuts = useCallback(
    () => setShortcutsOpen(false),
    [setShortcutsOpen],
  );

  // Always starts at step 1, unlike Z/toggleFocus which re-anchors on the
  // active chunk. Under the stack: see toggleFocusMode.
  const startReadThrough = () => {
    if (!firstChunkId) {
      return;
    }
    setFocusMode(true);
    setActivePosition(firstChunkId);
    scrollToTarget(
      { kind: ScrollTargetKinds.CHUNK, chunkId: firstChunkId },
      { ...SMOOTH_UNDER_STACK, open: true },
    );
  };

  // The TOC bar jumps by Change-group; scroll to the group's first chunk.
  const jumpToGroup = useCallback(
    (groupId: string, history: ScrollHistory = ScrollHistories.NONE) => {
      const group = model.groups.find((candidate) => candidate.id === groupId);
      const target = group?.chunks[0];
      if (target) {
        jumpToChunk(
          target.id,
          "smooth",
          ScrollPlacements.VIEWPORT_TOP,
          history,
        );
      }
    },
    [jumpToChunk, model.groups],
  );

  // The section is in flow at every width where the card can be sticky, so
  // it is the target; the heading only takes focus. A parked jump runs once
  // the story pane renders, whose group card shows the heading outside focus
  // mode.
  const jumpToGroupHeading = useCallback(
    (groupId: string, history: ScrollHistory = ScrollHistories.NONE) => {
      const group = model.groups.find((candidate) => candidate.id === groupId);
      const target = group?.chunks[0];
      if (!target) {
        return;
      }
      const parks = !compareViewFull && history !== ScrollHistories.NONE;
      const headingShown = parks
        ? !focusModeRef.current
        : document.getElementById(deriveGroupHeadingId(groupId)) !== null;
      if (!headingShown) {
        jumpToChunk(
          target.id,
          "smooth",
          ScrollPlacements.VIEWPORT_TOP,
          history,
        );
        return;
      }

      setActivePosition(target.id);
      scrollToTarget(
        { kind: ScrollTargetKinds.GROUP, groupId },
        { ...SMOOTH_UNDER_STACK, focus: true, history },
      );
    },
    [
      compareViewFull,
      focusModeRef,
      jumpToChunk,
      scrollToTarget,
      model.groups,
      setActivePosition,
    ],
  );

  // The intent bar lives in the full-compare story view, so leave focus
  // mode first.
  const exitToStoryView = useCallback(() => {
    setFocusMode(false);
  }, [setFocusMode]);

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
    focusMode,
    focusIndicatorRef,
    openChunks,
    supportingCollapse,
    toggleCollapseSupporting,
    shortcutsOpen,
    toggleShortcuts,
    closeShortcuts,
    toggleChunk,
    markReviewed,
    jumpToChunk,
    scrollToTarget,
    setActiveChunk: setActivePosition,
    jumpToChunkFromShortcut,
    openChunk,
    jumpToGroup,
    jumpToGroupHeading,
    toggleFocusMode,
    startReadThrough,
    exitToStoryView,
  };
}
