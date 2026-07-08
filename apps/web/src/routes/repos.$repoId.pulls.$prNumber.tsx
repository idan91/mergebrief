// The DB-backed brief route (BRIEF-19 PR 3.2): the deep-link target PR
// comments point at. Loader SSR-prefetches exactly what the link names
// (PR-meta + the brief when the span is known — hybrid strategy); the heavy/
// dynamic rest (live diff, status polling) is client-side. The wait UX is the
// pure `briefRouteState` machine; render trigger = artifact EXISTS
// (ADR 0006 #10), status only flavors the wait.
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
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
import { DbCompareBar } from "../features/pulls/components/DbCompareBar";
import { attachLiveDiffs } from "../features/pulls/liveDiff";
import {
  dbBriefQueryOptions,
  dbComparisonMarksQueryOptions,
  dbDeltaQueryOptions,
  dbRevisionNarrativeQueryOptions,
  prDiffQueryOptions,
  prMetaQueryOptions,
} from "../features/pulls/queries";
import { conversationQueryOptions } from "../features/conversation/queries";
import { postConversationReply } from "../features/conversation/reply";
import { submitReview } from "../features/pulls/submitReview";
import type { PrSummary } from "../features/pulls/types";
import {
  buildSubmitPayload,
  type SubmitDraftInput,
  type SubmitReviewAction,
} from "../features/review/submit";
import styles from "./routeShared.module.scss";

/** 3–5s window per the plan; one lightweight PR-meta read per tick. */
const META_POLL_MS = 4000;

