// PR-meta polls rebuild timeline objects. Keep plans stable so memoized ChunkCards
// do not rerender for unchanged transport and comparison inputs.
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
import type { Mutable } from "types";

type PreviousBriefPlan = Mutable<
  NonNullable<BriefComparisonPlan["previousBrief"]>
>;
type LastReviewPlan = Mutable<NonNullable<BriefComparisonPlan["lastReview"]>>;
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
import type { LastReviewComparison, PrSummary } from "../types";

/** Primitive fingerprint of the last-review envelope, for memo identity. */
function deriveLastReviewKey(
  lastReview: LastReviewComparison | undefined,
): string | undefined {
  if (lastReview === undefined) return undefined;
  if (lastReview.kind === "available") {
    return `available|${lastReview.baselineSha}|${String(lastReview.baselineIndex ?? "")}|${String(lastReview.deltaAvailable)}`;
  }
  return `unavailable|${lastReview.reason}`;
}

export interface UsePrBriefPlansInput {
  repoId: string;
  prNumber: number;
  /** The RENDERED span, anchors and commit pins derive from it, never meta. */
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
  // plan, each envelope is scoped to its head. On the legacy non-timeline
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
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const previous = useMemo(() => rawPrevious, [previousKey]);
  const rawLastReview = effectiveComparisons?.lastReview;
  const lastReviewKey = deriveLastReviewKey(rawLastReview);
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const lastReview = useMemo(() => rawLastReview, [lastReviewKey]);
  const comparisonPlan = useMemo<BriefComparisonPlan>(() => {
    const plan: Mutable<BriefComparisonPlan> = {};

    if (previous !== undefined) {
      const previousBrief: PreviousBriefPlan = {
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
      };

      if (previous.narrativeAvailable) {
        previousBrief.narrative = dbRevisionNarrativeQueryOptions(
          repoId,
          prNumber,
          previous.baselineSha,
          span.head,
        );
      }

      plan.previousBrief = previousBrief;
    }

    if (lastReview !== undefined && lastReview.kind === "available") {
      const lastReviewPlan: LastReviewPlan = {
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
      };

      // Marks-only tier: no delta descriptor, the delta pane
      // degrades honestly ("absence IS the signal").
      if (lastReview.deltaAvailable) {
        lastReviewPlan.delta = dbDeltaQueryOptions(
          repoId,
          prNumber,
          lastReview.baselineSha,
          span.head,
        );
      }

      plan.lastReview = lastReviewPlan;
    }

    return plan;
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

  // Pin reviews to the viewed span head, never a meta head that advanced while reading.
  // Use primitive SHAs because poll ticks rebuild span objects passed to memoized cards.
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

  // Derive own-draft state from PrView and await invalidation before clearing its UI.
  // The same meta poll observes a ready-elsewhere transition.
  const queryClient = useQueryClient();
  const markReadyAction = useMemo(
    () => createMarkReadyAction(queryClient, repoId, prNumber),
    [prNumber, queryClient, repoId],
  );
  // Per-comment post-now, pinned to THIS span's head, never meta.headSha,
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
  const ownDraft = useMemo(() => {
    if (!ownDraftState) return undefined;
    if (!currentHead) return {};
    return { markReady: markReadyAction, postComment: postCommentAction };
  }, [currentHead, markReadyAction, postCommentAction, ownDraftState]);

  const briefId = `${DB_BRIEF_ID_PREFIX}${repoId}:${String(prNumber)}:${span.base}:${span.head}`;
  // The live-conversation plan is always fetched fresh per PR, resolution
  // flips and replies happen outside our generation cycle. The selected
  // revision's generation start is a primitive dep, so poll-tick timeline
  // rebuilds with unchanged content never rebuild the plan.
  const briefGeneratedAt = timeline?.selected.generatedAt;
  // The resolve capability is PR-LEVEL and comes off PR META, never the list
  // payload, whose value is an authorship-only fallback. It rides every
  // revision on purpose: a thread belongs to the PR, not to the rendered head.
  const viewerCanResolve = meta.viewerCanResolve;
  const conversationPlan = useMemo<ConversationPlan>(() => {
    const plan: Mutable<ConversationPlan> = {
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
    };

    if (revisionJump !== undefined) plan.revisionJump = revisionJump;
    if (briefGeneratedAt !== undefined)
      plan.briefGeneratedAt = briefGeneratedAt;

    return plan;
  }, [
    briefGeneratedAt,
    prNumber,
    queryClient,
    repoId,
    revisionJump,
    viewerCanResolve,
  ]);

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
