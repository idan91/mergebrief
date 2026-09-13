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
  buildBriefSearchParams,
  parseCompareParam,
  parseDiffParam,
  parseViewParam,
  type BriefSearch,
  type BriefSearchParams,
} from "@web/features/brief/comparison";
import {
  type DbTimelinePoint,
  deriveBriefRouteState,
  resolveDbTimeline,
  shouldPollMeta,
  type Span,
} from "@web/features/pulls/utils";
import { PrBriefBody, PrBriefError } from "@web/features/pulls";
import {
  dbBriefQueryOptions,
  prMetaQueryOptions,
  sessionQueryOptions,
} from "../features/pulls/queries";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";
import {
  conversationFilterSearch,
  parseConversationFilter,
  type ConversationFilter,
  type ConversationFilterSearch,
} from "@web/features/conversation/utils";
import type { Mutable } from "types";

const META_POLL_MS = 4000;

interface PrBriefSearch extends BriefSearchParams, ConversationFilterSearch {
  base?: string;
  head?: string;
  /** This route reserves the param; the conversation section reads it. */
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

function coerceNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

function resolveThreadParam(value: unknown): number | undefined {
  const parsed = coerceNumber(value);
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

function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.code === ApiErrorCodes.NOT_FOUND;
}

/** A missing PR/brief becomes a real 404 on SSR, not a 500. */
function mapLoaderError(error: unknown): never {
  if (error instanceof ApiError && error.code === ApiErrorCodes.UNAUTHORIZED) {
    throw redirect({ href: "/api/auth/github" });
  }
  if (isNotFoundError(error)) {
    throw notFound();
  }
  throw error;
}

/** Degrades: a failed read disables writes rather than failing the route. */
/**
 * The cached error entry is dropped: the query is retry:false with staleTime
 * Infinity, so `useSuspenseQuery` would throw it instead of refetching.
 */
function dropMissingBriefPrefetch(
  queryClient: QueryClient,
  reason: unknown,
  repoId: string,
  prNumber: number,
  span: Span,
): void {
  if (!isNotFoundError(reason)) {
    mapLoaderError(reason);
  }

  queryClient.removeQueries({
    queryKey: dbBriefQueryOptions(repoId, prNumber, span.base, span.head)
      .queryKey,
    exact: true,
  });
}

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
    // Only head selects a revision; resolve its base from revisions rather than the URL.
    // Retain a supplied base only with a head. Unknown heads degrade to latest, not 404.
    const view = parseViewParam(search["view"]);
    const compare = parseCompareParam(search["compare"]);
    const diff = parseDiffParam(search["diff"]);
    const thread = resolveThreadParam(search["thread"]);
    const parsed: PrBriefSearch = {};

    if (nonEmpty(head)) parsed.head = head;
    if (nonEmpty(head) && nonEmpty(base)) parsed.base = base;
    if (view !== undefined) parsed.view = view;
    if (compare !== undefined) parsed.compare = compare;
    if (diff !== undefined) parsed.diff = diff;
    if (thread !== undefined) parsed.thread = thread;

    return {
      ...parsed,
      ...conversationFilterSearch(parseConversationFilter(search)),
    };
  },
  loaderDeps: ({ search }) => {
    const deps: Pick<PrBriefSearch, "base" | "head"> = {};

    if (search.base !== undefined) deps.base = search.base;
    if (search.head !== undefined) deps.head = search.head;

    return deps;
  },
  loader: async ({ context, params, deps }) => {
    const repoId = assertRepoId(params.repoId);
    const prNumber = parsePrNumber(params.prNumber);
    const explicit = spanFromSearch(deps);
    try {
      if (explicit !== undefined) {
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
          dropMissingBriefPrefetch(
            context.queryClient,
            briefResult.reason,
            repoId,
            prNumber,
            explicit,
          );
        }
        return;
      }
      const meta = await context.queryClient.ensureQueryData(
        prMetaQueryOptions(repoId, prNumber),
      );
      // Prefetch the SELECTED revision's brief with ITS OWN base (`deps.base`
      // disambiguates duplicate-head rows) so a historical head SSRs correctly.
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
  // Leaving the page must not dim the brief.
  const revisionPending = useRouterState({
    select: (state) =>
      state.status === "pending" &&
      PR_BRIEF_PATH_PATTERN.test(state.location.pathname),
  });
  // A fresh literal per render re-runs the span-pinning effect.
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

  const timeline = useMemo(
    () => resolveDbTimeline(meta.revisions, search.head, search.base),
    [meta.revisions, search.base, search.head],
  );

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

  // Base drift stays read-only because the rendered anchors may be wrong;
  // head drift only needs an acknowledgement.
  const selectedHeadIsCurrent =
    timeline !== undefined && timeline.selected.headSha === meta.headSha;
  const selectedBaseIsCurrent =
    timeline !== undefined &&
    (meta.baseSha === null || timeline.selected.baseSha === meta.baseSha);
  const baseDrift = selectedHeadIsCurrent && !selectedBaseIsCurrent;
  const renderedHead = state.kind === "render" ? state.span.head : undefined;
  const staleHead =
    renderedHead !== undefined &&
    meta.headSha !== null &&
    meta.headSha !== renderedHead;
  const newerRevisionSelectable =
    timeline === undefined ||
    timeline.selectedIndex < timeline.points.length - 1;
  // An inline literal busts every ChunkCard's memo boundary per poll tick.
  const readOnly = useMemo(
    () => (baseDrift ? { reason: BASE_DRIFT_REASON } : undefined),
    [baseDrift],
  );

  const briefSearch = useMemo<BriefSearchParams>(
    () => buildBriefSearchParams(search.view, search.compare, search.diff),
    [search.view, search.compare, search.diff],
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
        // The FULL span is written, head alone cannot address a duplicate-
        // head revision. A jump target (`thread`) is spent once a revision is
        // selected, drop the key entirely (exactOptionalPropertyTypes
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

  // Hex SHAs cannot collide with its separators.
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
          search: (current) => {
            const next: PrBriefSearch = { ...current, head: anchorSha };

            // Key order is URL param order: base lands before thread.
            if (span !== undefined) next.base = span.baseSha;
            next.thread = threadId;

            return next;
          },
          replace: false,
        });
      },
    };
  }, [navigate, revisionSpansKey]);

  // Pin the selected span into the URL: fresh links get the resolved head+base,
  // and base drift is corrected to the revision's OWN base. A DEGRADED (unknown)
  // head is left in place, the page shows latest with a stable note rather
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
  // themselves survive a revision change, the brief subtree is no longer
  // keyed by brief id, so focus normally just stays put. Never scrolls.
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
  const conversationFilter = useMemo(() => {
    const filterSearch: Mutable<ConversationFilterSearch> = {};

    if (search.verdicts !== undefined) filterSearch.verdicts = search.verdicts;
    if (search.reviewers !== undefined) {
      filterSearch.reviewers = search.reviewers;
    }
    if (search.reviews !== undefined) filterSearch.reviews = search.reviews;

    return parseConversationFilter(filterSearch);
  }, [search.reviewers, search.reviews, search.verdicts]);
  // `replace`: a filter is a triage gesture, not a destination, ten chip
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
