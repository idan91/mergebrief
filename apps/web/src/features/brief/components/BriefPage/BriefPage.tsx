import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { Drawer } from "../../../../components/Drawer/Drawer";
import { Markdown } from "../../../../components/Markdown/Markdown";
import { useScrollSpy } from "../../../../hooks/useScrollSpy";
import { prefersReducedMotion } from "../../../../lib/motion";
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
import {
  ConversationSection,
  type ConversationPlan,
  type ThreadComposerWiring,
} from "../../../conversation/components/ConversationSection/ConversationSection";
import { buildInlineThreads } from "../../../conversation/digest";
import { reconcileOwnComments } from "../../../conversation/ownComments";
import type { ConversationResult } from "../../../conversation/queries";
import { ReceiptDrawer } from "../../../review/components/ReceiptDrawer/ReceiptDrawer";
import { SummaryPreview } from "../../../review/components/SummaryPreview/SummaryPreview";
import { buildReceipt } from "../../../review/receipt";
import type { SubmitReviewAction } from "../../../review/submit";
import { useReviewSubmit } from "../../../review/useReviewSubmit";
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
import type { ComparisonQuery } from "../../comparisonQuery";
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
  ComparisonMarks,
  LocalBriefSummary,
  RevisionNarrativeArtifact,
} from "../../types";
import { useKeyboardShortcuts } from "../../useKeyboardShortcuts";
import { buildBriefViewModel, type RiskFlag } from "../../viewModel";
import { RiskBadge } from "../Badge/RiskBadge";
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

/** Per-brief page over the LOCAL file-backed store: fetch, then render. */
export function BriefPage({
  artifacts,
  briefId,
  searchParams,
}: BriefPageProps) {
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  return (
    <BriefView
      artifacts={artifacts}
      brief={brief}
      briefId={briefId}
      searchParams={searchParams}
    />
  );
}

/** Typed placeholder for a plan slot that is absent — always `enabled: false`. */
function disabledComparisonQuery<T>(slot: string): ComparisonQuery<T> {
  return {
    queryKey: ["comparison-plan-disabled", slot],
    queryFn: () => Promise.reject(new Error("comparison query disabled")),
  };
}

/**
 * Injected comparison data source (BRIEF-19 4.1 — the DB path). When present
 * it REPLACES the local timeline derivation entirely: availability comes from
 * the plan and marks/narrative/delta fetch through its descriptors. Absent →
 * the local sidecar flow is unchanged.
 */
export interface BriefComparisonPlan {
  readonly previousBrief?: {
    readonly marks: ComparisonQuery<ComparisonMarks>;
    /** Present when a narrative artifact exists to fetch (may be a skip stub). */
    readonly narrative?: ComparisonQuery<RevisionNarrativeArtifact>;
    /**
     * The live raw span diff for this baseline → head (BRIEF-24 locked #7):
     * powers the Changes Only "Show raw diff" toggle. Same diff proxy, an
     * arbitrary span behind the gate — no API change.
     */
    readonly rawDiff?: ComparisonQuery<string>;
  };
  /** The personal checkpoint comparison (BRIEF-21) — offered iff marks exist. */
  readonly lastReview?: {
    readonly marks: ComparisonQuery<ComparisonMarks>;
    /** Absent = marks-only tier: the worker skipped the delta core. */
    readonly delta?: ComparisonQuery<Brief>;
    /** The live raw span diff for checkpoint → head (BRIEF-24 locked #7). */
    readonly rawDiff?: ComparisonQuery<string>;
  };
}

export interface BriefViewProps extends BriefPageProps {
  /** The already-fetched Brief to render (DB path: assembled client-side). */
  brief: Brief;
  comparisonPlan?: BriefComparisonPlan;
  /**
   * The DB route's submit transport (BRIEF-23). Absent on the local file
   * path — no GitHub identity there, Submit keeps its demo behavior.
   */
  submitReview?: SubmitReviewAction;
  /**
   * The DB route's live-conversation plan (BRIEF-25). Absent on the local
   * file path — no conversation section there.
   */
  conversation?: ConversationPlan;
  /**
   * Read-only posture on a historical revision (BRIEF-24, ADR 0019 #6): the
   * comment composer and Submit disable with this reason (the submit route
   * pins commit_id to the viewed head — a historical submit would post against
   * a stale commit). Absent → the head is live and writable.
   */
  readOnly?: { reason: string } | undefined;
  /**
   * The `?thread=` landing target (BRIEF-24 reads it): opens the conversation
   * section and lands on that thread. Absent → no auto-open.
   */
  conversationFocusThreadId?: number | undefined;
  /**
   * The DB route's unified revision/compare controls, rendered in the sticky
   * header's control slot (BRIEF-24 UX pass). Absent on the local path.
   */
  headerControls?: ReactNode | undefined;
}

