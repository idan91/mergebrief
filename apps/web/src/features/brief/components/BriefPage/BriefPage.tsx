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
import {
  postCommentBlockedReason,
  type CommentAnchor,
  type ReviewComment,
} from "../../../review/comments";
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
import type { MarkReadyAction } from "../../../pulls/markReady";
import {
  applySettledPosts,
  beginInFlightPost,
  commitPostedComment,
  endInFlightPost,
  recordFailedPost,
  recordPostNotice,
  useInFlightPosts,
  type PostCommentResult,
} from "../../../pulls/postComment";
import { MarkReadyModal } from "../../../pulls/components/MarkReadyModal/MarkReadyModal";
import { useMarkReady } from "../../../pulls/useMarkReady";
import { buildBriefTimeline } from "../../timeline";
import type {
  Brief,
  ComparisonMarks,
  LocalBriefSummary,
  RevisionNarrativeArtifact,
} from "../../types";
import { useKeyboardShortcuts } from "../../useKeyboardShortcuts";
import {
  buildAttributeRail,
  buildBriefViewModel,
  splitSummaryAtChangelog,
  type RiskFlag,
} from "../../viewModel";
import type { RepoConfigContext } from "../../repoConfig";
import { ChangesOnlyView } from "../ChangesOnlyView/ChangesOnlyView";
import { ConcernView } from "../ConcernView/ConcernView";
import { DeltaContext } from "../DeltaContext/DeltaContext";
import { AttributeJumpRail } from "../AttributeJumpRail/AttributeJumpRail";
import { IntentBar, type IntentBarHandle } from "../IntentBar/IntentBar";
import { GroupTocBar } from "../GroupTocBar/GroupTocBar";
import { Header, type LayoutMode, type ViewMode } from "../Header/Header";
import { ReadThroughProgress } from "../ReadThroughProgress/ReadThroughProgress";
import { ShortcutsModal } from "../ShortcutsModal/ShortcutsModal";
import { StoryView } from "../StoryView/StoryView";
import styles from "./BriefPage.module.scss";

const EMPTY_CHUNK_IDS: string[] = [];

/** Read by the live region when an external draft-flip closes reviewer overlays. */
export const OWN_DRAFT_ENTRY_ANNOUNCEMENT =
  "This pull request was converted to a draft. You're now viewing your own draft — review submission unlocks once it's marked ready for review.";

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

/**
 * Own-draft state wiring (BRIEF-43, ADR 0031): injected by the DB route ONLY
 * while `draft && viewerIsAuthor` holds on the PrView (derived at read time,
 * single source: `features/pulls/ownDraft`). Present → the screen labels the
 * state (self-review chip), hides the submit/receipt machinery, renders flags
 * as a read-only mirror, and puts "Mark ready for review" in the terminal-
 * action slot. Absent (local path, any reviewer view) → nothing changes.
 */
export interface OwnDraftPlan {
  /**
   * POSTs mark-ready; on success it awaits the pr-view invalidation, so the
   * own-draft UI stays stable until the refreshed PrView actually flips.
   *
   * ABSENT while a historical revision is in view: the soft gate lists the
   * rendered Brief's flags and the contract is "ALL current-head flags", so
   * the action (and the gate with it) only exists on the current head. The
   * CTA then stays focusable and a click announces why (the BRIEF-24
   * disabled-with-reason pattern).
   */
  readonly markReady?: MarkReadyAction;
  /**
   * Posts a staged draft comment NOW as a standalone inline review comment
   * (per-comment post-now, ADR 0031). Anchors from the comment's chunk-region
   * data; `commit_id` is pinned to the viewed head by the route. ABSENT on the
   * same terms as `markReady` — only while the CURRENT head is in view (a
   * historical/advanced span would pin a stale commit, so the composer is
   * already read-only there); its absence hides the Post affordance.
   */
  readonly postComment?: (
    anchor: CommentAnchor,
    body: string,
  ) => Promise<PostCommentResult>;
}

/** Announced when the CTA is used while a historical revision is in view. */
export const MARK_READY_HISTORICAL_REASON =
  "You're viewing an earlier revision. Switch to the latest revision to mark this pull request ready for review.";

/** Announced when a head advance closes the open pre-ready check. */
export const MARK_READY_GATE_CLOSED_REASON =
  "This pull request has newer commits — switch to the latest revision to mark it ready for review.";

/** Announced when the own-draft state ends while the pre-ready check is open. */
export const MARK_READY_EXIT_ANNOUNCEMENT =
  "This pull request is now ready for review — the pre-ready check closed.";

