import { useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { ApiError, ApiErrorCodes } from "../data/apiFetch";
import { appI18n } from "../i18n/I18nProvider";
import {
  buildBriefSearchParams,
  parseCompareParam,
  parseDiffParam,
  parseViewParam,
  type BriefSearchParams,
} from "@web/features/brief/comparison";
import {
  type DbTimelinePoint,
  deriveBriefRouteState,
  resolveDbTimeline,
  type RevisionRequest,
  shouldPollMeta,
  type Span,
} from "@web/features/pulls/utils";
import type { ScopeExitOptions } from "@web/features/brief";
import { AttachmentScopeProvider } from "@web/components/Markdown/context";
import { PrBriefBody, PrBriefError } from "@web/features/pulls";
import {
  buildDbBriefQueryOptions,
  buildPrMetaQueryOptions,
  buildSessionQueryOptions,
} from "../features/pulls/queries";
import type { PrSummary } from "../features/pulls/types";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";
import {
  conversationFilterSearch,
  parseConversationFilter,
  type ConversationFilter,
  type ConversationFilterSearch,
} from "@web/features/conversation/utils";
import { buildPrPageTitle, type PrPageTitleInput } from "@web/utils/pageTitle";
import type { Mutable } from "types/utils";

const META_POLL_MS = 4000;

interface PrBriefSearch extends BriefSearchParams, ConversationFilterSearch {
  /** The brief's index on this PR; the one revision key fresh links carry. */
  rev?: number;
  /** Legacy span keys, read only: an old Entry-comment link still lands. */
  base?: string;
  head?: string;
  /** This route reserves the param; the conversation section reads it. */
  thread?: number;
  /** A chunk, or lines inside one, to land on; the brief screen parses it. */
  l?: string;
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

function resolvePositiveInteger(value: unknown): number | undefined {
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
    queryKey: buildDbBriefQueryOptions(repoId, prNumber, span.base, span.head)
      .queryKey,
    exact: true,
  });
}

function pickPageTitleInput(meta: PrSummary): PrPageTitleInput {
  return {
    title: meta.title,
    prNumber: meta.prNumber,
    repoSlug: meta.repoSlug,
  };
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
    ...buildSessionQueryOptions(repoId, prNumber, span.base, span.head),
    staleTime: 30_000,
  });
}

