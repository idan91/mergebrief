// The DB-backed brief route (BRIEF-19 PR 3.2): the deep-link target PR
// comments point at. Loader SSR-prefetches exactly what the link names
// (PR-meta + the brief when the span is known — hybrid strategy); the heavy/
// dynamic rest (live diff, status polling) is client-side. The wait UX is the
// pure `briefRouteState` machine; render trigger = artifact EXISTS
// (ADR 0006 #10), status only flavors the wait.
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { ApiError, ApiErrorKind } from "../data/apiFetch";
import {
  lastReviewUnavailableReasonTitle,
  parseCompareParam,
  parseViewParam,
  resolveBriefSearch,
  type BriefSearch,
  type BriefSearchParams,
  type CompareOptionFlags,
} from "../features/brief/compareState";
import {
  BriefView,
  type BriefComparisonPlan,
} from "../features/brief/components/BriefPage/BriefPage";
import {
  comparisonsWarming,
  deriveBriefRouteState,
  headAdvanced,
  shouldPollMeta,
  type Span,
} from "../features/pulls/briefRouteState";
import {
  EmptyCard,
  FailedCard,
  HeadAdvancedBanner,
  SupersededCard,
  WaitCard,
  WarmingChip,
  waitLabel,
} from "../features/pulls/components/PrBriefStates";
import { attachLiveDiffs } from "../features/pulls/liveDiff";
import {
  dbBriefContextQueryOptions,
  dbBriefQueryOptions,
  dbComparisonMarksQueryOptions,
  dbDeltaQueryOptions,
  dbRevisionNarrativeQueryOptions,
  prDiffQueryOptions,
  prMetaQueryOptions,
} from "../features/pulls/queries";
import { conversationQueryOptions } from "../features/conversation/queries";
import type { ThreadRevisionJump } from "../features/conversation/components/ConversationSection/ConversationSection";
import { postConversationReply } from "../features/conversation/reply";
import { createMarkReadyAction } from "../features/pulls/markReady";
import { postInlineComment } from "../features/pulls/postComment";
import { draftPolicyNotice, isOwnDraft } from "../features/pulls/ownDraft";
import { submitReview } from "../features/pulls/submitReview";
import type { PrSummary } from "../features/pulls/types";
import {
  resolveDbTimeline,
  type DbTimelinePoint,
  type DbTimelineSelection,
} from "../features/pulls/dbTimeline";
import { DbBriefControls } from "../features/pulls/components/DbBriefControls/DbBriefControls";
import {
  buildSubmitPayload,
  mapAnchorToWire,
  type SubmitDraftInput,
  type SubmitReviewAction,
} from "../features/review/submit";
import type { CommentAnchor } from "../features/review/comments";
import styles from "./routeShared.module.scss";

/** 3–5s window per the plan; one lightweight PR-meta read per tick. */
const META_POLL_MS = 4000;

