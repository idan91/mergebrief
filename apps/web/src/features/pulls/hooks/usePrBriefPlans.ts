// The rendered-brief plan assembly: comparison-plan memos, the
// submit/post-now/mark-ready transports, the own-draft derivation, and the
// identity pinning that keeps every plan stable across PR-meta poll ticks
// (each refetch rebuilds `timeline` object identities, and these plans feed
// memoized ChunkCards).
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  DB_BRIEF_ID_PREFIX,
  type BriefComparisonPlan,
} from "@web/features/brief";
import {
  lastReviewUnavailableReasonTitle,
  type CompareOptionFlags,
} from "../../brief/comparison/compareState";
import {
  buildSubmitPayload,
  type SubmitDraftInput,
  type SubmitReviewAction,
} from "../../review/utils/submit";
import type {
  ConversationPlan,
  ThreadRevisionJump,
} from "@web/features/conversation";
import {
  collaboratorsQueryOptions,
  conversationQueryOptions,
} from "../../conversation/queries";
import { postConversationReply } from "../../conversation/reply";
import { setThreadResolution } from "../../conversation/resolve";
import type { Span } from "../utils/briefRouteState";
import type { DbTimelineSelection } from "../utils/dbTimeline";
import { createMarkReadyAction } from "../transport/markReady";
import { isOwnDraft } from "../utils/ownDraft";
import { postInlineComment } from "../transport/postComment";
import {
  dbComparisonMarksQueryOptions,
  dbDeltaQueryOptions,
  dbRevisionNarrativeQueryOptions,
  prDiffQueryOptions,
  prMetaQueryOptions,
} from "../queries";
import { submitReview } from "../transport/submitReview";
import type { PrSummary } from "../types";

export interface UsePrBriefPlansInput {
  repoId: string;
  prNumber: number;
  /** The RENDERED span — anchors and commit pins derive from it, never meta. */
  span: Span;
  meta: PrSummary;
  /** The resolved revision timeline; absent on legacy metas. */
  timeline: DbTimelineSelection | undefined;
  /** Outdated-thread revision jump; absent without a timeline. */
  revisionJump: ThreadRevisionJump | undefined;
}

export interface OwnDraftPlanSlice {
  markReady?: ReturnType<typeof createMarkReadyAction>;
  postComment?: (draftId: string) => ReturnType<typeof postInlineComment>;
}

export interface UsePrBriefPlansValue {
  /** Keys the per-brief Review Session store, exactly like a local brief id. */
  briefId: string;
  comparisonPlan: BriefComparisonPlan;
  availability: CompareOptionFlags;
  /** Honest reason on the disabled compare control; absent keeps generic copy. */
  lastReviewDisabledReason: string | undefined;
  submitAction: SubmitReviewAction;
  conversationPlan: ConversationPlan;
  /** Own-draft plan: absent on every non-own-draft view. */
  ownDraft: OwnDraftPlanSlice | undefined;
}

