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
} from "react";

import { Drawer } from "@web/components/Drawer/Drawer";
import { Markdown } from "@web/components/Markdown/Markdown";
import { prefersReducedMotion } from "@web/utils/motion";
import type { CommentAnchor } from "@web/features/review/comments";
import { DismissModal } from "@web/features/review/components/DismissModal/DismissModal";
import { EvidenceModal } from "@web/features/review/components/EvidenceModal/EvidenceModal";
import { PreSubmitModal } from "@web/features/review/components/PreSubmitModal/PreSubmitModal";
import {
  ConversationSection,
  type ConversationPlan,
  type ThreadComposerWiring,
} from "@web/features/conversation/components/ConversationSection/ConversationSection";
import { buildInlineThreads } from "@web/features/conversation/digest";
import { reconcileOwnComments } from "@web/features/conversation/ownComments";
import type { ConversationResult } from "@web/features/conversation/queries";
import { ReceiptDrawer } from "@web/features/review/components/ReceiptDrawer/ReceiptDrawer";
import { SummaryPreview } from "@web/features/review/components/SummaryPreview/SummaryPreview";
import type { SubmitReviewAction } from "@web/features/review/submit";
import { useReviewSubmit } from "@web/features/review/useReviewSubmit";
import {
  clearSnapshots,
  deriveInitialState,
  MindMapProvider,
  type SessionSnapshot,
} from "@web/features/review/session";
import type { ReviewOutcome, UnresolvedItem } from "@web/features/review/state";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { MarkReadyAction } from "@web/features/pulls/markReady";
import {
  useInFlightPosts,
  type PostCommentResult,
} from "@web/features/pulls/postComment";
import { MarkReadyModal } from "@web/features/pulls/components/MarkReadyModal/MarkReadyModal";
import type { Brief, LocalBriefSummary } from "../../types";
import { useKeyboardShortcuts } from "../../useKeyboardShortcuts";
import {
  buildAttributeRail,
  buildBriefViewModel,
  splitSummaryAtChangelog,
} from "../../viewModel";
import type { RepoConfigContext } from "../../repoConfig";
import { localBriefQueryOptions } from "../../queries";
import { ChangesOnlyView } from "../ChangesOnlyView/ChangesOnlyView";
import { ConcernView } from "../ConcernView/ConcernView";
import { DeltaContext } from "../DeltaContext/DeltaContext";
import { AttributeJumpRail } from "../AttributeJumpRail/AttributeJumpRail";
import { IntentBar, type IntentBarHandle } from "../IntentBar/IntentBar";
import { GroupTocBar } from "../GroupTocBar/GroupTocBar";
import { Header } from "../Header/Header";
import { ReadThroughProgress } from "../ReadThroughProgress/ReadThroughProgress";
import { ShortcutsModal } from "../ShortcutsModal/ShortcutsModal";
import { StoryView } from "../StoryView/StoryView";
import {
  useComparisonOverlay,
  type BriefComparisonPlan,
} from "./useComparisonOverlay";
import { useMarkReadyFlow } from "./useMarkReadyFlow";
import { POST_COMMENT_COPY, useOwnDraftFlow } from "./useOwnDraftFlow";
import { useReadingSession } from "./useReadingSession";
import { useRiskFlagFlow } from "./useRiskFlagFlow";
import { disabledComparisonQuery } from "./utils";
import styles from "./BriefPage.module.scss";