interface PrBriefSearch extends BriefSearchParams {
  base?: string;
  head?: string;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Both-or-neither: a lone base/head cannot address a span. */
function spanFromSearch(search: PrBriefSearch): Span | undefined {
  return search.base !== undefined && search.head !== undefined
    ? { base: search.base, head: search.head }
    : undefined;
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

/**
 * Loader error mapping: an unauthenticated read sends the viewer to login; a
 * missing PR/brief becomes the router's 404 (a real HTTP 404 on SSR, not a
 * 500). Everything else propagates to the error component.
 */
function mapLoaderError(error: unknown): never {
  if (error instanceof ApiError && error.kind === ApiErrorKind.UNAUTHORIZED) {
    throw redirect({ href: "/auth/github" });
  }
  if (error instanceof ApiError && error.kind === ApiErrorKind.NOT_FOUND) {
    throw notFound();
  }
  throw error;
}

export const Route = createFileRoute("/repos/$repoId/pulls/$prNumber")({
  validateSearch: (search: Record<string, unknown>): PrBriefSearch => {
    const base = search["base"];
    const head = search["head"];
    // A span is BOTH-or-neither: a lone base/head cannot address one, so it
    // is normalized away HERE (not silently ignored downstream) — the route
    // then behaves exactly like a span-less deep link and pins the resolved
    // span into the URL, rather than 404ing a sloppy-but-recoverable link.
    const spanComplete = nonEmpty(base) && nonEmpty(head);
    // View/Compare (ADR 0024) share the local route's parse-or-omit posture.
    const view = parseViewParam(search["view"]);
    const compare = parseCompareParam(search["compare"]);
    return {
      ...(spanComplete ? { base, head } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(compare !== undefined ? { compare } : {}),
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
        // Deep link with a span: meta + brief in parallel — no waterfall.
        await Promise.all([
          context.queryClient.ensureQueryData(
            prMetaQueryOptions(repoId, prNumber),
          ),
          context.queryClient.ensureQueryData(
            dbBriefQueryOptions(repoId, prNumber, explicit.base, explicit.head),
          ),
        ]);
        return;
      }
      // Span unknown: the meta names it, then the brief prefetches only when
      // it is actually renderable (a wait state needs nothing else).
      const meta = await context.queryClient.ensureQueryData(
        prMetaQueryOptions(repoId, prNumber),
      );
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

  const state = deriveBriefRouteState(meta, explicit);

  // Pin the resolved span into the URL once rendering without one: the view
  // stays stable (a head advance offers navigation, never yanks the page) and
  // the address bar becomes a shareable exact-span deep link.
  useEffect(() => {
    if (explicit === undefined && state.kind === "render") {
      void navigate({
        search: (current) => ({
          ...current,
          base: state.span.base,
          head: state.span.head,
        }),
        replace: true,
      });
    }
  }, [explicit, navigate, state]);

  // Announce state swaps to screen readers and re-anchor keyboard focus.
  const announcement = stateAnnouncement(state, meta);
  useEffect(() => {
    document.getElementById("main-content")?.focus();
  }, [state.kind]);

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
      {explicit !== undefined && headAdvanced(meta, explicit) ? (
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
        prNumber={prNumber}
        repoId={repoId}
        searchParams={{
          ...(search.view !== undefined ? { view: search.view } : {}),
          ...(search.compare !== undefined ? { compare: search.compare } : {}),
        }}
        state={state}
      />
    </>
  );
}

function stateAnnouncement(
  state: ReturnType<typeof deriveBriefRouteState>,
  meta: PrSummary,
): string {
  switch (state.kind) {
    case "render":
      return comparisonsWarming(meta)
        ? "Brief ready. Comparisons are still warming."
        : "Brief ready.";
    case "waiting":
      return waitLabel(state.status, state.phase);
    case "failed":
      return "Brief generation failed.";
    case "superseded":
      return "A newer revision is on the way.";
    case "empty":
      return "No Brief for this pull request yet.";
  }
}

interface PrBriefBodyProps {
  repoId: string;
  prNumber: number;
  meta: PrSummary;
  state: ReturnType<typeof deriveBriefRouteState>;
  searchParams: BriefSearchParams;
  onNavigateSearch: (next: BriefSearch) => void;
}

function PrBriefBody({
  repoId,
  prNumber,
  meta,
  state,
  searchParams,
  onNavigateSearch,
}: PrBriefBodyProps) {
  switch (state.kind) {
    case "render":
      return (
        <DbBrief
          meta={meta}
          onNavigateSearch={onNavigateSearch}
          prNumber={prNumber}
          repoId={repoId}
          searchParams={searchParams}
          span={state.span}
        />
      );
    case "waiting":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <WaitCard
            phase={state.phase}
            prNumber={prNumber}
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
          <EmptyCard />
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
}

function DbBrief({
  repoId,
  prNumber,
  span,
  meta,
  searchParams,
  onNavigateSearch,
}: DbBriefProps) {
  const brief = useSuspenseQuery(
    dbBriefQueryOptions(repoId, prNumber, span.base, span.head),
  ).data;
  // The live diff arrives client-side and attaches per-chunk rows; while it
  // loads, chunks legally render without a diff (the renderer degrades).
  const diff = useQuery(
    prDiffQueryOptions(repoId, prNumber, span.base, span.head),
  );
  const assembled = useMemo(
    () => (diff.data === undefined ? brief : attachLiveDiffs(brief, diff.data)),
    [brief, diff.data],
  );
  // Comparisons (BRIEF-19 4.1 + BRIEF-21): offered exactly when the meta says
  // their marks exist AND the comparison targets the RENDERED span's head (a
  // pinned older span must not borrow the current head's baselines).
  const previous = meta.comparisons?.previousBrief;
  const lastReview = meta.comparisons?.lastReview;
  const currentHead = meta.headSha === span.head;
  const comparisonPlan = useMemo<BriefComparisonPlan>(() => {
    if (!currentHead) {
      return {};
    }
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
  }, [currentHead, lastReview, prNumber, previous, repoId, span.head]);
  const availability: CompareOptionFlags = {
    previousBrief: comparisonPlan.previousBrief !== undefined,
    lastReview: comparisonPlan.lastReview !== undefined,
  };
  // A checkpoint that EXISTS but cannot be compared gets its honest reason on
  // the disabled control; an absent field keeps the generic copy.
  const lastReviewDisabledReason =
    currentHead && lastReview?.kind === "unavailable"
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
  // Keys the per-brief Mind-Map session store, exactly like a local brief id.
  const briefId = `db:${repoId}:${String(prNumber)}:${span.base}:${span.head}`;
  // The live-conversation plan (BRIEF-25): always fetched fresh per PR —
  // resolution flips and replies happen outside our generation cycle.
  const conversationPlan = useMemo(
    () => ({
      queryOptions: conversationQueryOptions(repoId, prNumber),
      postReply: (rootCommentId: number, body: string) =>
        postConversationReply(repoId, prNumber, rootCommentId, body),
    }),
    [prNumber, repoId],
  );
  return (
    <>
      {comparisonsWarming(meta) ? <WarmingChip /> : null}
      <DbCompareBar
        availability={availability}
        compareState={compareState}
        lastReviewDisabledReason={lastReviewDisabledReason}
        onNavigate={onNavigateSearch}
      />
      <BriefView
        artifacts={[]}
        brief={assembled}
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        conversation={conversationPlan}
        key={briefId}
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
        ? "This pull request (or this span's Brief) was not found."
        : error.kind === ApiErrorKind.UNAUTHORIZED
          ? "You need to sign in to read this Brief."
          : "The Brief backend is unreachable right now — try again shortly."
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
