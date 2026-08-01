// The rendered-brief plan assembly (BRIEF-19/23/24/25/43): comparison-plan
// memos, the submit/post-now/mark-ready transports, the own-draft derivation,
// and the identity-pinning discipline that keeps every plan stable across
// PR-meta poll ticks (each refetch rebuilds `timeline` object identities —
// these plans feed memoized ChunkCards through the composer wiring).
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { BriefComparisonPlan } from "@web/features/brief";
import {
  lastReviewUnavailableReasonTitle,
  type CompareOptionFlags,
} from "../../brief/comparison/compareState";
import type { CommentAnchor } from "../../review/utils/comments";
import {
  buildSubmitPayload,
  mapAnchorToWire,
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
  /** The resolved revision timeline (BRIEF-24); absent on legacy metas. */
  timeline: DbTimelineSelection | undefined;
  /** Outdated-thread revision jump (BRIEF-24); absent without a timeline. */
  revisionJump: ThreadRevisionJump | undefined;
}

export interface OwnDraftPlanSlice {
  markReady?: ReturnType<typeof createMarkReadyAction>;
  postComment?: (
    anchor: CommentAnchor,
    body: string,
  ) => ReturnType<typeof postInlineComment>;
}

export interface UsePrBriefPlansValue {
  /** Keys the per-brief Mind-Map session store, exactly like a local brief id. */
  briefId: string;
  comparisonPlan: BriefComparisonPlan;
  availability: CompareOptionFlags;
  /** Honest reason on the disabled compare control; absent keeps generic copy. */
  lastReviewDisabledReason: string | undefined;
  submitAction: SubmitReviewAction;
  conversationPlan: ConversationPlan;
  /** Own-draft plan (BRIEF-43): absent on every non-own-draft view. */
  ownDraft: OwnDraftPlanSlice | undefined;
}

export function usePrBriefPlans(
  input: UsePrBriefPlansInput,
): UsePrBriefPlansValue {
  const { repoId, prNumber, span, meta, timeline, revisionJump } = input;

  // Comparisons: on the BRIEF-24 timeline path the SELECTED revision's own
  // availability drives the plan (offered wherever spans exist for THIS head,
  // historical included — each envelope is scoped to its head). On the legacy
  // non-timeline path, meta.comparisons applies only to the current head (a
  // pinned older span must not borrow the current head's baselines).
  const currentHead = meta.headSha === span.head;
  const effectiveComparisons =
    timeline?.selected.comparisons ??
    (currentHead ? meta.comparisons : undefined);
  // Identity-stabilized on primitive fingerprints: every PR-meta poll tick
  // rebuilds the timeline envelope objects with unchanged content, and the
  // plan built from them feeds memoized ChunkCards — the same discipline as
  // the route's revisionJump span-key.
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
              // Raw span diff toggle (BRIEF-24): previous head → selected
              // head, the same live diff proxy an arbitrary span behind the
              // gate.
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
              // Raw span diff toggle (BRIEF-24): checkpoint → selected head.
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
      ? lastReviewUnavailableReasonTitle(lastReview.reason)
      : undefined;

  // The submit transport (BRIEF-23): anchors were read against THIS span's
  // head, so the review pins commit_id = span.head — never meta.headSha,
  // which may have advanced while reading.
  const submitAction = useCallback<SubmitReviewAction>(
    (draft: SubmitDraftInput) =>
      submitReview(
        repoId,
        prNumber,
        buildSubmitPayload({ ...draft, commitId: span.head }),
      ),
    [prNumber, repoId, span.head],
  );

  // Own-draft state (BRIEF-43, ADR 0031): derived at read time from the
  // PrView booleans — never stored, never an entry path. The injected action
  // POSTs mark-ready and, on success, awaits the pr-view invalidation so the
  // own-draft UI stays stable until the refreshed PrView (draft=false)
  // actually lands — invalidate, never optimistically clear. A ready-
  // elsewhere flip (marked ready on GitHub) rides the same derivation:
  // `shouldPollMeta` polls while `draft` holds, so the flip reaches a focused
  // tab within a poll tick, turns the plan undefined, and the affordances
  // vanish.
  const queryClient = useQueryClient();
  const markReadyAction = useMemo(
    () => createMarkReadyAction(queryClient, repoId, prNumber),
    [prNumber, queryClient, repoId],
  );
  // Per-comment post-now (BRIEF-43): posts a staged draft NOW, pinned to
  // THIS span's head — never meta.headSha, which may have advanced while
  // drafting (same commit_id discipline as the submit transport above). Only
  // wired into `ownDraft` at the current head (below), so a stale-head post
  // cannot be offered.
  const postCommentAction = useCallback(
    (anchor: CommentAnchor, body: string) => {
      // The FE owns the anchor→GitHub wire translation; selectedText is a
      // submit-only degradation quote the post-now route does not take.
      const { selectedText: _drop, ...wire } = mapAnchorToWire(anchor);
      return postInlineComment(repoId, prNumber, {
        ...wire,
        commitId: span.head,
        body,
      });
    },
    [prNumber, repoId, span.head],
  );
  // The mark-ready ACTION (and with it the soft gate) rides the plan only
  // while the CURRENT head is in view: the gate lists the rendered Brief's
  // flags, and the contract is "ALL current-head flags" — on a historical
  // revision a zero-flag view could slip past flags the head carries (and
  // the inverse would gate on stale ones). The STATE itself (chip, hidden
  // submit, read-only flags) stays on every revision — the PR is the
  // viewer's draft regardless of which revision is on screen.
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

  const briefId = `db:${repoId}:${String(prNumber)}:${span.base}:${span.head}`;
  // The live-conversation plan (BRIEF-25): always fetched fresh per PR —
  // resolution flips and replies happen outside our generation cycle.
  // The SELECTED revision's generation start (BRIEF-95): a primitive dep, so
  // poll-tick timeline rebuilds with unchanged content never rebuild the plan.
  const briefGeneratedAt = timeline?.selected.generatedAt;
  // Thread resolution (BRIEF-93): the capability is PR-LEVEL and comes off PR
  // META (`viewerCanResolve`) — never the list payload, whose value is an
  // authorship-only fallback. It rides every revision on purpose: a thread
  // belongs to the PR, not to the head that happens to be rendered, so an
  // older revision resolves the same thread the current one would.
  const viewerCanResolve = meta.viewerCanResolve;
  const conversationPlan = useMemo(
    () => ({
      queryOptions: conversationQueryOptions(repoId, prNumber),
      // Collaborator mention pool (BRIEF-94): repo-scoped, shared by the
      // section and the inline composers through one query key.
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