interface PrBriefSearch extends BriefSearchParams {
  base?: string;
  head?: string;
  /**
   * The outdated-thread jump target (BRIEF-24/25 handoff): the thread's
   * databaseId. This route owns head navigation and reserves the param;
   * BRIEF-25's conversation section reads it to open/flash the thread.
   */
  thread?: number;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Both-or-neither: a lone base/head cannot address a span (fallback path). */
function spanFromSearch(search: PrBriefSearch): Span | undefined {
  return search.base !== undefined && search.head !== undefined
    ? { base: search.base, head: search.head }
    : undefined;
}

/** A positive-int thread databaseId, or undefined. */
function parseThreadParam(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePrNumber(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw notFound();
  return value;
}

function assertRepoId(raw: string): string {
  if (!/^\d+$/.test(raw)) throw notFound();
  return raw;
}

/** A read-API NOT_FOUND (the artifact/PR does not exist for this viewer). */
function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === ApiErrorKind.NOT_FOUND;
}

/**
 * Loader error mapping: an unauthenticated read sends the viewer to login; a
 * missing PR/brief becomes the router's 404 (a real HTTP 404 on SSR, not a
 * 500). Everything else propagates to the error component.
 */
function mapLoaderError(error: unknown): never {
  if (error instanceof ApiError && error.kind === ApiErrorKind.UNAUTHORIZED) {
    throw redirect({ href: "/auth/github" });
  }
  if (isNotFoundError(error)) {
    throw notFound();
  }
  throw error;
}

export const Route = createFileRoute("/repos/$repoId/pulls/$prNumber")({
  validateSearch: (search: Record<string, unknown>): PrBriefSearch => {
    const base = search["base"];
    const head = search["head"];
    // `head` is the revision-selection key (BRIEF-24): kept on its own so a
    // `?head=<sha>` deep link (e.g. an outdated-thread jump) selects a
    // revision — its base is resolved from `revisions[]`, never the URL. A
    // lone `base` still cannot address anything, so it is kept only alongside
    // a head (the pinned convenience of a full span); an unknown head degrades
    // to latest downstream rather than 404ing a stale link.
    const view = parseViewParam(search["view"]);
    const compare = parseCompareParam(search["compare"]);
    const thread = parseThreadParam(search["thread"]);
    return {
      ...(nonEmpty(head) ? { head } : {}),
      ...(nonEmpty(head) && nonEmpty(base) ? { base } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(compare !== undefined ? { compare } : {}),
      ...(thread !== undefined ? { thread } : {}),
    };
  },
  loaderDeps: ({ search }) => ({
    ...(search.base === undefined ? {} : { base: search.base }),
    ...(search.head === undefined ? {} : { head: search.head }),
  }),
  loader: async ({ context, params, deps }) => {
    const repoId = assertRepoId(params.repoId);
    const prNumber = parsePrNumber(params.prNumber);
    const explicit = spanFromSearch(deps);
    try {
      if (explicit !== undefined) {
        // Deep link with a span: meta + brief in parallel — no waterfall. But
        // while the PR's first Brief is still generating, the Entry-comment
        // "Brief is generating…" link names a span whose artifact 404s; that
        // must NOT 404 the page — the component renders the same diff-first
        // wait state a span-unknown load produces (deriveBriefRouteState
        // degrades the current-span-while-generating case). So swallow ONLY a
        // brief-query NOT_FOUND here; a missing PR (meta NOT_FOUND) is still a
        // real 404, and any other brief failure still propagates.
        const [metaResult, briefResult] = await Promise.allSettled([
          context.queryClient.ensureQueryData(
            prMetaQueryOptions(repoId, prNumber),
          ),
          context.queryClient.ensureQueryData(
            dbBriefQueryOptions(repoId, prNumber, explicit.base, explicit.head),
          ),
        ]);
        if (metaResult.status === "rejected") {
          mapLoaderError(metaResult.reason);
        }
        if (briefResult.status === "rejected") {
          if (!isNotFoundError(briefResult.reason)) {
            mapLoaderError(briefResult.reason);
          }
          // The brief 404s while the PR's first Brief is still generating —
          // swallowed above so the page shows the wait state. But
          // `ensureQueryData` has already written an ERROR entry into the brief
          // query cache, and `dbBriefQueryOptions` is retry:false +
          // staleTime Infinity: when the poll flips `briefAvailable` and the
          // render-state `useSuspenseQuery` mounts, it would THROW that cached
          // error instead of refetching (a hard error boundary until a manual
          // reload). Drop the errored entry so the first render fetches fresh.
          context.queryClient.removeQueries({
            queryKey: dbBriefQueryOptions(
              repoId,
              prNumber,
              explicit.base,
              explicit.head,
            ).queryKey,
            exact: true,
          });
        }
        return;
      }
      // Span unknown: the meta names it, then the brief prefetches only when
      // it is actually renderable (a wait state needs nothing else).
      const meta = await context.queryClient.ensureQueryData(
        prMetaQueryOptions(repoId, prNumber),
      );
      // A `?head=` deep link (or a fresh link on a multi-revision PR) resolves
      // through the timeline: prefetch the SELECTED revision's brief with ITS
      // OWN base (`deps.base` disambiguates duplicate-head rows), so a
      // historical head SSRs correctly. An unknown head degrades to latest
      // here too — never a 404.
      const timeline = resolveDbTimeline(meta.revisions, deps.head, deps.base);
      if (timeline !== undefined) {
        await context.queryClient.ensureQueryData(
          dbBriefQueryOptions(
            repoId,
            prNumber,
            timeline.selected.baseSha,
            timeline.selected.headSha,
          ),
        );
        return;
      }
      const state = deriveBriefRouteState(meta, undefined);
      if (state.kind === "render") {
        await context.queryClient.ensureQueryData(
          dbBriefQueryOptions(
            repoId,
            prNumber,
            state.span.base,
            state.span.head,
          ),
        );
      }
    } catch (error) {
      mapLoaderError(error);
    }
  },
  component: PrBriefRoute,
  errorComponent: PrBriefError,
});

function PrBriefRoute() {
  const params = Route.useParams();
  const repoId = params.repoId;
  const prNumber = parsePrNumber(params.prNumber);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const explicit = spanFromSearch(search);

  const meta = useSuspenseQuery({
    ...prMetaQueryOptions(repoId, prNumber),
    refetchInterval: (query) =>
      query.state.data !== undefined && shouldPollMeta(query.state.data)
        ? META_POLL_MS
        : false,
  }).data;

  // BRIEF-24: a briefed PR exposes a revision timeline; `?head=` (+ `base`,
  // which disambiguates duplicate-head rows from a retarget re-brief) selects
  // a point (unknown head degrades to latest — never a 404). Absent → the
  // legacy explicit-span / current-head flow is unchanged (metas without
  // revisions).
  const timeline = useMemo(
    () => resolveDbTimeline(meta.revisions, search.head, search.base),
    [meta.revisions, search.base, search.head],
  );

  const state = useMemo(
    () =>
      timeline !== undefined
        ? ({
            kind: "render",
            span: {
              base: timeline.selected.baseSha,
              head: timeline.selected.headSha,
            },
          } as const)
        : deriveBriefRouteState(meta, explicit),
    [explicit, meta, timeline],
  );

  // A revision is WRITABLE only when its SPAN is the PR's current one
  // (ADR 0019 #6): the submit route pins commit_id to the viewed head, and —
  // just as load-bearing — comment anchors are read against the RENDERED
  // (base…head) diff. A same-head revision with a stale base (retarget
  // re-brief; codex round 4) renders a diff that is not the PR's current
  // diff, so its line anchors can land wrong or nowhere on GitHub: base
  // mismatch is a write-safety issue, not merely a stale lens. Read-only
  // shapes:
  // - a historical (non-latest) revision — switch forward to write;
  // - the latest revision while the PR head ALREADY advanced (next brief
  //   still generating; codex round 1) — the poll flips this off;
  // - a same-head revision briefed against a superseded base (codex round 4).
  // `meta.baseSha` is comparable here: with `briefAvailable` it is the latest
  // brief row's own base (`buildPrView`), the same row `revisions[]` ends
  // with; a null meta base (defensive) cannot veto.
  // Derived as primitives so the memo below survives poll ticks (each meta
  // refetch rebuilds `timeline` object identities — codex round 1).
  const selectedHeadIsCurrent =
    timeline !== undefined && timeline.selected.headSha === meta.headSha;
  const selectedBaseIsCurrent =
    timeline !== undefined &&
    (meta.baseSha === null || timeline.selected.baseSha === meta.baseSha);
  const readOnlyKind =
    timeline === undefined || (selectedHeadIsCurrent && selectedBaseIsCurrent)
      ? undefined
      : selectedHeadIsCurrent
        ? ("base-drift" as const)
        : timeline.isLatest
          ? ("head-advanced" as const)
          : ("historical" as const);
  const selectedHeadIndex = timeline?.selected.headIndex;
  // Memoized so its reference is stable across PR-meta poll ticks — an inline
  // literal would recreate `openCommentComposer` and bust every ChunkCard's
  // memo boundary on each tick (perf review).
  const readOnly = useMemo(
    () =>
      readOnlyKind === undefined
        ? undefined
        : {
            reason:
              readOnlyKind === "historical"
                ? `You're viewing an earlier revision (revision ${selectedHeadIndex ?? "?"}). Switch to the latest revision to comment or submit a review.`
                : readOnlyKind === "base-drift"
                  ? "This brief was generated against a superseded base of the pull request. Switch to the latest revision to comment or submit a review."
                  : "The pull request has newer commits — a new brief is on the way. Commenting and submit resume on the new revision.",
          },
    [readOnlyKind, selectedHeadIndex],
  );

  const selectRevision = useCallback(
    (point: { headSha: string; baseSha: string }) => {
      void navigate({
        // The FULL span is written — head alone cannot address a duplicate-
        // head revision (codex round 4). A jump target (`thread`) is spent
        // once a revision is selected — drop the key entirely
        // (exactOptionalPropertyTypes forbids `undefined`).
        search: ({ thread: _spent, ...rest }) => ({
          ...rest,
          head: point.headSha,
          base: point.baseSha,
        }),
        replace: false,
      });
    },
    [navigate],
  );

  // Outdated-thread → revision jump (BRIEF-24 owns the head-navigation half):
  // a thread anchored on a briefed head navigates to `?head=<anchor>&thread=<id>`
  // (its own base). A miss keeps the affordance disabled — no guessing.
  // `revisionJump` flows into conversationPlan → conversationComposer →
  // every memoized ChunkCard, so its identity must survive PR-meta poll
  // ticks (which rebuild `timeline` and its point objects). Key the memo on
  // a PRIMITIVE fingerprint of the span list — `(head base)` pairs,
  // whitespace-joined; SHAs are hex, the separators cannot collide (the
  // backend's spanKey uses the same property) — and rebuild the pairs from
  // that key (perf review, codex round 4 gate).
  const revisionSpansKey = useMemo(
    () =>
      timeline === undefined
        ? undefined
        : timeline.points.map((p) => `${p.headSha} ${p.baseSha}`).join("\n"),
    [timeline],
  );
  const revisionJump = useMemo(() => {
    if (revisionSpansKey === undefined) return undefined;
    const spans = revisionSpansKey.split("\n").map((line) => {
      const [headSha = "", baseSha = ""] = line.split(" ");
      return { headSha, baseSha };
    });
    return {
      knownHeads: new Set(spans.map((span) => span.headSha)),
      onJump: (anchorSha: string, threadId: number) => {
        // Duplicate heads: the HIGHEST-index row wins — the backend's
        // current-entry (`at(-1)`) choice for the same ambiguity.
        const span = spans.findLast((s) => s.headSha === anchorSha);
        void navigate({
          search: (current) => ({
            ...current,
            head: anchorSha,
            ...(span !== undefined ? { base: span.baseSha } : {}),
            thread: threadId,
          }),
          replace: false,
        });
      },
    };
  }, [navigate, revisionSpansKey]);

  // Pin the selected span into the URL: fresh links get the resolved head+base,
  // and base drift is corrected to the revision's OWN base. A DEGRADED (unknown)
  // head is left in place — the page shows latest with a stable note rather
  // than silently rewriting the address the reviewer followed.
  const pinnedSpan = state.kind === "render" ? state.span : undefined;
  useEffect(() => {
    if (pinnedSpan === undefined || timeline?.degraded) return;
    if (search.head === pinnedSpan.head && search.base === pinnedSpan.base) {
      return;
    }
    void navigate({
      search: (current) => ({
        ...current,
        base: pinnedSpan.base,
        head: pinnedSpan.head,
      }),
      replace: true,
    });
  }, [navigate, pinnedSpan, search.base, search.head, timeline?.degraded]);

  // Announce state swaps AND revision selection to screen readers; re-anchor
  // keyboard focus onto the Brief heading region on either change (ADR 0019 #7).
  // Keyed by the full SPAN identity — duplicate-head revisions differ only by
  // base, and moving between them swaps the content and read-only posture
  // just like any other selection (codex round 6, round-4 identity rule).
  const announcement = timeline
    ? timelineAnnouncement(timeline, readOnly === undefined)
    : stateAnnouncement(state, meta);
  const selectedSpanKey =
    timeline === undefined
      ? undefined
      : `${timeline.selected.baseSha} ${timeline.selected.headSha}`;
  useEffect(() => {
    document.getElementById("main-content")?.focus();
  }, [state.kind, selectedSpanKey]);

  return (
    <>
      <span
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {announcement}
      </span>
      {/* The navigator OWNS head navigation on a multi-revision PR; the legacy
          head-advanced banner only fires on the non-timeline path. */}
      {timeline === undefined &&
      explicit !== undefined &&
      headAdvanced(meta, explicit) ? (
        <HeadAdvancedBanner
          onNavigate={() => {
            void navigate({ search: {}, replace: false });
          }}
        />
      ) : null}
      <PrBriefBody
        meta={meta}
        onNavigateSearch={(next) => {
          void navigate({
            search: (current) => ({ ...current, ...next }),
            replace: false,
          });
        }}
        conversationFocusThreadId={search.thread}
        onSelectRevision={selectRevision}
        prNumber={prNumber}
        readOnly={readOnly}
        repoId={repoId}
        revisionJump={revisionJump}
        searchParams={{
          ...(search.view !== undefined ? { view: search.view } : {}),
          ...(search.compare !== undefined ? { compare: search.compare } : {}),
        }}
        state={state}
        timeline={timeline}
      />
    </>
  );
}

/** The polite revision-selection announcement (ADR 0019 #7 a11y contract). */
function timelineAnnouncement(
  timeline: DbTimelineSelection,
  writable: boolean,
): string {
  if (timeline.degraded) {
    return "That revision is unavailable. Showing the latest brief.";
  }
  const position = `Viewing revision ${timeline.selected.headIndex} of ${timeline.points.length}`;
  return writable ? `${position}.` : `${position}. Read-only.`;
}

/** The BRIEF-64 policy notice for this meta (null for non-authors/defaults). */
function metaPolicyNotice(meta: PrSummary) {
  return draftPolicyNotice(meta.draftPolicy, meta);
}

function stateAnnouncement(
  state: ReturnType<typeof deriveBriefRouteState>,
  meta: PrSummary,
): string {
  const notice = metaPolicyNotice(meta);
  switch (state.kind) {
    case "render":
      return comparisonsWarming(meta)
        ? "Brief ready. Comparisons are still warming."
        : "Brief ready.";
    case "waiting":
      return waitLabel(
        state.status,
        state.phase,
        notice?.kind === "damped" ? notice.text : undefined,
      );
    case "failed":
      return "Brief generation failed.";
    case "superseded":
      return "A newer revision is on the way.";
    case "empty":
      return notice?.kind === "drafts-off"
        ? notice.text
        : "No brief for this pull request yet.";
  }
}

interface PrBriefBodyProps {
  repoId: string;
  prNumber: number;
  meta: PrSummary;
  state: ReturnType<typeof deriveBriefRouteState>;
  searchParams: BriefSearchParams;
  onNavigateSearch: (next: BriefSearch) => void;
  /** Read-only posture + reason on a historical head (BRIEF-24, ADR 0019 #6). */
  readOnly?: { reason: string } | undefined;
  /** The resolved revision timeline (BRIEF-24); absent on legacy metas. */
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  /** Outdated-thread revision jump (BRIEF-24); absent when there is no timeline. */
  revisionJump?: ThreadRevisionJump | undefined;
  /** `?thread=` landing target (BRIEF-24 reads it). */
  conversationFocusThreadId?: number | undefined;
}

function PrBriefBody({
  repoId,
  prNumber,
  meta,
  state,
  searchParams,
  onNavigateSearch,
  readOnly,
  timeline,
  onSelectRevision,
  revisionJump,
  conversationFocusThreadId,
}: PrBriefBodyProps) {
  const policyNotice = metaPolicyNotice(meta);
  switch (state.kind) {
    case "render":
      return (
        <DbBrief
          conversationFocusThreadId={conversationFocusThreadId}
          meta={meta}
          onNavigateSearch={onNavigateSearch}
          onSelectRevision={onSelectRevision}
          prNumber={prNumber}
          readOnly={readOnly}
          repoId={repoId}
          revisionJump={revisionJump}
          searchParams={searchParams}
          span={state.span}
          timeline={timeline}
        />
      );
    case "waiting":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <WaitCard
            phase={state.phase}
            prNumber={prNumber}
            queuedNotice={
              policyNotice?.kind === "damped" ? policyNotice.text : undefined
            }
            repoId={repoId}
            span={state.span}
            status={state.status}
          />
        </main>
      );
    case "failed":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <FailedCard attempts={state.attempts} error={state.error} />
        </main>
      );
    case "superseded":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <SupersededCard />
        </main>
      );
    case "empty":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <EmptyCard
            copyOverride={
              policyNotice?.kind === "drafts-off"
                ? policyNotice.text
                : undefined
            }
          />
        </main>
      );
  }
}