/** Toast copy for per-comment post-now (BRIEF-43): failures always keep the draft. */
export const POST_COMMENT_COPY = {
  posted: "Comment posted to GitHub.",
  unauthorized:
    "Your GitHub session expired — sign in again to post this comment.",
  notFound: "This pull request is no longer accessible on GitHub.",
  stale:
    "The pull request has newer commits — reload to post this comment against the current diff.",
  // A deterministic route reject: retrying the SAME draft can never succeed
  // (unlike `upstream`), so this copy asks for an edit, never a plain retry.
  invalid:
    "This comment couldn't be posted as sent — edit the draft and post again.",
  upstream:
    "GitHub rejected the request or is unreachable — your draft is kept, try again shortly.",
  // Deliberately INDETERMINATE (useReviewSubmit's discipline): the catch can
  // land AFTER the POST reached GitHub (connection drop mid-response,
  // malformed 201) — with the draft never flipped, a confident retry prompt
  // could double-post, and the still-draft record would re-ship on the next
  // Submit review on top of that.
  failed:
    "Something went wrong posting this comment — it may or may not have posted. Check the pull request on GitHub before retrying.",
  // Blocks Submit review while any post-now is settling (same-tab re-ship
  // window: the payload capture would ship the still-draft comment, and the
  // 201 would flip it only after the review re-shipped it).
  submitWhilePosting:
    "A comment is still posting to GitHub — wait for it to finish before submitting the review.",
  // The symmetric block: a Submit review in flight already CAPTURED the
  // drafts, so posting one now would double-post it when the review lands.
  postWhileSubmitting:
    "A review is being submitted — wait for it to finish before posting this comment.",
} as const;

/**
 * How a single batch post ended (reviewer rounds 2–3): every value except
 * `posted`/`indeterminate` is a DETERMINISTIC stop-cause — the comment
 * definitively did NOT post — carried granularly because in a batch the
 * per-comment copy is suppressed and the summary is the ONLY message, so it
 * must give the cause's own recovery (round 3 #2):
 * - `rejected`   — guard rejection or invalid 400: edit the draft;
 * - `unauthorized` — session expired: sign in again;
 * - `stale`      — head advanced under the pinned commit: reload;
 * - `not-found`  — the PR is no longer accessible;
 * - `indeterminate` — failure AROUND the write (thrown mid-flight, upstream
 *   unreachable, duplicate in-flight): may or may not have reached GitHub.
 */
export type PostDraftOutcome =
  | "posted"
  | "rejected"
  | "unauthorized"
  | "stale"
  | "not-found"
  | "indeterminate";

/**
 * Batch "post my drafts, then mark ready" failure toast (BRIEF-43 follow-up).
 * Honest counts prefix and the explicit NOT-marked-ready suffix on every
 * variant; the guidance branches on the stop-cause (round 3 #2). The house
 * indeterminate rule ("may or may not have posted — check GitHub") applies
 * only to around-the-write failures, where a confident "not posted" would
 * invite a double-posting retry.
 */
