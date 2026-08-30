// The DB-backed brief route: the deep-link target PR comments point at. The
// loader SSR-prefetches exactly what the link names (PR-meta, plus the brief
// when the span is known); live diff and status polling stay client-side. The
// render trigger is artifact EXISTS — status only flavors the wait state.
// Composition only: the body switch, state cards, and plan assembly live in
// `features/pulls`.
import { useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { ApiError, ApiErrorCodes } from "../data/apiFetch";
import {
  parseCompareParam,
  parseViewParam,
  type BriefSearch,
  type BriefSearchParams,
} from "../features/brief/comparison/compareState";
import {
  deriveBriefRouteState,
  shouldPollMeta,
  type Span,
} from "../features/pulls/utils/briefRouteState";
import { PrBriefBody, PrBriefError } from "@web/features/pulls";
import {
  dbBriefQueryOptions,
  prMetaQueryOptions,
  sessionQueryOptions,
} from "../features/pulls/queries";
import {
  resolveDbTimeline,
  type DbTimelinePoint,
} from "../features/pulls/utils/dbTimeline";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";
import {
  conversationFilterSearch,
  parseConversationFilter,
  type ConversationFilter,
  type ConversationFilterSearch,
} from "@web/features/conversation/utils/filter";

/** One lightweight PR-meta read per tick. */
const META_POLL_MS = 4000;

interface PrBriefSearch extends BriefSearchParams, ConversationFilterSearch {
  base?: string;
  head?: string;
  /**
   * The outdated-thread jump target: the thread's databaseId. This route owns
   * head navigation and reserves the param; the conversation section reads it
   * to open/flash the thread.
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

/** Full-span identity: duplicate-head revisions differ only by base. */
function buildSpanKey(baseSha: string, headSha: string): string {
  return `${baseSha} ${headSha}`;
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
  return error instanceof ApiError && error.code === ApiErrorCodes.NOT_FOUND;
}

/**
 * Loader error mapping: an unauthenticated read sends the viewer to login; a
 * missing PR/brief becomes the router's 404 (a real HTTP 404 on SSR, not a
 * 500). Everything else propagates to the error component.
 */
function mapLoaderError(error: unknown): never {
  if (error instanceof ApiError && error.code === ApiErrorCodes.UNAUTHORIZED) {
    throw redirect({ href: "/api/auth/github" });
  }
  if (isNotFoundError(error)) {
    throw notFound();
  }
  throw error;
}

/**
 * The Review Session, read alongside the Brief artifact so the first paint is
 * already marked. It DEGRADES: a failed read leaves an error in the cache,
 * which the screen renders as an unavailable session with writes off — it
 * never fails the route. The read creates nothing.
 */
function prefetchSession(
  queryClient: QueryClient,
  repoId: string,
  prNumber: number,
  span: Span,
): Promise<void> {
  // The descriptor is stale-immediately so a window-focus refetch picks up a
  // CLI write; the LOADER wants the opposite. Without this override every
  // same-route search write (a filter chip, a View/Compare toggle) would block
  // the router on a session round-trip and dim the screen behind it.
  return queryClient.prefetchQuery({
    ...sessionQueryOptions(repoId, prNumber, span.base, span.head),
    staleTime: 30_000,
  });
}

export const Route = createFileRoute("/repos/$repoId/pulls/$prNumber")({
  validateSearch: (search: Record<string, unknown>): PrBriefSearch => {
    const base = search["base"];
    const head = search["head"];
    // `head` is the revision-selection key, kept on its own so a `?head=<sha>`
    // deep link selects a revision — its base resolves from `revisions[]`,
    // never the URL. A lone `base` cannot address anything, so it survives only
    // alongside a head; an unknown head degrades to latest downstream rather
    // than 404ing a stale link.
    const view = parseViewParam(search["view"]);
    const compare = parseCompareParam(search["compare"]);
    const thread = parseThreadParam(search["thread"]);
    return {
      ...(nonEmpty(head) ? { head } : {}),
      ...(nonEmpty(head) && nonEmpty(base) ? { base } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(compare !== undefined ? { compare } : {}),
      ...(thread !== undefined ? { thread } : {}),
      // Parsed and re-projected, so unknown tokens drop and the surviving
      // selection lands in canonical order.
      ...conversationFilterSearch(parseConversationFilter(search)),
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
        // Deep link with a span: meta + brief in parallel, no waterfall. While
        // the PR's first brief is still generating the link names a span whose
        // artifact 404s, and that must NOT 404 the page. Swallow ONLY a
        // brief-query NOT_FOUND; a missing PR is still a real 404 and any other
        // brief failure propagates.
        const [metaResult, briefResult] = await Promise.allSettled([
          context.queryClient.ensureQueryData(
            prMetaQueryOptions(repoId, prNumber),
          ),
          context.queryClient.ensureQueryData(
            dbBriefQueryOptions(repoId, prNumber, explicit.base, explicit.head),
          ),
          prefetchSession(context.queryClient, repoId, prNumber, explicit),
        ]);
        if (metaResult.status === "rejected") {
          mapLoaderError(metaResult.reason);
        }
        if (briefResult.status === "rejected") {
          if (!isNotFoundError(briefResult.reason)) {
            mapLoaderError(briefResult.reason);
          }
          // `ensureQueryData` already wrote an ERROR entry into the brief query
          // cache, and `dbBriefQueryOptions` is retry:false + staleTime
          // Infinity — the later `useSuspenseQuery` would THROW that cached
          // error instead of refetching. Drop it so the first render fetches
          // fresh.
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
      // Prefetch the SELECTED revision's brief with ITS OWN base (`deps.base`
      // disambiguates duplicate-head rows) so a historical head SSRs correctly.
      // An unknown head degrades to latest — never a 404.
      const timeline = resolveDbTimeline(meta.revisions, deps.head, deps.base);
      if (timeline !== undefined) {
        const span = {
          base: timeline.selected.baseSha,
          head: timeline.selected.headSha,
        };
        await Promise.all([
          context.queryClient.ensureQueryData(
            dbBriefQueryOptions(repoId, prNumber, span.base, span.head),
          ),
          prefetchSession(context.queryClient, repoId, prNumber, span),
        ]);
        return;
      }
      const state = deriveBriefRouteState(meta, undefined);
      if (state.kind === "render") {
        await Promise.all([
          context.queryClient.ensureQueryData(
            dbBriefQueryOptions(
              repoId,
              prNumber,
              state.span.base,
              state.span.head,
            ),
          ),
          prefetchSession(context.queryClient, repoId, prNumber, state.span),
        ]);
      }
    } catch (error) {
      mapLoaderError(error);
    }
  },
  component: PrBriefRoute,
  errorComponent: PrBriefError,
});

/**
 * The one hard read-only reason: a superseded BASE renders a diff that is not
 * the PR's current one, so line anchors can land wrong or nowhere on GitHub.
 * Head-mismatch staleness is writable behind a submit ack instead.
 */
const BASE_DRIFT_REASON =
  "This brief was generated against a superseded base of the pull request. Switch to the latest revision to comment or submit a review.";

/** Exactly a PR-brief page, never any other repos surface. */
const PR_BRIEF_PATH_PATTERN = /^\/repos\/[^/]+\/pulls\/[^/]+$/;

function PrBriefRoute() {
  // Route-level so BriefScreen itself stays renderable without a router.
  useUnsavedComposerBlocker();
  const params = Route.useParams();
  const repoId = params.repoId;
  const prNumber = parsePrNumber(params.prNumber);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Pending only while a navigation TARGETING a PR-brief page runs its
  // loader (a revision select re-runs it via loaderDeps): leaving the page
  // never dims the brief.
  const revisionPending = useRouterState({
    select: (state) =>
      state.status === "pending" &&
      PR_BRIEF_PATH_PATTERN.test(state.location.pathname),
  });
  // Memoized on the primitives: `state`/`pinnedSpan` identity chains hang off
  // this object, and a fresh literal per render re-runs the span-pinning
  // effect whenever ?base=&head= are present.
  const explicit = useMemo(
    () =>
      search.base !== undefined && search.head !== undefined
        ? { base: search.base, head: search.head }
        : undefined,
    [search.base, search.head],
  );

  const meta = useSuspenseQuery({
    ...prMetaQueryOptions(repoId, prNumber),
    refetchInterval: (query) =>
      query.state.data !== undefined && shouldPollMeta(query.state.data)
        ? META_POLL_MS
        : false,
  }).data;

  // `?head=` (+ `base`, which disambiguates duplicate-head rows from a
  // retarget re-brief) selects a timeline point; an unknown head degrades to
  // latest. Absent, the legacy explicit-span / current-head flow applies.
  const timeline = useMemo(
    () => resolveDbTimeline(meta.revisions, search.head, search.base),
    [meta.revisions, search.base, search.head],
  );

  // Full SPAN identity: duplicate-head revisions differ only by base.
  const selectedSpanKey =
    timeline === undefined
      ? undefined
      : buildSpanKey(timeline.selected.baseSha, timeline.selected.headSha);

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

  // Write posture. The submit route pins commit_id to the viewed head and
  // anchors are read against the RENDERED (base…head) diff, so two stale
  // shapes exist:
  // - HEAD mismatch: GitHub accepts a review pinned to the older head and
  //   marks its comments outdated — writable behind an explicit ack.
  // - BASE mismatch: the rendered diff is not the PR's current one, so anchors
  //   can land wrong or nowhere — stays hard read-only.
  // `meta.baseSha` is comparable here: with `briefAvailable` it is the latest
  // brief row's own base, the same row `revisions[]` ends with; a null meta
  // base cannot veto. Derived as primitives so the memo below survives poll
  // ticks, which rebuild `timeline` object identities.
  const selectedHeadIsCurrent =
    timeline !== undefined && timeline.selected.headSha === meta.headSha;
  const selectedBaseIsCurrent =
    timeline !== undefined &&
    (meta.baseSha === null || timeline.selected.baseSha === meta.baseSha);
  const baseDrift = selectedHeadIsCurrent && !selectedBaseIsCurrent;
  // Unified across the timeline and legacy explicit-span paths: any rendered
  // span whose head is not the PR's current head submits behind the ack.
  const renderedHead = state.kind === "render" ? state.span.head : undefined;
  const staleHead =
    renderedHead !== undefined &&
    meta.headSha !== null &&
    meta.headSha !== renderedHead;
  // Whether a stale head has anywhere to go; see StaleRevisionChipProps.
  const newerRevisionSelectable =
    timeline === undefined ||
    timeline.selectedIndex < timeline.points.length - 1;
  // Memoized so its reference is stable across PR-meta poll ticks — an inline
  // literal would recreate the composer wiring downstream and bust every
  // ChunkCard's memo boundary on each tick.
  const readOnly = useMemo(
    () => (baseDrift ? { reason: BASE_DRIFT_REASON } : undefined),
    [baseDrift],
  );

  // Hoisted: an inline literal is a new object per render, busting the memo
  // boundaries downstream on every poll tick.
  const briefSearch = useMemo<BriefSearchParams>(
    () => ({
      ...(search.view !== undefined ? { view: search.view } : {}),
      ...(search.compare !== undefined ? { compare: search.compare } : {}),
    }),
    [search.view, search.compare],
  );

  /** Drop the pinned span so it re-resolves to latest. */
  const goToNewest = useCallback(() => {
    void navigate({
      search: ({ head: _h, base: _b, thread: _spent, ...rest }) => rest,
      replace: false,
      resetScroll: false,
    });
  }, [navigate]);

  const selectRevision = useCallback(
    (point: DbTimelinePoint) => {
      void navigate({
        // The FULL span is written — head alone cannot address a duplicate-
        // head revision. A jump target (`thread`) is spent once a revision is
        // selected — drop the key entirely (exactOptionalPropertyTypes
        // forbids `undefined`).
        search: ({ thread: _spent, ...rest }) => ({
          ...rest,
          head: point.headSha,
          base: point.baseSha,
        }),
        replace: false,
        // A revision is a lateral move, not a new page.
        resetScroll: false,
      });
    },
    [navigate],
  );

  // Outdated-thread → revision jump: a thread anchored on a briefed head
  // navigates to `?head=<anchor>&thread=<id>` with its own base; a miss keeps
  // the affordance disabled rather than guessing. `revisionJump` reaches every
  // memoized ChunkCard, so its identity must survive PR-meta poll ticks (which
  // rebuild `timeline` and its point objects) — hence the memo keys on a
  // PRIMITIVE fingerprint of the span list, and the pairs are rebuilt from it.
  // SHAs are hex, so the separators cannot collide.
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
        // Duplicate heads: the HIGHEST-index row wins, matching the backend's
        // current-entry choice for the same ambiguity.
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

  // Re-anchor onto the brief only when focus was left NOWHERE (e.g. the
  // operated stepper went aria-disabled at a timeline boundary). The controls
  // themselves survive a revision change — the brief subtree is no longer
  // keyed by brief id — so focus normally just stays put. Never scrolls.
  useEffect(() => {
    const active = document.activeElement;
    const focusSurvived =
      active instanceof HTMLElement &&
      active !== document.body &&
      active.isConnected;
    if (focusSurvived) return;
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [state.kind, selectedSpanKey]);

  // Stable across renders (navigate is): GroupCard's memo boundary rides on
  // the identity PrBriefContent derives from this.
  const onNavigateSearch = useCallback(
    (next: BriefSearch) => {
      void navigate({
        search: (current) => ({ ...current, ...next }),
        replace: false,
      });
    },
    [navigate],
  );

  // Identity is stabilized on the raw param STRINGS: the parsed filter holds
  // fresh Sets every render, and it rides into the memo boundaries that keep
  // inline threads off the render path.
  const conversationFilter = useMemo(
    () =>
      parseConversationFilter({
        ...(search.verdicts === undefined ? {} : { verdicts: search.verdicts }),
        ...(search.reviewers === undefined
          ? {}
          : { reviewers: search.reviewers }),
        ...(search.reviews === undefined ? {} : { reviews: search.reviews }),
      }),
    [search.reviewers, search.reviews, search.verdicts],
  );
  // `replace`: a filter is a triage gesture, not a destination — ten chip
  // clicks must not become ten back-button steps.
  const onConversationFilterChange = useCallback(
    (next: ConversationFilter) => {
      void navigate({
        // The three filter keys are DROPPED before the projection is laid
        // down, so clearing a family removes its key instead of stranding a
        // stale one.
        search: ({
          verdicts: _verdicts,
          reviewers: _reviewers,
          reviews: _reviews,
          ...rest
        }) => ({
          ...rest,
          ...conversationFilterSearch(next),
        }),
        replace: true,
      });
    },
    [navigate],
  );

  return (
    <PrBriefBody
      meta={meta}
      onNavigateSearch={onNavigateSearch}
      conversationFilter={conversationFilter}
      onConversationFilterChange={onConversationFilterChange}
      conversationFocusThreadId={search.thread}
      onSelectRevision={selectRevision}
      prNumber={prNumber}
      readOnly={readOnly}
      repoId={repoId}
      revisionJump={revisionJump}
      revisionPending={revisionPending}
      searchParams={briefSearch}
      staleHead={staleHead}
      state={state}
      timeline={timeline}
      {...(newerRevisionSelectable ? { onGoToNewest: goToNewest } : {})}
    />
  );
}