interface DbBriefProps {
  repoId: string;
  prNumber: number;
  span: Span;
  meta: PrSummary;
  searchParams: BriefSearchParams;
  onNavigateSearch: (next: BriefSearch) => void;
  readOnly?: { reason: string } | undefined;
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  revisionJump?: ThreadRevisionJump | undefined;
  conversationFocusThreadId?: number | undefined;
}

function DbBrief({
  repoId,
  prNumber,
  span,
  meta,
  searchParams,
  onNavigateSearch,
  readOnly,
  timeline,
  onSelectRevision,
  revisionJump,
  conversationFocusThreadId,
}: DbBriefProps) {
  const brief = useSuspenseQuery(
    dbBriefQueryOptions(repoId, prNumber, span.base, span.head),
  ).data;
  // Repo-config snapshot (BRIEF-52): best-effort — while loading or on
  // failure the Brief renders without source markers/de-emphasis.
  const repoConfig = useQuery(
    dbBriefContextQueryOptions(repoId, prNumber, span.base, span.head),
  );
  // The live diff arrives client-side and attaches per-chunk rows; while it
  // loads, chunks legally render without a diff (the renderer degrades).
  const diff = useQuery(
    prDiffQueryOptions(repoId, prNumber, span.base, span.head),
  );
  const assembled = useMemo(
    () => (diff.data === undefined ? brief : attachLiveDiffs(brief, diff.data)),
    [brief, diff.data],
  );
  // Comparisons: on the BRIEF-24 timeline path the SELECTED revision's own
  // availability drives the plan (offered wherever spans exist for THIS head,
  // historical included — PR-1 already scoped each envelope to its head). On
  // the legacy non-timeline path, meta.comparisons applies only to the current
  // head (a pinned older span must not borrow the current head's baselines).
  const currentHead = meta.headSha === span.head;
  const effectiveComparisons =
    timeline?.selected.comparisons ??
    (currentHead ? meta.comparisons : undefined);
  const previous = effectiveComparisons?.previousBrief;
  const lastReview = effectiveComparisons?.lastReview;
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
              // Raw span diff toggle (BRIEF-24 #7): previous head → selected
              // head, the same live diff proxy an arbitrary span behind the gate.
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
              // Raw span diff toggle (BRIEF-24 #7): checkpoint → selected head.
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
  const compareState = resolveBriefSearch(searchParams, availability);
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
  // Per-comment post-now (BRIEF-43 PR 4): posts a staged draft NOW, pinned to
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
  // Keys the per-brief Mind-Map session store, exactly like a local brief id.
  const briefId = `db:${repoId}:${String(prNumber)}:${span.base}:${span.head}`;
  // The live-conversation plan (BRIEF-25): always fetched fresh per PR —
  // resolution flips and replies happen outside our generation cycle.
  const conversationPlan = useMemo(
    () => ({
      queryOptions: conversationQueryOptions(repoId, prNumber),
      postReply: (rootCommentId: number, body: string) =>
        postConversationReply(repoId, prNumber, rootCommentId, body),
      ...(revisionJump === undefined ? {} : { revisionJump }),
    }),
    [prNumber, repoId, revisionJump],
  );
  // The unified control surface (BRIEF-24 UX pass): revision navigator +
  // View/Compare lenses render in the STICKY header's control slot — always
  // discoverable, never scrolled out of reach by the selection focus effect.
  const headerControls = (
    <DbBriefControls
      compare={{
        availability,
        compareState,
        lastReviewDisabledReason,
        onNavigate: onNavigateSearch,
      }}
      note={
        timeline?.degraded
          ? "That revision link is no longer available — showing the latest brief."
          : undefined
      }
      onSelectRevision={onSelectRevision}
      readOnly={readOnly !== undefined}
      timeline={timeline}
    />
  );
  return (
    <>
      {/* Warming is a property of the LATEST generation — never shown while a
          historical (read-only) revision is in view (history never polls). */}
      {readOnly === undefined && comparisonsWarming(meta) ? (
        <WarmingChip />
      ) : null}
      <BriefView
        artifacts={[]}
        brief={assembled}
        repoConfig={repoConfig.data ?? null}
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        conversation={conversationPlan}
        conversationFocusThreadId={conversationFocusThreadId}
        headerControls={headerControls}
        key={briefId}
        ownDraft={ownDraft}
        readOnly={readOnly}
        searchParams={searchParams}
        submitReview={submitAction}
      />
    </>
  );
}

function PrBriefError({ error }: { error: Error }) {
  const detail =
    error instanceof ApiError
      ? error.kind === ApiErrorKind.NOT_FOUND
        ? "This pull request (or this span's brief) was not found."
        : error.kind === ApiErrorKind.UNAUTHORIZED
          ? "You need to sign in to read this brief."
          : "The MergeBrief backend is unreachable right now — try again shortly."
      : error.message;
  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section className={styles["errorState"]}>
        <h1>Brief failed to load</h1>
        <p>{detail}</p>
        {error instanceof ApiError &&
        error.kind === ApiErrorKind.UNAUTHORIZED ? (
          <a className="btn primary" href="/auth/github">
            Sign in with GitHub
          </a>
        ) : null}
      </section>
    </main>
  );
}