/**
 * Source-agnostic review screen (BRIEF-19 PR 3.2): the caller supplies the
 * Brief — local file store or the DB read API. `briefId` keys the per-brief
 * Mind-Map session store; `artifacts` feeds the LOCAL timeline/comparisons
 * and may be empty (every comparison affordance then self-disables).
 */
export function BriefView({
  artifacts,
  brief,
  briefId,
  comparisonPlan,
  conversation,
  conversationFocusThreadId,
  headerControls,
  readOnly,
  searchParams,
  submitReview,
}: BriefViewProps) {
  const model = useMemo(() => buildBriefViewModel(brief), [brief]);
  return (
    <MindMapProvider briefId={briefId} model={model}>
      <BriefScreen
        artifacts={artifacts}
        brief={brief}
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        conversation={conversation}
        conversationFocusThreadId={conversationFocusThreadId}
        headerControls={headerControls}
        model={model}
        readOnly={readOnly}
        searchParams={searchParams}
        submitReview={submitReview}
      />
    </MindMapProvider>
  );
}

interface BriefScreenProps {
  artifacts: LocalBriefSummary[];
  brief: Brief;
  briefId: string;
  comparisonPlan?: BriefComparisonPlan | undefined;
  model: ReturnType<typeof buildBriefViewModel>;
  searchParams: BriefSearchParams;
  submitReview?: SubmitReviewAction | undefined;
  conversation?: ConversationPlan | undefined;
  readOnly?: { reason: string } | undefined;
  /**
   * The `?thread=` landing target (BRIEF-24 reads it): opens the conversation
   * section and lands on that thread. Absent → no auto-open.
   */
  conversationFocusThreadId?: number | undefined;
  headerControls?: ReactNode | undefined;
}