export function markReadyBatchFailureCopy(
  posted: number,
  total: number,
  cause: Exclude<PostDraftOutcome, "posted">,
): string {
  const counts = `Posted ${String(posted)} of ${String(total)}.`;
  const suffix = "The PR was NOT marked ready.";
  switch (cause) {
    case "rejected":
      return `${counts} One comment was rejected before posting — edit the draft and try again. ${suffix}`;
    case "unauthorized":
      return `${counts} One comment could not be posted — your GitHub session expired, sign in again to continue. ${suffix}`;
    case "stale":
      return `${counts} One comment could not be posted — the pull request has newer commits, reload to post against the current diff. ${suffix}`;
    case "not-found":
      return `${counts} One comment could not be posted — this pull request is no longer accessible on GitHub. ${suffix}`;
    case "indeterminate":
      return `${counts} One comment may or may not have posted — check GitHub before retrying. ${suffix}`;
  }
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
  /** Own-draft state plan (BRIEF-43); absent on every plain reviewer view. */
  ownDraft?: OwnDraftPlan | undefined;
  /**
   * Repo-config snapshot for this span (BRIEF-52): attribute source markers,
   * de-emphasis weights, floor co-fire. Absent/null = render as if no repo
   * config exists (local path, pre-BRIEF-52 rows, failed context fetch).
   */
  repoConfig?: RepoConfigContext | null | undefined;
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
  ownDraft,
  readOnly,
  repoConfig,
  searchParams,
  submitReview,
}: BriefViewProps) {
  const model = useMemo(
    () => buildBriefViewModel(brief, repoConfig),
    [brief, repoConfig],
  );
  return (
    <MindMapProvider briefId={briefId} model={model}>
      <BriefScreen
        artifacts={artifacts}
        brief={brief}
        repoConfig={repoConfig}
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        conversation={conversation}
        conversationFocusThreadId={conversationFocusThreadId}
        headerControls={headerControls}
        model={model}
        ownDraft={ownDraft}
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
  repoConfig?: RepoConfigContext | null | undefined;
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
  ownDraft?: OwnDraftPlan | undefined;
}

function BriefScreen({
  artifacts,
  brief,
  repoConfig,
  briefId,
  comparisonPlan,
  model,
  searchParams,
  conversation,
  conversationFocusThreadId,
  headerControls,
  ownDraft,
  readOnly,
  submitReview,
}: BriefScreenProps) {
  // The attribute jump-rail is the single risk-surface summary (ADR 0032
  // #11); the summary section carries no risk chip lane of its own.
  const attributeRail = useMemo(() => buildAttributeRail(model), [model]);
  // BRIEF-4: two-column summary on wide containers — split at the optional
  // "## Changelog" h2. No changelog → single-column render, unchanged DOM.
  const summaryParts = splitSummaryAtChangelog(brief.summary);
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
  const [selectedRiskFlags, setSelectedRiskFlags] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [summaryPreviewOpen, setSummaryPreviewOpen] = useState(false);
  const [preSubmitOpen, setPreSubmitOpen] = useState(false);
  // The mark-ready soft gate (BRIEF-43) — own-draft state only.
  const [markReadyGateOpen, setMarkReadyGateOpen] = useState(false);
  // Opt-in batch post-then-ready (BRIEF-43 follow-up): the gate's checkbox
  // state (default UNCHECKED — posting is an outward write), and the running
  // batch's progress that pending-labels the confirm button ("Posting 2 of 3…").
  const [postDraftsOnReady, setPostDraftsOnReady] = useState(false);
  const [markReadyBatch, setMarkReadyBatch] = useState<{
    current: number;
    total: number;
  } | null>(null);
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

  // Own-draft state (BRIEF-43): the plan's presence IS the state — see the
  // block around `markReadyFlow` below.
  const ownDraftActive = ownDraft !== undefined;
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
    markReadyGateOpen ||
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

  // The mark-ready soft gate (BRIEF-54 PR 4) reaches the expanded intent bar
  // through this handle; null when the Brief carries no intentCheck.
  const intentBarRef = useRef<IntentBarHandle>(null);

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
  // transport — the local demo path keeps the mock toast below.
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
  // Post-now in-flight tracking (BRIEF-43) — the MODULE-LEVEL registry's
  // per-brief view, subscribed here (above the submit flow, which consumes
  // it). Module state, not component state: a same-tab remount with the same
  // briefId (historical-revision round trip) resets component state while
  // the fetch closure survives — the registry keeps the lockdown and the
  // submit block alive across it. See `postDraftComment` below.
  const postingCommentIds = useInFlightPosts(briefId);
  // Drain settled posts into THIS mount (reviewer rounds 7/8): the settling
  // closure captured the store AND toast of the mount that STARTED the post —
  // after a same-tab remount both are orphans, so the flip must apply through
  // whichever store is live at settle time, and EVERY outcome's copy (the
  // indeterminate failure warning above all) must reach the live region that
  // is actually on screen. Runs on mount (drains a settle that landed while
  // no screen was up) and on every in-flight change (a settle notifies the
  // subscription above, re-rendering us right after) — flipping the new
  // store BEFORE its next whole-state flush can clobber the durable snapshot
  // flip, and restoring the "yours" reconciliation join key. Synchronizing
  // with an external system (the module registry), not deriving state — an
  // effect is the right tool.
  useEffect(() => {
    applySettledPosts(briefId, actions, announceSubmit);
  }, [actions, announceSubmit, briefId, postingCommentIds]);
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
    // Same-tab re-ship window (reviewer round 5): a post-now still settling
    // when the own-draft state exits (ready flip mid-request) is invisible to
    // the payload capture — the review would ship the still-draft comment and
    // the 201 would flip it only afterwards, a duplicate on GitHub. Submit
    // blocks (reason + hard guard) until every post settles.
    blockedExternally:
      postingCommentIds.size > 0
        ? POST_COMMENT_COPY.submitWhilePosting
        : undefined,
  });
  const liveSubmit = submitFlow.available;
  // Primitive binding: the post path guards on it (a Submit in flight already
  // captured the drafts — posting one now would double-post when the review
  // lands), and the memoized card tree receives it as the Post block reason.
  const submitPending = submitFlow.pending;
  // Own-draft state (BRIEF-43, ADR 0031): the plan's presence IS the state —
  // derived at read time by the route (draft && viewerIsAuthor), never a
  // self-declared toggle.
  // While active: submit/receipt machinery is hidden (not broken), flags are a
  // read-only mirror, and the terminal-action slot holds Mark ready for
  // review. When the refreshed PrView flips draft=false (mark-ready here, or
  // ready-elsewhere via the pr-view poll), `ownDraft` turns undefined and the
  // affordances vanish — the reviewer view below is already fully wired.
  // (`ownDraftActive` itself is derived earlier, next to the progress calc.)
  const markReadyFlow = useMarkReady({
    action: ownDraft?.markReady,
    announce: announceSubmit,
  });
  // Entering the own-draft state closes every reviewer overlay. The overlays
  // UNMOUNT while the state holds, but their open flags are plain local
  // state — left set, they would keep `shortcutsDisabled` stuck true for the
  // whole session (dead J/K/Z/?/C with nothing visible) and resurrect the
  // overlay the moment the PR is marked ready. A PrView can flip INTO
  // own-draft mid-session (converted to draft on GitHub under an open
  // overlay), so this is a real path, not just belt-and-braces.
  //
  // Focus rescue: by the time the effect runs, this render already unmounted
  // the overlays — a focus that lived inside one was silently dropped on
  // <body> (an unmounting element fires no blur). The overlay-open snapshot
  // rides a latest-ref (this render's values — the resets below only land
  // next render), and orphaned focus is re-homed on the terminal-slot CTA,
  // mirroring the Header's slot-continuity, with the live region explaining
  // why the screen just changed.
  const overlayWasOpenRef = useLatestRef(
    receiptOpen ||
      summaryPreviewOpen ||
      preSubmitOpen ||
      dismissTarget !== null ||
      evidenceTarget !== null,
  );
  // This render's gate-open snapshot — consumed by the exit branch below and
  // by the mid-gate head-advance effect further down.
  const gateOpenRef = useLatestRef(markReadyGateOpen);
  useEffect(() => {
    if (!ownDraftActive) {
      // Leaving the own-draft state (mark-ready here or ready-elsewhere)
      // closes the soft gate the same way entering closes the reviewer
      // overlays: the modal unmounts with the state, but a left-set open
      // flag would keep `shortcutsDisabled` stuck true and resurrect the
      // gate if the PR converts back to draft later. If the gate was OPEN at
      // exit, its unmount also dropped the focus it held — rescue it onto
      // the terminal slot (now Receipt) and say why the modal vanished, the
      // entry path's mirror.
      setMarkReadyGateOpen(false);
      if (gateOpenRef.current) {
        const activeAtExit = document.activeElement;
        if (activeAtExit === null || activeAtExit === document.body) {
          document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
        }
        announceSubmit(MARK_READY_EXIT_ANNOUNCEMENT);
      }
      return;
    }
    const active = document.activeElement;
    if (
      overlayWasOpenRef.current &&
      (active === null || active === document.body)
    ) {
      document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
      announceSubmit(OWN_DRAFT_ENTRY_ANNOUNCEMENT);
    }
    setReceiptOpen(false);
    setSummaryPreviewOpen(false);
    setPreSubmitOpen(false);
    setDismissTarget(null);
    setEvidenceTarget(null);
  }, [announceSubmit, gateOpenRef, overlayWasOpenRef, ownDraftActive]);
  // The soft gate (ADR 0009 #3 per ADR 0031): the modal shows iff the current
  // head's Brief carries risk flags — zero flags skips it entirely and the
  // CTA acts directly. The unposted-drafts reminder rides the modal only.
  const unpostedDraftComments = useMemo(
    () => reviewComments.filter((comment) => comment.status === "draft"),
    [reviewComments],
  );
  const markReadyAvailable = ownDraft?.markReady !== undefined;
  // The gate closes whenever its ACTION goes away while the state holds: the
  // author pushes mid-gate, the poll advances meta.headSha, `currentHead`
  // flips and the route withholds `markReady` WITHOUT a remount (the span
  // keys the mount). The modal unmounts via its mount condition, but the
  // open flag is plain local state — left set, `shortcutsDisabled` sticks
  // true for the session and the focus the unmounting modal held drops to
  // <body> silently. Same rescue + announcement pattern as the own-draft
  // entry path. (The state-EXIT reset lives in the entry effect above, which
  // also declares `gateOpenRef`.)
  useEffect(() => {
    if (!ownDraftActive || markReadyAvailable) return;
    if (!gateOpenRef.current) return;
    setMarkReadyGateOpen(false);
    const active = document.activeElement;
    if (active === null || active === document.body) {
      document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
    }
    announceSubmit(MARK_READY_GATE_CLOSED_REASON);
  }, [announceSubmit, gateOpenRef, markReadyAvailable, ownDraftActive]);
  const requestMarkReady = useCallback(() => {
    // Historical revision in view: the action (and gate) don't exist here —
    // the CTA stays focusable and the click explains itself through the page
    // live region (BRIEF-24 disabled-with-reason pattern).
    if (!markReadyAvailable) {
      announceSubmit(MARK_READY_HISTORICAL_REASON);
      return;
    }
    // In-flight guard for the GATE path: the CTA is aria-disabled (not hard
    // disabled) while pending, so a click still lands here — without this it
    // would reopen the gate over the running mutation, whose "Mark ready
    // anyway" then silently no-ops against the flow's inFlight ref.
    if (markReadyFlow.pending) return;
    // The gate opens for risk flags OR unposted drafts (owner amendment to
    // the Q4 zero-flag bypass): the batch expectation is global — a
    // zero-flag brief with drafts staged must still offer the post-my-drafts
    // checkbox, or the drafts silently stay local while the PR goes ready
    // (live bug, PR 9 test). Direct mark-ready only when BOTH are zero.
    if (model.flags.length > 0 || unpostedDraftComments.length > 0) {
      // Open the gate with the post-drafts checkbox reset to unchecked.
      setPostDraftsOnReady(false);
      setMarkReadyGateOpen(true);
      return;
    }
    markReadyFlow.markReady();
  }, [
    announceSubmit,
    markReadyAvailable,
    markReadyFlow,
    model.flags.length,
    unpostedDraftComments.length,
  ]);
  const closeMarkReadyGate = useCallback(() => setMarkReadyGateOpen(false), []);
  const jumpToFlagFromGate = useCallback(
    (flag: RiskFlag) => {
      setMarkReadyGateOpen(false);
      jumpToChunk(flag.chunkId);
    },
    [jumpToChunk],
  );
  // The reminder's jump link: land on the first unposted draft's chunk — a
  // navigation aid only, posting stays manual (no auto-post).
  const jumpToDraftsFromGate = useCallback(() => {
    setMarkReadyGateOpen(false);
    const first = unpostedDraftComments[0];
    if (first) jumpToChunk(first.anchor.chunkId);
  }, [jumpToChunk, unpostedDraftComments]);
  // Per-comment post-now (BRIEF-43, ADR 0031): post a staged draft NOW as a
  // standalone inline review comment. Present only in own-draft state at the
  // current head (`ownDraft.postComment`) — off the current head the composer
  // is already read-only, so no draft can be staged to post.
  const postComment = ownDraft?.postComment;
  // Double-post guard, twice over: the module-level REGISTRY is the
  // synchronous re-entrancy gate (`beginInFlightPost` returns false on a
  // duplicate — module state, so it survives the same-tab remount a ref/state
  // pair dies with), and its subscribed view (`postingCommentIds` above)
  // re-renders so the in-flight comment's Post/Edit/Delete controls visibly
  // disable (a mid-flight edit would flip a `submitted` record whose edited
  // body was never what actually posted). Keyed by comment id so distinct
  // drafts post concurrently but one draft cannot double-fire.
  //
  // Accepted scope (reviewer round 1, 4b): the guard is per-TAB. Two tabs
  // share the same sessionStorage-copied draft ids, so posting the same draft
  // from both tabs can double-post on GitHub — deduping that would need a
  // server-side idempotency key. Accepted for this PR; the second tab's local
  // record still reconciles as "yours" after its next conversation refetch.
  // Returns the post's OUTCOME (posted / deterministic reject /
  // indeterminate) — the single per-comment path reused by both the inline
  // Post button (fire-and-forget: the return is ignored) and the batch below
  // (awaited sequentially; the outcome branches the summary's stop-cause
  // copy — reviewer round 2 #2). EVERY outcome is
  // RECORDED on the module-level settled queue, never announced from this
  // closure (reviewer round 8): after a remount-mid-flight, this closure's
  // announceSubmit targets the orphaned mount — a React no-op — and a lost
  // failure warning (the indeterminate copy above all) would leave a silently
  // re-enabled Post button inviting a double-posting retry. The drain effect
  // above announces through whichever mount is live.
  //
  // `batchOwnsMessaging` (reviewer round 1 #1): batch-initiated posts queue
  // their settled entries with a NULL copy — the drain still applies every
  // store flip but announces nothing, so the batch's summary toast is
  // deterministically the LAST live-region write. Without it, the summary
  // (announced from the await continuation) was scheduled first and the
  // failed post's drain announcement then overwrote the honest counts and
  // "The PR was NOT marked ready".
  const postDraftComment = useCallback(
    async (
      comment: ReviewComment,
      batchOwnsMessaging = false,
    ): Promise<PostDraftOutcome> => {
      // Guard the injected action's presence, the draft status (a posted
      // comment is server-owned/read-only), and re-entrancy.
      if (postComment === undefined || comment.status !== "draft") {
        return "rejected";
      }
      // Cap mirrors (apps/web AGENTS.md): an over-cap body or anchor path is
      // a deterministic route 400 — the Post button is already disabled with
      // this reason; this guards the programmatic path with the same copy.
      // In a batch the reason is SUPPRESSED (round 2 #1): it would inject
      // noise before the summary, which reports the deterministic stop-cause
      // itself.
      const blocked = postCommentBlockedReason(comment);
      if (blocked !== undefined) {
        if (!batchOwnsMessaging) announceSubmit(blocked);
        return "rejected";
      }
      // Reverse race (reviewer round 7 #2, blockedExternally's mirror): a
      // Submit review in flight already CAPTURED this draft — posting it now
      // would double-post it when the review lands. The Post button is
      // disabled with this reason; this guards the programmatic path.
      // Suppressed in a batch on the same terms as the cap mirror above.
      if (submitPending) {
        if (!batchOwnsMessaging) {
          announceSubmit(POST_COMMENT_COPY.postWhileSubmitting);
        }
        return "rejected";
      }
      // A duplicate in-flight post: ITS outcome is unknowable from here, so a
      // batch must stop with the indeterminate summary, never a confident
      // "did not post".
      if (!beginInFlightPost(briefId, comment.id)) return "indeterminate";
      try {
        const result = await postComment(comment.anchor, comment.body);
        switch (result.kind) {
          case "posted": {
            // The submit flow's exact success semantics, for one comment:
            // the draft flips to `submitted` (dropping the unposted-draft
            // count the soft gate reminds on — BRIEF-43 #5) and the wrapping
            // review id is recorded ("yours" join, BRIEF-25). The DURABLE
            // snapshot write + settled-queue entry happen here; the LIVE-store
            // flip + announcement apply through the drain effect above — always
            // the mount live at settle time, never the one this closure
            // captured (reviewer round 7 #1).
            commitPostedComment(
              briefId,
              comment.id,
              result.reviewId,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.posted,
            );
            // A posted inline comment is a conversation write — refetch so the
            // new thread renders. The query client is app-level, not
            // mount-level, so invalidating from this closure is remount-safe.
            if (conversation !== undefined) {
              void queryClient.invalidateQueries({
                queryKey: conversation.queryOptions.queryKey,
              });
            }
            return "posted";
          }
          case "unauthorized":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.unauthorized,
            );
            return "unauthorized";
          case "not-found":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.notFound,
            );
            return "not-found";
          case "stale":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.stale,
            );
            return "stale";
          // Deterministic reject: distinct copy — a retry of the SAME draft
          // can never succeed, so it must never read as retryable.
          case "invalid":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.invalid,
            );
            return "rejected";
          case "upstream":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.upstream,
            );
            return "indeterminate";
        }
      } catch (error) {
        console.error("post-now failed", error);
        recordFailedPost(
          briefId,
          comment.id,
          batchOwnsMessaging ? null : POST_COMMENT_COPY.failed,
        );
        return "indeterminate";
      } finally {
        endInFlightPost(briefId, comment.id);
      }
    },
    [
      announceSubmit,
      briefId,
      conversation,
      postComment,
      queryClient,
      submitPending,
    ],
  );
  // Batch "post my drafts, then mark ready" (BRIEF-43 follow-up, owner-approved
  // reversal of the grill's no-batch decision). Posts each unposted draft
  // SEQUENTIALLY through the SAME per-comment path above (in-flight registry,
  // durable commitPostedComment, settled queue — no second posting path), and
  // marks ready ONLY if every post succeeded. Any failure STOPS before
  // mark-ready: the remaining drafts are left untouched, the gate closes, and
  // an honest-counts toast (indeterminate for the one that failed) fires.
  // Synchronous re-entrancy guard (round 2 #3 fallout): the confirm CTA is
  // aria-disabled — not hard disabled — while the batch runs, so a click can
  // land before the busy state renders; state updates are async, a ref is not
  // (the useMarkReady pattern).
  const batchInFlight = useRef(false);
  const runMarkReadyBatch = useCallback(
    async (drafts: readonly ReviewComment[]) => {
      if (batchInFlight.current) return;
      batchInFlight.current = true;
      try {
        const total = drafts.length;
        let posted = 0;
        for (const draft of drafts) {
          setMarkReadyBatch({ current: posted + 1, total });
          // Sequential BY DESIGN (not parallelizable): each post is an outward
          // GitHub write, and a failure must STOP the run before the next post
          // and before mark-ready — Promise.all would fire them all and defeat
          // the stop-on-failure contract.
          // eslint-disable-next-line no-await-in-loop
          const outcome = await postDraftComment(draft, true);
          if (outcome !== "posted") {
            setMarkReadyBatch(null);
            setMarkReadyGateOpen(false);
            // The batch owns messaging (round 1 #1): every batch entry drains
            // silently and this summary — honest counts, the indeterminate rule
            // for the failed one, the explicit NOT-marked-ready — rides the
            // settled queue as a NOTICE, announced LAST by whichever mount is
            // live. Announcing from this closure instead would target the mount
            // that STARTED the batch: a remount-mid-batch would silently drop
            // the safety-critical warning (security review, this round).
            recordPostNotice(
              briefId,
              markReadyBatchFailureCopy(posted, total, outcome),
            );
            // Focus rescue (round 3 #1): this close happens while the modal
            // may hold focus (the confirm CTA) — the box goes inert and focus
            // drops to <body>, and NEITHER sibling rescue fires (the own-draft
            // state didn't exit, the head didn't advance). After the close
            // commits, re-home focus that was dropped or stranded inside the
            // now-closed modal onto the terminal-slot CTA, mirroring the
            // sibling effects.
            window.requestAnimationFrame(() => {
              const active = document.activeElement;
              if (
                active === null ||
                active === document.body ||
                active.closest('[data-state="closed"]') !== null
              ) {
                document
                  .querySelector<HTMLElement>("[data-terminal-slot]")
                  ?.focus();
              }
            });
            return;
          }
          posted += 1;
        }
        setMarkReadyBatch(null);
        setMarkReadyGateOpen(false);
        // All posted → mark ready. Same messaging guarantee as the failure
        // path: the batch's entries drain silently, so the mark-ready flow's
        // own result copy is the terminal live-region write — a late
        // per-comment success drain cannot clobber it (round 1 #1).
        markReadyFlow.markReady();
      } finally {
        batchInFlight.current = false;
      }
    },
    [briefId, markReadyFlow, postDraftComment],
  );
  const markReadyAnyway = useCallback(() => {
    // Checked (N>0) → post every unposted draft first, then mark ready iff all
    // succeed. Unchecked → today's behavior: mark ready, post nothing.
    if (postDraftsOnReady && unpostedDraftComments.length > 0) {
      void runMarkReadyBatch(unpostedDraftComments);
      return;
    }
    setMarkReadyGateOpen(false);
    markReadyFlow.markReady();
  }, [
    markReadyFlow,
    postDraftsOnReady,
    runMarkReadyBatch,
    unpostedDraftComments,
  ]);
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
      "Mockup flow — submit posts your review natively to GitHub with one signature line linking this receipt.",
    );
  }, [announceSubmit, liveSubmit, readOnly, submitFlow]);
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
        repoConfig={repoConfig}
        briefId={briefId}
        timeline={timeline}
        model={model}
        totals={totals}
        progress={progress}
        locOpen={locOpen}
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
        ownDraft={
          ownDraftActive
            ? {
                markReady: requestMarkReady,
                pending: markReadyFlow.pending,
                unavailable: !markReadyAvailable,
              }
            : undefined
        }
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
          <section
            className={`${styles["summary"]} reveal`}
            data-summary-split={
              summaryParts.changelog === undefined ? undefined : ""
            }
          >
            <div className={styles["eyebrow"]}>
              {brief.artifactKind === "delta" ? "Delta brief" : "Brief"}
            </div>
            {/* BRIEF-4: with a changelog the summary renders as two grid
                regions — lead prose | changelog (+ delta context). DOM order
                stays overview → what-it-does → changelog; wide-container
                placement is grid-only (reading order, a11y). */}
            {summaryParts.changelog === undefined ? (
              <Markdown content={brief.summary} />
            ) : (
              <div className={styles["summaryColumns"]}>
                <div className={styles["summaryLead"]}>
                  <Markdown content={summaryParts.lead} />
                </div>
                <div className={styles["summaryAside"]}>
                  <Markdown content={summaryParts.changelog} />
                  {brief.artifactKind === "delta" ? (
                    <DeltaContext brief={brief} />
                  ) : null}
                </div>
              </div>
            )}
            {summaryParts.changelog === undefined &&
            brief.artifactKind === "delta" ? (
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
              <>
                <AttributeJumpRail
                  jumpToGroup={jumpToGroup}
                  rail={attributeRail}
                />
                {brief.intentCheck ? (
                  <IntentBar
                    intentCheck={brief.intentCheck}
                    jumpToGroup={jumpToGroup}
                    ref={intentBarRef}
                  />
                ) : null}
                <GroupTocBar
                  activeGroupId={activeGroupId}
                  conversationGroupIds={conversationGroupIds}
                  groups={model.groups}
                  jumpToGroup={jumpToGroup}
                />
              </>
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
                composerDisabledReason={readOnly?.reason}
                conversationByChunk={conversationByChunk}
                conversationComposer={conversationComposer}
                cancelCommentComposer={cancelCommentComposer}
                deleteReviewComment={deleteReviewComment}
                jumpToChunk={jumpToChunk}
                markReviewed={markReviewed}
                openCommentComposer={openCommentComposer}
                saveReviewComment={saveReviewComment}
                postReviewComment={
                  postComment !== undefined ? postDraftComment : undefined
                }
                /* Unconditional (empty set inert): if the own-draft state
                   exits while a post is settling (mark-ready confirmed,
                   same span so no remount), the ACTION vanishes with the
                   plan but the lockdown must hold — Edit/Delete re-enabling
                   on a still-posting draft could flip a submitted record
                   whose edited body never posted, or orphan the GitHub
                   comment on delete. */
                postingCommentIds={postingCommentIds}
                /* The reverse race's visible half (round 7 #2): while a
                   Submit review is pending every Post disables with this
                   wait-shaped reason — the review already captured the
                   drafts it ships. */
                postBlockedExternally={
                  submitPending
                    ? POST_COMMENT_COPY.postWhileSubmitting
                    : undefined
                }
                setCollapseSupporting={setCollapseSupporting}
                setDismissTarget={openDismissTarget}
                setEvidenceTarget={setEvidenceTarget}
                setToast={setToast}
                flagsReadOnly={ownDraftActive}
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
      {/* Submit-review machinery + receipt: HIDDEN (not broken) in the
          own-draft state (BRIEF-43, ADR 0031). The receipt is the terminal
          artifact of submitting a review; in own-draft the terminal action is
          mark-ready — no submit, no receipt ceremony, and none of these
          surfaces (nor their toasts) is reachable: the Header CTA slot swaps,
          the menu drops Summary preview, and no keyboard shortcut opens any
          of them. */}
      {ownDraftActive ? null : (
        <>
          <ReceiptDrawer
            receipt={receipt}
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
            open={summaryPreviewOpen}
            snapshot={snapshot}
            close={closeSummaryPreview}
            setOutcome={(outcome) => actions.setOutcome(outcome)}
          />
          <PreSubmitModal
            open={preSubmitOpen}
            unresolvedItems={unresolvedItems}
            close={closePreSubmit}
            continueToReceipt={continuePreSubmitToReceipt}
            jumpToItem={jumpToPreSubmitItem}
          />
        </>
      )}
      {/* Flag-disposition machinery: unmounted with its controls — flags are
          a read-only mirror in the own-draft state (no author dispositions). */}
      {ownDraftActive ? null : (
        <>
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
        </>
      )}
      {/* The mark-ready soft gate (BRIEF-43): mounted only in the own-draft
          state, only while the action exists (current head in view — a
          historical revision's flags are not the gate's contract), and only
          when there is something to gate ON — risk flags OR unposted drafts
          (owner amendment: the batch expectation is global, not flags-only).
          Both zero skips the modal entirely (the CTA acts directly, and
          nothing gate-shaped exists in the DOM). */}
      {ownDraftActive &&
      markReadyAvailable &&
      (model.flags.length > 0 || unpostedDraftComments.length > 0) ? (
        <MarkReadyModal
          open={markReadyGateOpen}
          flags={model.flags}
          unpostedDraftCount={unpostedDraftComments.length}
          close={closeMarkReadyGate}
          markReadyAnyway={markReadyAnyway}
          jumpToFlag={jumpToFlagFromGate}
          jumpToDrafts={jumpToDraftsFromGate}
          postDrafts={postDraftsOnReady}
          setPostDrafts={setPostDraftsOnReady}
          busyLabel={
            markReadyBatch !== null
              ? `Posting ${String(markReadyBatch.current)} of ${String(markReadyBatch.total)}…`
              : undefined
          }
        />
      ) : null}
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
  open: boolean;
  setOutcome: (outcome: ReviewOutcome) => void;
  snapshot: SessionSnapshot;
}

function SummaryPreviewDrawer({
  brief,
  close,
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
        snapshot={snapshot}
        setOutcome={setOutcome}
      />
    </Drawer>
  );
}