export type { BriefComparisonPlan } from "./useComparisonOverlay";

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

  // Comparison overlay (ADR 0024): timeline, View/Compare resolution, and
  // the active baseline's marks/narrative/delta — see the hook.
  const {
    activeCompare,
    activeRawSpanDiff,
    availability,
    compareState,
    comparison,
    delta,
    marks,
    narrative,
    skipReason,
    timeline,
  } = useComparisonOverlay({
    artifacts,
    brief,
    briefId,
    comparisonPlan,
    searchParams,
  });

  // Own-draft state (BRIEF-43): the plan's presence IS the state — see the
  // block around `useMarkReadyFlow` below.
  const ownDraftActive = ownDraft !== undefined;

  // The reading session (ADR 0022): per-brief Mind-Map store wiring, the
  // progress/receipt derivation, and the scroll/nav machinery — see the hook.
  const session = useReadingSession({
    brief,
    briefId,
    compareViewFull: compareState.view === "full",
    model,
    ownDraftActive,
    repoConfig,
  });
  const {
    actions,
    activeChunkId,
    chunkIds,
    focusMode,
    groupBoundaries,
    jumpToChunk,
    jumpToGroup,
    readingOrderedChunks,
    receipt,
    replyDrafts,
    reviewComments,
    reviewOutcome,
    snapshot,
    submittedReviewIds,
    toggleFocusMode,
    viewMode,
  } = session;

  // Transient UI state stays local and colocated.
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [summaryPreviewOpen, setSummaryPreviewOpen] = useState(false);
  const [preSubmitOpen, setPreSubmitOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [activeCommentAnchor, setActiveCommentAnchor] =
    useState<CommentAnchor | null>(null);
  const [toast, setToast] = useState("");

  // Risk-disposition UX (flag selection + dismiss/evidence modals) — see the
  // hook; flags are a read-only mirror in the own-draft state (JSX below).
  const riskFlow = useRiskFlagFlow({
    actions,
    flagsById: model.flagsById,
    setToast,
  });

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
  // submit block alive across it. See `useOwnDraftFlow` below.
  const postingCommentIds = useInFlightPosts(briefId);
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
  // Per-comment post-now (BRIEF-43, ADR 0031): present only in own-draft
  // state at the current head (`ownDraft.postComment`) — off the current head
  // the composer is already read-only, so no draft can be staged to post.
  const postComment = ownDraft?.postComment;
  // A posted inline comment is a conversation write — refetch so the new
  // thread renders. The query client is app-level, not mount-level, so
  // invalidating from the post path's closure is remount-safe.
  const invalidateConversation = useMemo(
    () =>
      conversation === undefined
        ? undefined
        : () =>
            void queryClient.invalidateQueries({
              queryKey: conversation.queryOptions.queryKey,
            }),
    [conversation, queryClient],
  );
  // The own-draft post-now flow (registry choreography, settled-post drain,
  // double-post guards in both directions) — see the hook.
  const { postDraftComment } = useOwnDraftFlow({
    actions,
    announce: announceSubmit,
    briefId,
    invalidateConversation,
    postComment,
    postingCommentIds,
    submitPending,
  });
  // This render's reviewer-overlay-open snapshot + the entry reset the
  // mark-ready flow's own-draft entry/exit effect drives (see the hook).
  const reviewerOverlayOpen =
    receiptOpen || summaryPreviewOpen || preSubmitOpen || riskFlow.modalOpen;
  const closeRiskModals = riskFlow.closeModals;
  const closeReviewerOverlays = useCallback(() => {
    setReceiptOpen(false);
    setSummaryPreviewOpen(false);
    setPreSubmitOpen(false);
    closeRiskModals();
  }, [closeRiskModals]);
  // The mark-ready soft gate (BRIEF-54 PR 4) reaches the expanded intent bar
  // through this handle; null when the Brief carries no intentCheck.
  const intentBarRef = useRef<IntentBarHandle>(null);
  const exitToStoryView = session.exitToStoryView;
  const showIntentBar = useCallback(() => {
    exitToStoryView();
    window.setTimeout(() => intentBarRef.current?.expandAndScrollTo(), 0);
  }, [exitToStoryView]);
  // The own-draft terminal action (soft gate, opt-in post-drafts batch,
  // entry/exit/head-advance focus rescues) — see the hook.
  const markReady = useMarkReadyFlow({
    action: ownDraft?.markReady,
    announce: announceSubmit,
    briefId,
    closeReviewerOverlays,
    flagCount: model.flags.length,
    intentCheck: brief.intentCheck,
    jumpToChunk,
    ownDraftActive,
    postDraft: postDraftComment,
    reviewComments,
    reviewerOverlayOpen,
    showIntentBar,
  });

  // Shortcuts stand down whenever an overlay holds focus (drawers/modals use
  // `inert`, which doesn't stop a window-level keydown listener on its own).
  const shortcutsDisabled =
    receiptOpen ||
    summaryPreviewOpen ||
    preSubmitOpen ||
    markReady.gateOpen ||
    session.shortcutsOpen ||
    riskFlow.modalOpen ||
    activeCommentAnchor !== null;
  useKeyboardShortcuts({
    chunkIds,
    groupBoundaries,
    activeChunkId,
    disabled: shortcutsDisabled,
    focusModeActive: focusMode,
    jumpToChunk: session.jumpToChunkFromShortcut,
    toggleFocusMode,
    toggleHelp: session.toggleShortcuts,
    jumpToConversation:
      conversation !== undefined ? jumpToConversation : undefined,
  });

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
  const clearDrafts = useCallback(() => {
    clearSnapshots();
    actions.reset(deriveInitialState(model));
  }, [actions, model]);
  const toggleDescription = useCallback(
    () => setDescriptionOpen((current) => !current),
    [],
  );

  return (
    <>
      <Header
        brief={brief}
        repoConfig={repoConfig}
        briefId={briefId}
        timeline={timeline}
        model={model}
        totals={session.totals}
        progress={session.progress}
        locOpen={locOpen}
        viewMode={viewMode}
        setViewMode={session.setViewMode}
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
                markReady: markReady.request,
                pending: markReady.pending,
                unavailable: !markReady.available,
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
          ref={session.focusBannerRef}
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
          session.layoutMode === "split" && viewMode === "story"
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
                  activeGroupId={session.activeGroupId}
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
                collapseSupporting={session.collapseSupporting}
                focusMode={focusMode}
                openChunks={session.openChunks}
                selectedRiskFlags={riskFlow.selectedRiskFlags}
                activeCommentAnchor={activeCommentAnchor}
                addressedReviewComments={brief.reviewComments}
                composerDisabledReason={readOnly?.reason}
                conversationByChunk={conversationByChunk}
                conversationComposer={conversationComposer}
                cancelCommentComposer={cancelCommentComposer}
                deleteReviewComment={deleteReviewComment}
                jumpToChunk={jumpToChunk}
                markReviewed={session.markReviewed}
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
                setCollapseSupporting={session.setCollapseSupporting}
                setDismissTarget={riskFlow.openDismiss}
                setEvidenceTarget={riskFlow.openEvidence}
                setToast={setToast}
                flagsReadOnly={ownDraftActive}
                toggleChunk={session.toggleChunk}
                toggleRiskFlag={riskFlow.toggleRiskFlag}
                toggleRiskGroup={riskFlow.toggleRiskGroup}
                toggleReviewComment={toggleReviewComment}
                updateReviewComment={updateReviewComment}
                {...(compareState.view === "full" && chunkIds.length > 0
                  ? { startReadThrough: session.startReadThrough }
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
            unresolvedItems={session.unresolvedItems}
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
            target={riskFlow.dismissTarget}
            reason={riskFlow.dismissReason}
            warned={riskFlow.dismissWarned}
            cancel={riskFlow.cancelDismiss}
            confirm={riskFlow.confirmDismiss}
            setReason={riskFlow.setDismissReason}
          />
          <EvidenceModal
            comments={reviewComments}
            target={riskFlow.evidenceTarget}
            cancel={riskFlow.cancelEvidence}
            confirm={riskFlow.confirmEvidence}
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
      markReady.available &&
      (model.flags.length > 0 || markReady.unpostedDraftCount > 0) ? (
        <MarkReadyModal
          open={markReady.gateOpen}
          flags={model.flags}
          unpostedDraftCount={markReady.unpostedDraftCount}
          close={markReady.closeGate}
          markReadyAnyway={markReady.markReadyAnyway}
          jumpToFlag={markReady.jumpToFlag}
          jumpToDrafts={markReady.jumpToDrafts}
          intentGapCount={markReady.intentGapCount}
          intentTensionCount={markReady.intentTensionCount}
          jumpToIntentGaps={markReady.jumpToIntentGaps}
          postDrafts={markReady.postDraftsOnReady}
          setPostDrafts={markReady.setPostDraftsOnReady}
          busyLabel={markReady.batchBusyLabel}
        />
      ) : null}
      <ShortcutsModal
        open={session.shortcutsOpen}
        close={session.closeShortcuts}
      />
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
          onClick={session.toggleShortcuts}
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
