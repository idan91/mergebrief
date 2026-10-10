import type { QueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import { ApiError, ApiErrorCodes } from "../data/apiFetch";
import { appI18n } from "../i18n/I18nProvider";
import { useBriefAddress } from "@web/features/brief";
import {
  resolveDbTimeline,
  selectBriefRouteState,
  type Span,
} from "@web/features/pulls/utils";
import { AttachmentScopeProvider } from "@web/components/Markdown/context";
import { PrBriefBody, PrBriefError } from "@web/features/pulls";
import { usePrBriefPage } from "@web/features/pulls/hooks";
import {
  parsePrSearch,
  readExplicitSpan,
  readRevisionRequest,
} from "@web/features/pulls/search";
import {
  buildDbBriefQueryOptions,
  buildPrMetaQueryOptions,
  buildSessionQueryOptions,
} from "../features/pulls/queries";
import type { PrSummary } from "../features/pulls/types";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";
import { buildPrPageTitle, type PrPageTitleInput } from "@web/utils/pageTitle";
import { buildVersionQueryOptions } from "../features/version/queries";

function parsePrNumber(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw notFound();
  }
  return value;
}

function assertRepoId(raw: string): string {
  if (!/^\d+$/.test(raw)) {
    throw notFound();
  }
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
  validateSearch: parsePrSearch,
  loaderDeps: ({ search }) => readRevisionRequest(search),
  loader: async ({ context, params, deps }) => {
    const repoId = assertRepoId(params.repoId);
    const prNumber = parsePrNumber(params.prNumber);
    const explicit =
      deps.rev === undefined ? readExplicitSpan(deps) : undefined;
    // The version notice sits above the content: prefetched so the band
    // renders with the page instead of shifting it after scroll restore.
    const versionPrefetch = context.queryClient.prefetchQuery({
      ...buildVersionQueryOptions(),
      retry: false,
    });
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
      const state = selectBriefRouteState(meta, timeline, {
        explicitSpan: undefined,
        rev: deps.rev,
      });
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
    } finally {
      await versionPrefetch;
    }
  },
  head: ({ loaderData }) => {
    if (loaderData === undefined) {
      return {};
    }

    return { meta: [{ title: buildPrPageTitle(appI18n.t, loaderData) }] };
  },
  component: PrBriefRoute,
  errorComponent: PrBriefError,
});

/** Exactly a PR-brief page, never any other repos surface. */
const PR_BRIEF_PATH_PATTERN = /^\/repos\/[^/]+\/pulls\/[^/]+$/;

function PrBriefRoute() {
  // Route-level so BriefScreen itself stays renderable without a router.
  useUnsavedComposerBlocker();
  const params = Route.useParams();
  const prNumber = parsePrNumber(params.prNumber);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Leaving the page must not dim the brief.
  const revisionPending = useRouterState({
    select: (state) =>
      state.status === "pending" &&
      PR_BRIEF_PATH_PATTERN.test(state.location.pathname),
  });
  const address = useBriefAddress(search, navigate);
  const page = usePrBriefPage({
    repoId: params.repoId,
    prNumber,
    search,
    navigate,
  });

  return (
    <AttachmentScopeProvider
      installed={page.meta.appInstalled}
      prNumber={prNumber}
      repoId={params.repoId}
    >
      <PrBriefBody
        meta={page.meta}
        address={address}
        conversationFilter={page.conversationFilter}
        onConversationFilterChange={page.onConversationFilterChange}
        conversationFocusThreadId={page.conversationFocusThreadId}
        onSelectRevision={page.onSelectRevision}
        onGoToNewest={page.onGoToNewest}
        prNumber={prNumber}
        readOnly={page.readOnly}
        repoId={params.repoId}
        revisionJump={page.revisionJump}
        revisionPending={revisionPending}
        searchParams={page.searchParams}
        staleHead={page.staleHead}
        state={page.state}
        timeline={page.timeline}
      />
    </AttachmentScopeProvider>
  );
}