export function usePrBriefPlans(
  input: UsePrBriefPlansInput,
): UsePrBriefPlansValue {
  const { t } = useTranslation();
  const { repoId, prNumber, span, meta, timeline, revisionJump } = input;

  // On the timeline path the SELECTED revision's own availability drives the
  // plan — each envelope is scoped to its head. On the legacy non-timeline
  // path, meta.comparisons applies only to the current head: a pinned older
  // span must not borrow the current head's baselines.
  const currentHead = meta.headSha === span.head;
  const effectiveComparisons =
    timeline?.selected.comparisons ??
    (currentHead ? meta.comparisons : undefined);
  // Identity-stabilized on primitive fingerprints: every PR-meta poll tick
  // rebuilds the timeline envelopes with unchanged content, and the plan built
  // from them feeds memoized ChunkCards.
  const rawPrevious = effectiveComparisons?.previousBrief;
  const previousKey =
    rawPrevious === undefined
      ? undefined
      : `${rawPrevious.baselineSha}|${String(rawPrevious.baselineIndex)}|${String(rawPrevious.narrativeAvailable)}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previous = useMemo(() => rawPrevious, [previousKey]);
  const rawLastReview = effectiveComparisons?.lastReview;
  const lastReviewKey =
    rawLastReview === undefined
      ? undefined
      : rawLastReview.kind === "available"
        ? `available|${rawLastReview.baselineSha}|${String(rawLastReview.baselineIndex ?? "")}|${String(rawLastReview.deltaAvailable)}`
        : `unavailable|${rawLastReview.reason}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lastReview = useMemo(() => rawLastReview, [lastReviewKey]);
  const comparisonPlan = useMemo<BriefComparisonPlan>(() => {
    return {
      ...(previous === undefined
        ? {}
        : {
            previousBrief: {
              marks: dbComparisonMarksQueryOptions(
                repoId,
                prNumber,
                previous.baselineSha,
                span.head,
                "previous-brief",
                previous.baselineIndex,
              ),
              // Raw span diff toggle: previous head → selected head.
              rawDiff: prDiffQueryOptions(
                repoId,
                prNumber,
                previous.baselineSha,
                span.head,
              ),
              ...(previous.narrativeAvailable
                ? {
                    narrative: dbRevisionNarrativeQueryOptions(
                      repoId,
                      prNumber,
                      previous.baselineSha,
                      span.head,
                    ),
                  }
                : {}),
            },
          }),
      ...(lastReview === undefined || lastReview.kind !== "available"
        ? {}
        : {
            lastReview: {
              marks: dbComparisonMarksQueryOptions(
                repoId,
                prNumber,
                lastReview.baselineSha,
                span.head,
                "checkpoint",
                lastReview.baselineIndex ?? null,
              ),
              // Raw span diff toggle: checkpoint → selected head.
              rawDiff: prDiffQueryOptions(
                repoId,
                prNumber,
                lastReview.baselineSha,
                span.head,
              ),
              // Marks-only tier: no delta descriptor — the delta pane
              // degrades honestly ("absence IS the signal").
              ...(lastReview.deltaAvailable
                ? {
                    delta: dbDeltaQueryOptions(
                      repoId,
                      prNumber,
                      lastReview.baselineSha,
                      span.head,
                    ),
                  }
                : {}),
            },
          }),
    };
  }, [lastReview, prNumber, previous, repoId, span.head]);
  const availability: CompareOptionFlags = {
    previousBrief: comparisonPlan.previousBrief !== undefined,
    lastReview: comparisonPlan.lastReview !== undefined,
  };
  // A checkpoint that EXISTS but cannot be compared gets its honest reason on
  // the disabled control; an absent field keeps the generic copy.
  const lastReviewDisabledReason =
    lastReview?.kind === "unavailable"
      ? lastReviewUnavailableReasonTitle(t, lastReview.reason)
      : undefined;

  // Anchors were read against THIS span's head, so the review pins
  // commit_id = span.head — never meta.headSha, which may have advanced while
  // reading.
  // The SHAs ride as primitives: `span` is rebuilt on every PR-meta poll tick,
  // and these actions feed memoized cards.
  const spanBase = span.base;
  const spanHead = span.head;
  const submitAction = useCallback<SubmitReviewAction>(
    (draft: SubmitDraftInput) =>
      submitReview(
        repoId,
        prNumber,
        { base: spanBase, head: spanHead },
        buildSubmitPayload(draft),
      ),
    [prNumber, repoId, spanBase, spanHead],
  );

  // Own-draft state is derived at read time from the PrView booleans — never
  // stored, never an entry path. The injected action awaits the pr-view
  // invalidation on success, so the own-draft UI stays until the refreshed
  // PrView lands — invalidate, never optimistically clear. A ready-elsewhere
  // flip rides the same derivation via the meta poll.
  const queryClient = useQueryClient();
  const markReadyAction = useMemo(
    () => createMarkReadyAction(queryClient, repoId, prNumber),
    [prNumber, queryClient, repoId],
  );
  // Per-comment post-now, pinned to THIS span's head — never meta.headSha,
  // which may have advanced while drafting. Only wired into `ownDraft` at the
  // current head (below), so a stale-head post cannot be offered.
  const postCommentAction = useCallback(
    (draftId: string) =>
      postInlineComment(
        repoId,
        prNumber,
        { base: spanBase, head: spanHead },
        { draftId },
      ),
    [prNumber, repoId, spanBase, spanHead],
  );
  // The mark-ready ACTION (and its soft gate) rides the plan only while the
  // CURRENT head is in view: the gate lists the rendered Brief's flags and the
  // contract is "ALL current-head flags", so a historical revision could slip
  // past flags the head carries. The STATE itself stays on every revision.
  const ownDraftState = isOwnDraft(meta);
  const ownDraft = useMemo(
    () =>
      ownDraftState
        ? currentHead
          ? { markReady: markReadyAction, postComment: postCommentAction }
          : {}
        : undefined,
    [currentHead, markReadyAction, postCommentAction, ownDraftState],
  );

  const briefId = `${DB_BRIEF_ID_PREFIX}${repoId}:${String(prNumber)}:${span.base}:${span.head}`;
  // The live-conversation plan is always fetched fresh per PR — resolution
  // flips and replies happen outside our generation cycle. The selected
  // revision's generation start is a primitive dep, so poll-tick timeline
  // rebuilds with unchanged content never rebuild the plan.
  const briefGeneratedAt = timeline?.selected.generatedAt;
  // The resolve capability is PR-LEVEL and comes off PR META — never the list
  // payload, whose value is an authorship-only fallback. It rides every
  // revision on purpose: a thread belongs to the PR, not to the rendered head.
  const viewerCanResolve = meta.viewerCanResolve;
  const conversationPlan = useMemo(
    () => ({
      queryOptions: conversationQueryOptions(repoId, prNumber),
      // Collaborator mention pool: repo-scoped, shared by the section and the
      // inline composers through one query key.
      collaborators: collaboratorsQueryOptions(repoId),
      postReply: (rootCommentId: number, body: string) =>
        postConversationReply(repoId, prNumber, rootCommentId, body),
      resolution: {
        canResolve: viewerCanResolve,
        setResolved: (rootCommentId: number, resolved: boolean) =>
          setThreadResolution(repoId, prNumber, rootCommentId, resolved),
        refetchCapability: () =>
          void queryClient.invalidateQueries({
            queryKey: prMetaQueryOptions(repoId, prNumber).queryKey,
          }),
      },
      ...(revisionJump === undefined ? {} : { revisionJump }),
      ...(briefGeneratedAt === undefined ? {} : { briefGeneratedAt }),
    }),
    [
      briefGeneratedAt,
      prNumber,
      queryClient,
      repoId,
      revisionJump,
      spanBase,
      spanHead,
      viewerCanResolve,
    ],
  );

  return {
    briefId,
    comparisonPlan,
    availability,
    lastReviewDisabledReason,
    submitAction,
    conversationPlan,
    ownDraft,
  };
}