function BriefScreen({
  artifacts,
  brief,
  briefId,
  comparisonPlan,
  model,
  searchParams,
  conversation,
  conversationFocusThreadId,
  headerControls,
  readOnly,
  submitReview,
}: BriefScreenProps) {
  const timeline = useMemo(
    () => buildBriefTimeline(artifacts, briefId),
    [artifacts, briefId],
  );
  const availability = useMemo(
    () =>
      comparisonPlan === undefined
        ? comparisonAvailability(timeline.selectedPoint)
        : {
            previousBrief: comparisonPlan.previousBrief !== undefined,
            lastReview: comparisonPlan.lastReview !== undefined,
          },
    [comparisonPlan, timeline.selectedPoint],
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

  // Marks/narrative/delta resolve from ONE source: the injected plan (DB
  // path) or the local sidecar ids. Both query sets exist as hooks; `enabled`
  // picks. The plan's marks descriptor follows the ACTIVE baseline (BRIEF-21
  // adds last-review); narrative stays previous-brief-only, delta
  // last-review-only — mirroring the local id derivation above.
  const planPrevious = comparisonPlan?.previousBrief;
  const planLastReview = comparisonPlan?.lastReview;
  const activePlanSlot =
    activeCompare === "previous-brief"
      ? planPrevious
      : activeCompare === "last-review"
        ? planLastReview
        : undefined;
  const planActive =
    comparisonPlan !== undefined && activePlanSlot !== undefined;
  // The raw span diff descriptor for the ACTIVE compare baseline (BRIEF-24
  // locked #7): previous-brief → previous head's diff, last-review → the
  // checkpoint's — each slot carries its own baseline. Absent on the local
  // path (no plan) and while Compare is off → the Changes Only toggle hides.
  const activeRawSpanDiff =
    activeCompare === "previous-brief"
      ? planPrevious?.rawDiff
      : activeCompare === "last-review"
        ? planLastReview?.rawDiff
        : undefined;
  const localMarks = useQuery({
    ...localComparisonMarksQueryOptions(marksId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(marksId),
  });
  const planMarks = useQuery({
    ...(activePlanSlot?.marks ??
      disabledComparisonQuery<ComparisonMarks>("marks")),
    enabled: planActive,
  });
  const marks =
    (comparisonPlan === undefined ? localMarks.data : planMarks.data) ?? null;
  const localNarrative = useQuery({
    ...localRevisionNarrativeQueryOptions(narrativeId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(narrativeId),
  });
  const planNarrative = useQuery({
    ...(planPrevious?.narrative ??
      disabledComparisonQuery<RevisionNarrativeArtifact>("narrative")),
    enabled:
      planActive &&
      activeCompare === "previous-brief" &&
      planPrevious?.narrative !== undefined,
  });
  const narrativeArtifact: RevisionNarrativeArtifact | null =
    (comparisonPlan === undefined ? localNarrative.data : planNarrative.data) ??
    null;
  const localDelta = useQuery({
    ...localBriefQueryOptions(deltaId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(deltaId),
  });
  const planDelta = useQuery({
    ...(planLastReview?.delta ?? disabledComparisonQuery<Brief>("delta")),
    enabled:
      planActive &&
      activeCompare === "last-review" &&
      planLastReview?.delta !== undefined,
  });
  const delta =
    (comparisonPlan === undefined ? localDelta.data : planDelta.data) ?? null;

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
        submittedReviewIds,
        replyDrafts,
      }),
    [
      briefId,
      checkedItems,
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
  const jumpToConversation = useCallback(() => {
    setConversationOpen(true);
    // The heading exists regardless of expansion; focus + scroll land on it
    // after the expand renders.
    window.requestAnimationFrame(() => {
      const heading = document.getElementById("conversation-heading");
      if (!(heading instanceof HTMLElement)) return;
      heading.scrollIntoView({ block: "start" });
      heading.focus({ preventScroll: true });
    });
  }, []);
  useKeyboardShortcuts({
    chunkIds,
    groupBoundaries,
    activeChunkId,
    disabled: shortcutsDisabled,
    focusModeActive: focusMode,
    jumpToChunk: jumpToChunkFromShortcut,
    toggleFocusMode,
    toggleHelp: toggleShortcuts,
    jumpToConversation:
      conversation !== undefined ? jumpToConversation : undefined,
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

  const openCommentComposer = useCallback(
    (anchor: CommentAnchor) => {
      // Read-only posture (BRIEF-24): a historical head cannot take new draft
      // comments (the submit would pin a stale commit_id). Surface the reason
      // through the page live region instead of opening the composer.
      if (readOnly !== undefined) {
        setToast(readOnly.reason);
        return;
      }
      setActiveCommentAnchor(anchor);
    },
    [readOnly],
  );
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
  // The DB submit flow (BRIEF-23): available only when the route injected a
  // transport AND the viewer is in reviewer mode — the author mode and the
  // local demo path keep the mock toast below.
  //
  // Announce via clear-then-set (two ticks): an identical repeat message
  // still produces a DOM change — re-announced by the live region — and
  // restarts the [toast]-keyed hide timer instead of dying on the first
  // submit's timeout.
  const announceSubmit = useCallback((message: string) => {
    setToast("");
    window.setTimeout(() => setToast(message), 30);
  }, []);
  // The conversation section collapses to its summary header by default —
  // it sits ABOVE the change groups (Idan, smoke feedback 2026-07-08), so
  // expanded-by-default would push the Brief down. The C shortcut expands.
  // A `?thread=` landing (BRIEF-24) opens it so its target is reachable —
  // including when the param arrives via in-app navigation AFTER mount (an
  // initializer alone would leave the section collapsed; codex round 1). The
  // user can still collapse it afterwards: the effect re-fires only when the
  // TARGET changes, not on every render (navigation event, not state sync).
  const [conversationOpen, setConversationOpen] = useState(
    conversationFocusThreadId !== undefined,
  );
  useEffect(() => {
    if (conversationFocusThreadId !== undefined) setConversationOpen(true);
  }, [conversationFocusThreadId]);
  // Inline conversation threads (BRIEF-25): the same query the section runs
  // (react-query dedupes on the key), disabled on the local path.
  const queryClient = useQueryClient();
  const conversationQuery = useQuery({
    ...(conversation?.queryOptions ??
      disabledComparisonQuery<ConversationResult>("conversation")),
    enabled: conversation !== undefined,
  });
  const conversationData =
    conversationQuery.data?.kind === "ready"
      ? conversationQuery.data.conversation
      : undefined;
  const conversationByChunk = useMemo(() => {
    if (conversationData === undefined) return undefined;
    // Ownership is the review-id join alone — local comments feed only the
    // pointer/resurrection outputs, so they stay OUT of these deps: a comment
    // save/toggle must not rebuild every chunk's inline rows and bust the
    // ChunkCard memo boundary (perf review).
    const ownThreadIds = reconcileOwnComments(
      [],
      conversationData.threads,
      submittedReviewIds,
    ).ownThreadIds;
    return buildInlineThreads({
      conversation: conversationData,
      chunks: readingOrderedChunks,
      ownThreadIds,
    });
  }, [conversationData, readingOrderedChunks, submittedReviewIds]);
  // Drafts read through a ref: the wiring object's identity stays stable
  // across draft syncs, so it never busts ChunkCard's memo (perf review).
  const replyDraftsRef = useRef(replyDrafts);
  replyDraftsRef.current = replyDrafts;
  const conversationComposer = useMemo<ThreadComposerWiring | undefined>(
    () =>
      conversation === undefined
        ? undefined
        : {
            briefId,
            post: conversation.postReply,
            announce: announceSubmit,
            getDraft: (threadId: number) =>
              replyDraftsRef.current[String(threadId)] ?? "",
            setDraft: (threadId: number, body: string) =>
              actions.setReplyDraft(threadId, body),
            onPosted: () =>
              void queryClient.invalidateQueries({
                queryKey: conversation.queryOptions.queryKey,
              }),
          },
    [actions, announceSubmit, briefId, conversation, queryClient],
  );
  // Which groups carry conversation threads — the TocBar's markers.
  const conversationGroupIds = useMemo(() => {
    if (conversationByChunk === undefined || conversationByChunk.size === 0)
      return undefined;
    const ids = new Set<string>();
    for (const group of model.groups) {
      if (group.chunks.some((chunk) => conversationByChunk.has(chunk.id))) {
        ids.add(group.id);
      }
    }
    return ids;
  }, [conversationByChunk, model.groups]);
  // The conversation jump contract (BRIEF-25): move focus WITH the scroll
  // and flash the target (reduced-motion respected in CSS). When the digest
  // hands us a row target, land on the thread's OWN row inside the diff —
  // the chunk top is only the fallback (bot threads aggregate at the chunk;
  // a resolved bot thread has no row at all).
  // One live flash timer: a repeat jump inside the window must RESTART the
  // flash (remove → reflow → re-add; a matching attribute never restarts a
  // CSS animation) instead of letting the first jump's timer cut it short
  // (Fable review).
  const flashTimerRef = useRef<{ el: HTMLElement; timer: number } | null>(null);
  const flashConversationTarget = useCallback((target: HTMLElement) => {
    const pending = flashTimerRef.current;
    if (pending !== null) {
      window.clearTimeout(pending.timer);
      pending.el.removeAttribute("data-conversation-flash");
      flashTimerRef.current = null;
    }
    target.removeAttribute("data-conversation-flash");
    window.requestAnimationFrame(() => {
      target.setAttribute("data-conversation-flash", "");
      flashTimerRef.current = {
        el: target,
        timer: window.setTimeout(() => {
          target.removeAttribute("data-conversation-flash");
          flashTimerRef.current = null;
        }, 1600),
      };
    });
  }, []);
  const jumpToChunkFromConversation = useCallback(
    (chunkId: string, target?: { rowId: string; threadId: number }) => {
      const landOnChunk = () => {
        const el = document.getElementById(chunkId);
        if (!(el instanceof HTMLElement)) return;
        el.focus({ preventScroll: true });
        flashConversationTarget(el);
      };
      if (target === undefined) {
        jumpToChunk(chunkId);
        window.requestAnimationFrame(landOnChunk);
        return;
      }
      // Instant coarse jump (expands the chunk), then settle on the row. The
      // row renders only once the chunk is open, so poll a few frames before
      // conceding to the chunk top.
      jumpToChunk(chunkId, "auto");
      let attempts = 8;
      const landOnRow = () => {
        const row = document.querySelector(
          `[data-conversation-thread="${target.threadId}"]`,
        );
        if (row instanceof HTMLElement) {
          // Same reduced-motion gate as every other programmatic scroll
          // (codex round 2 — the section's landing twin).
          row.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "center",
          });
          const disclosure = row.querySelector("button");
          (disclosure ?? row).focus({ preventScroll: true });
          flashConversationTarget(row);
          return;
        }
        attempts -= 1;
        if (attempts > 0) window.requestAnimationFrame(landOnRow);
        else landOnChunk();
      };
      window.requestAnimationFrame(landOnRow);
    },
    [flashConversationTarget, jumpToChunk],
  );
  const submitFlow = useReviewSubmit({
    action: submitReview,
    briefId,
    outcome: reviewOutcome,
    comments: reviewComments,
    receipt,
    markSubmitted: (ids) => actions.markCommentsSubmitted(ids),
    recordSubmittedReview: (reviewId) =>
      actions.recordSubmittedReview(reviewId),
    announce: announceSubmit,
    closeReceipt,
    resetOutcome: () => actions.setOutcome("comment"),
  });
  const liveSubmit = submitFlow.available && reviewMode === "reviewer";
  const submitReceipt = useCallback(() => {
    // Read-only posture (BRIEF-24): the submit control disables focusably with
    // the reason (below) — this guards the click path itself.
    if (readOnly !== undefined) {
      announceSubmit(readOnly.reason);
      return;
    }
    if (liveSubmit) {
      submitFlow.submit();
      return;
    }
    setReceiptOpen(false);
    setToast(
      reviewMode === "author"
        ? "Mockup flow — this would mark the PR ready for review after self-review."
        : "Mockup flow — submit posts your review natively to GitHub with one signature line linking this receipt.",
    );
  }, [announceSubmit, liveSubmit, readOnly, reviewMode, submitFlow]);
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
        /* DB path (plan present): the standalone preview route only resolves
           LOCAL brief ids — open the in-page drawer instead. */
        openSummaryPreviewDrawer={
          comparisonPlan === undefined ? undefined : openSummaryPreview
        }
        controlsSlot={headerControls}
      />
      {/* Focus mode (Z) strips the page chrome and centers a single chunk in
          a narrow reading column — the visible payoff of "focus". The banner
          is a sibling of <main> (not inside it) so it is a true full-bleed
          strip like the top bar; sticky chunk headers stack below it via the
          measured --focus-banner-h. data-focus-banner sits on the strip:
          focusScrollOffset() must measure it whole, padding included. */}
      {focusMode ? (
        <div
          className={styles["focusBannerWrap"]}
          data-focus-banner=""
          ref={focusBannerRef}
          role="status"
        >
          <div className={styles["focusBanner"]}>
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
        </div>
      ) : null}
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
            {model.flags.length > 0 ? (
              <div className={styles["summaryRisk"]} data-summary-risk="">
                <h4 className={styles["summaryRiskHeading"]}>
                  Risk surface{" "}
                  <span className={styles["summaryRiskNote"]}>
                    attributes, not verdicts
                  </span>
                </h4>
                <div className={styles["summaryRiskChips"]}>
                  {[...new Set(model.flags.map((flag) => flag.attr))].map(
                    (attr) => (
                      <RiskBadge key={attr}>{attr}</RiskBadge>
                    ),
                  )}
                </div>
              </div>
            ) : null}
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
            rawSpanDiff={activeRawSpanDiff}
          />
        ) : (
          <>
            {viewMode === "story" && !focusMode ? (
              <GroupTocBar
                activeGroupId={activeGroupId}
                conversationGroupIds={conversationGroupIds}
                groups={model.groups}
                jumpToGroup={jumpToGroup}
              />
            ) : null}

            {conversation !== undefined ? (
              <ConversationSection
                announce={announceSubmit}
                briefId={briefId}
                chunks={readingOrderedChunks}
                focusThreadId={conversationFocusThreadId}
                jumpToChunk={jumpToChunkFromConversation}
                localComments={reviewComments}
                markCommentsSubmitted={(ids) =>
                  actions.markCommentsSubmitted(ids)
                }
                open={conversationOpen}
                onToggle={() => setConversationOpen((current) => !current)}
                plan={conversation}
                replyDrafts={replyDrafts}
                setReplyDraft={(threadId, body) =>
                  actions.setReplyDraft(threadId, body)
                }
                submittedReviewIds={submittedReviewIds}
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
                composerDisabledReason={readOnly?.reason}
                conversationByChunk={conversationByChunk}
                conversationComposer={conversationComposer}
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
        submitPending={
          liveSubmit && readOnly === undefined ? submitFlow.pending : false
        }
        submitBlockedReason={
          readOnly?.reason ??
          (liveSubmit ? submitFlow.blockedReason : undefined)
        }
        submitError={
          liveSubmit && readOnly === undefined ? submitFlow.error : null
        }
        submitNote={liveSubmit ? submitFlow.note : null}
      />
      <SummaryPreviewDrawer
        brief={brief}
        mode={reviewMode}
        open={summaryPreviewOpen}
        snapshot={snapshot}
        close={closeSummaryPreview}
        setOutcome={(outcome) => actions.setOutcome(outcome)}
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