export const Route = createFileRoute("/repos/$repoId/pulls/$prNumber")({
  validateSearch: (search: Record<string, unknown>): PrBriefSearch => {
    const base = search["base"];
    const head = search["head"];
    // `rev` selects a revision; a legacy head still does, with its base
    // retained only beside it. Unknown revisions degrade to latest, not 404.
    const rev = resolvePositiveInteger(search["rev"]);
    const view = parseViewParam(search["view"]);
    const compare = parseCompareParam(search["compare"]);
    const diff = parseDiffParam(search["diff"]);
    const thread = resolvePositiveInteger(search["thread"]);
    const link = search["l"];
    const parsed: PrBriefSearch = {};

    if (rev !== undefined) {
      parsed.rev = rev;
    }
    if (nonEmpty(head)) {
      parsed.head = head;
    }
    if (nonEmpty(head) && nonEmpty(base)) {
      parsed.base = base;
    }
    if (view !== undefined) parsed.view = view;
    if (compare !== undefined) parsed.compare = compare;
    if (diff !== undefined) parsed.diff = diff;
    if (thread !== undefined) parsed.thread = thread;
    if (nonEmpty(link)) {
      parsed.l = link;
    }

    return {
      ...parsed,
      ...conversationFilterSearch(parseConversationFilter(search)),
    };
  },
  loaderDeps: ({ search }) => {
    const deps: Mutable<RevisionRequest> = {};

    if (search.rev !== undefined) {
      deps.rev = search.rev;
    }
    if (search.base !== undefined) {
      deps.base = search.base;
    }
    if (search.head !== undefined) {
      deps.head = search.head;
    }

    return deps;
  },
  loader: async ({ context, params, deps }) => {
    const repoId = assertRepoId(params.repoId);
    const prNumber = parsePrNumber(params.prNumber);
    const explicit = deps.rev === undefined ? spanFromSearch(deps) : undefined;
    try {
      if (explicit !== undefined) {
        const [metaResult, briefResult] = await Promise.allSettled([
          context.queryClient.ensureQueryData(
            buildPrMetaQueryOptions(repoId, prNumber),
          ),
          context.queryClient.ensureQueryData(
            buildDbBriefQueryOptions(
              repoId,
              prNumber,
              explicit.base,
              explicit.head,
            ),
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
        return pickPageTitleInput(metaResult.value);
      }
      const meta = await context.queryClient.ensureQueryData(
        buildPrMetaQueryOptions(repoId, prNumber),
      );
      // Prefetch the SELECTED revision's brief with ITS OWN base so a
      // historical revision SSRs correctly.
      const timeline = resolveDbTimeline(meta.revisions, deps);
      if (timeline !== undefined) {
        const span = {
          base: timeline.selected.baseSha,
          head: timeline.selected.headSha,
        };
        await Promise.all([
          context.queryClient.ensureQueryData(
            buildDbBriefQueryOptions(repoId, prNumber, span.base, span.head),
          ),
          prefetchSession(context.queryClient, repoId, prNumber, span),
        ]);
        return pickPageTitleInput(meta);
      }
      const state = deriveBriefRouteState(meta, undefined);
      if (state.kind === "render") {
        await Promise.all([
          context.queryClient.ensureQueryData(
            buildDbBriefQueryOptions(
              repoId,
              prNumber,
              state.span.base,
              state.span.head,
            ),
          ),
          prefetchSession(context.queryClient, repoId, prNumber, state.span),
        ]);
      }
      return pickPageTitleInput(meta);
    } catch (error) {
      mapLoaderError(error);
    }
  },
  head: ({ loaderData }) => {
    if (loaderData === undefined) return {};

    return { meta: [{ title: buildPrPageTitle(appI18n.t, loaderData) }] };
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
  const explicit = useMemo(
    () =>
      search.base !== undefined && search.head !== undefined
        ? { base: search.base, head: search.head }
        : undefined,
    [search.base, search.head],
  );

  const meta = useSuspenseQuery({
    ...buildPrMetaQueryOptions(repoId, prNumber),
    refetchInterval: (query) =>
      query.state.data !== undefined && shouldPollMeta(query.state.data)
        ? META_POLL_MS
        : false,
  }).data;

  const timeline = useMemo(() => {
    const request: Mutable<RevisionRequest> = {};

    if (search.rev !== undefined) {
      request.rev = search.rev;
    }
    if (search.head !== undefined) {
      request.head = search.head;
    }
    if (search.base !== undefined) {
      request.base = search.base;
    }

    return resolveDbTimeline(meta.revisions, request);
  }, [meta.revisions, search.base, search.head, search.rev]);

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

  /** Drop the pinned revision so it re-resolves to latest. */
  const goToNewest = useCallback(() => {
    void navigate({
      search: ({
        rev: _rev,
        head: _h,
        base: _b,
        thread: _spent,
        l: _link,
        ...rest
      }) => rest,
      replace: false,
      resetScroll: false,
    });
  }, [navigate]);

  const selectRevision = useCallback(
    (point: DbTimelinePoint) => {
      void navigate({
        // A jump target (`thread`, `l`) is spent once a revision is selected,
        // and a legacy span never survives a write: drop the keys entirely
        // (exactOptionalPropertyTypes forbids `undefined`).
        search: ({
          thread: _spent,
          l: _link,
          head: _h,
          base: _b,
          ...rest
        }) => ({
          ...rest,
          rev: point.headIndex,
        }),
        replace: false,
        // A revision is a lateral move, not a new page.
        resetScroll: false,
      });
    },
    [navigate],
  );

  // Hex SHAs and integers cannot collide with the separators.
  const revisionSpansKey = useMemo(
    () =>
      timeline === undefined
        ? undefined
        : timeline.points
            .map((p) => `${p.headSha} ${String(p.headIndex)}`)
            .join("\n"),
    [timeline],
  );
  const revisionJump = useMemo(() => {
    if (revisionSpansKey === undefined) return undefined;
    const spans = revisionSpansKey.split("\n").map((line) => {
      const [headSha = "", headIndex = ""] = line.split(" ");
      return { headSha, headIndex: Number(headIndex) };
    });
    return {
      knownHeads: new Set(spans.map((span) => span.headSha)),
      onJump: (anchorSha: string, threadId: number) => {
        // Duplicate heads: the HIGHEST-index row wins, matching the backend's
        // current-entry choice for the same ambiguity.
        const span = spans.findLast((s) => s.headSha === anchorSha);
        void navigate({
          search: ({ rev: _rev, head: _h, base: _b, l: _link, ...rest }) => {
            const next: PrBriefSearch = { ...rest };

            // Key order is URL param order: rev lands before thread.
            if (span !== undefined) {
              next.rev = span.headIndex;
            }
            next.thread = threadId;

            return next;
          },
          replace: false,
        });
      },
    };
  }, [navigate, revisionSpansKey]);

  // Pin the selected revision into the URL: a bare or legacy-span link is
  // rewritten to its `rev`. A DEGRADED (unknown) request is left in place,
  // the page shows latest with a stable note rather than silently rewriting
  // the address the reviewer followed.
  const pinnedRev =
    timeline !== undefined && !timeline.degraded
      ? timeline.selected.headIndex
      : undefined;
  useEffect(() => {
    if (pinnedRev === undefined) return;
    const legacySpan = search.head !== undefined || search.base !== undefined;
    if (search.rev === pinnedRev && !legacySpan) return;
    void navigate({
      search: ({ head: _h, base: _b, ...rest }) => ({
        ...rest,
        rev: pinnedRev,
      }),
      replace: true,
    });
  }, [navigate, pinnedRev, search.base, search.head, search.rev]);

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
  // `next` is the whole View/Compare/diff trio: a key it leaves out is
  // dropped, which is how a default leaves the URL.
  const onNavigateSearch = useCallback(
    (next: BriefSearchParams, options?: ScopeExitOptions) => {
      void navigate({
        search: ({ view: _v, compare: _c, diff: _d, ...rest }) => ({
          ...rest,
          ...next,
        }),
        replace: options?.replace ?? false,
      });
    },
    [navigate],
  );

  // Dropping the key, not blanking it: the stored preference only shows once
  // the deep link stops naming a view. A posture gesture, so no history step.
  const clearDiffParam = useCallback(() => {
    void navigate({
      search: ({ diff: _diff, ...rest }) => rest,
      replace: true,
    });
  }, [navigate]);

  // The line selection's address. Replace, and no scroll reset: the rows
  // the reader is looking at are the ones the link names.
  const navigateLink = useCallback(
    (link: string | undefined) => {
      void navigate({
        search: ({ l: _link, ...rest }) => {
          const next: PrBriefSearch = { ...rest };
          if (link !== undefined) {
            next.l = link;
          }

          return next;
        },
        replace: true,
        resetScroll: false,
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
    <AttachmentScopeProvider prNumber={prNumber} repoId={repoId}>
      <PrBriefBody
        meta={meta}
        onNavigateSearch={onNavigateSearch}
        clearDiffParam={clearDiffParam}
        link={search.l}
        navigateLink={navigateLink}
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
    </AttachmentScopeProvider>
  );
}
