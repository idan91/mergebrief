import type { QueryClient } from "@tanstack/react-query";
import type { LinkHTMLAttributes } from "react";
import {
  createFileRoute,
  isNotFound,
  notFound,
  redirect,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { HttpStatuses } from "types";

import { ApiError, ApiErrorCodes, isSignedOutError } from "../data/apiFetch";
import { applySsrResponseStatus } from "../data/ssr-response-status";
import { appI18n } from "../i18n/I18nProvider";
import { buildSignInHref } from "@web/data/sign-in";
import { useBriefAddress } from "@web/features/brief";
import {
  prefetchSpanDiff,
  readDiffPreloadPath,
  resolveDbTimeline,
  selectBriefRouteState,
  type Span,
} from "@web/features/pulls/utils";
import { AttachmentScopeProvider } from "@web/components/Markdown/context";
import { useViewerLogin } from "@web/features/account";
import { MentionTargetsProvider } from "@web/features/conversation";
import {
  PrBriefBody,
  PrBriefError,
  PrBriefNotFound,
  VideoAssetsProvider,
} from "@web/features/pulls";
import { usePrBriefPage } from "@web/features/pulls/hooks";
import {
  parsePrSearch,
  readExplicitSpan,
  readRevisionRequest,
} from "@web/features/pulls/search";
import {
  buildDbBriefLayoutQueryOptions,
  buildDbBriefQueryOptions,
  buildPrMetaQueryOptions,
  buildSessionQueryOptions,
} from "../features/pulls/queries";
import type { PrSummary } from "../features/pulls/types";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";
import {
  buildPageTitle,
  buildPrPageTitle,
  type PrPageTitleInput,
} from "@web/utils/pageTitle";
import { buildVersionQueryOptions } from "../features/version/queries";
import { isViewerSignedOutSince } from "../features/account/queries";

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

/** The tab-title key a failed load names, when it names one. */
function getFailedLoadTitleKey(
  error: unknown,
): "pulls.signIn.heading" | "shell.pageTitle.notFound" | undefined {
  if (isSignedOutError(error)) {
    return "pulls.signIn.heading";
  }
  if (isNotFound(error)) {
    return "shell.pageTitle.notFound";
  }
  return undefined;
}

/** A missing PR/brief becomes a real 404 on SSR, not a 500. */
async function mapLoaderError(
  error: unknown,
  returnTo: string,
): Promise<never> {
  // A signed-out session stays signed out: only a live session GitHub
  // refused goes back through sign-in.
  if (error instanceof ApiError && error.code === ApiErrorCodes.UNAUTHORIZED) {
    throw redirect({ href: buildSignInHref(returnTo) });
  }
  if (isNotFoundError(error)) {
    throw notFound();
  }
  // The error component renders the sign-in wall; the document must not
  // answer the router's 500 for it.
  if (isSignedOutError(error)) {
    await applySsrResponseStatus(HttpStatuses.UNAUTHORIZED);
  }
  throw error;
}

/** Degrades: a failed read disables writes rather than failing the route. */
/**
 * The cached error entry is dropped: the query is retry:false with staleTime
 * Infinity, so `useSuspenseQuery` would throw it instead of refetching.
 */
async function dropMissingBriefPrefetch(
  queryClient: QueryClient,
  reason: unknown,
  repoId: string,
  prNumber: number,
  span: Span,
  returnTo: string,
): Promise<void> {
  if (!isNotFoundError(reason)) {
    await mapLoaderError(reason, returnTo);
  }

  queryClient.removeQueries({
    queryKey: buildDbBriefQueryOptions(repoId, prNumber, span.base, span.head)
      .queryKey,
    exact: true,
  });
}

interface PrRouteLoaderData extends PrPageTitleInput {
  /** The span diff the first load's document asks the browser to fetch now. */
  diffPreloadPath?: string;
}

function buildLoaderData(
  meta: PrSummary,
  repoId: string,
  span: Span | undefined,
): PrRouteLoaderData {
  const data: PrRouteLoaderData = {
    title: meta.title,
    prNumber: meta.prNumber,
    repoSlug: meta.repoSlug,
  };
  const diffPreloadPath =
    span === undefined
      ? undefined
      : readDiffPreloadPath(repoId, meta.prNumber, span);
  if (diffPreloadPath !== undefined) {
    data.diffPreloadPath = diffPreloadPath;
  }
  return data;
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

/**
 * The stored card sizes ride with the brief so the server and the client
 * reserve the same heights on first paint; a brief without them resolves
 * with no body and never fails the loader.
 */
function prefetchBriefLayout(
  queryClient: QueryClient,
  repoId: string,
  prNumber: number,
  span: Span,
): Promise<void> {
  return queryClient.prefetchQuery(
    buildDbBriefLayoutQueryOptions(repoId, prNumber, span.base, span.head),
  );
}

export const Route = createFileRoute("/repos/$repoId/pulls/$prNumber")({
  validateSearch: parsePrSearch,
  loaderDeps: ({ search }) => readRevisionRequest(search),
  loader: async ({ context, params, deps, location, preload }) => {
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
        const briefRead = context.queryClient.ensureQueryData(
          buildDbBriefQueryOptions(
            repoId,
            prNumber,
            explicit.base,
            explicit.head,
          ),
        );
        prefetchSpanDiff(context.queryClient, {
          repoId,
          prNumber,
          span: explicit,
          preload,
          brief: briefRead,
        });
        const [metaResult, briefResult] = await Promise.allSettled([
          context.queryClient.ensureQueryData(
            buildPrMetaQueryOptions(repoId, prNumber),
          ),
          briefRead,
          prefetchSession(context.queryClient, repoId, prNumber, explicit),
          prefetchBriefLayout(context.queryClient, repoId, prNumber, explicit),
        ]);
        if (metaResult.status === "rejected") {
          return await mapLoaderError(metaResult.reason, location.href);
        }
        if (briefResult.status === "rejected") {
          await dropMissingBriefPrefetch(
            context.queryClient,
            briefResult.reason,
            repoId,
            prNumber,
            explicit,
            location.href,
          );
        }
        return buildLoaderData(metaResult.value, repoId, explicit);
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
        const briefRead = context.queryClient.ensureQueryData(
          buildDbBriefQueryOptions(
            repoId,
            prNumber,
            state.span.base,
            state.span.head,
          ),
        );
        prefetchSpanDiff(context.queryClient, {
          repoId,
          prNumber,
          span: state.span,
          preload,
          brief: briefRead,
        });
        await Promise.all([
          briefRead,
          prefetchSession(context.queryClient, repoId, prNumber, state.span),
          prefetchBriefLayout(
            context.queryClient,
            repoId,
            prNumber,
            state.span,
          ),
        ]);
      }
      const renderedSpan = state.kind === "render" ? state.span : undefined;
      return buildLoaderData(meta, repoId, renderedSpan);
    } catch (error) {
      return await mapLoaderError(error, location.href);
    } finally {
      await versionPrefetch;
    }
  },
  head: ({ loaderData, match }) => {
    // A failed reload keeps the last run's loaderData beside its error; a
    // session that ends in the tab shows in the cached viewer first. A
    // signed-out viewer cached before this load succeeded is stale.
    let failureTitleKey = getFailedLoadTitleKey(match.error);
    const signedOutSinceLoad = isViewerSignedOutSince(
      match.context.queryClient,
      match.updatedAt,
    );
    const sessionEndedHere =
      failureTitleKey === undefined && signedOutSinceLoad;
    if (sessionEndedHere) {
      failureTitleKey = "pulls.signIn.heading";
    }
    if (failureTitleKey !== undefined) {
      return {
        meta: [
          { title: buildPageTitle(appI18n.t, [appI18n.t(failureTitleKey)]) },
        ],
      };
    }
    if (loaderData === undefined) {
      return {};
    }

    const meta = [{ title: buildPrPageTitle(appI18n.t, loaderData) }];
    if (loaderData.diffPreloadPath === undefined) {
      return { meta };
    }
    // Fetch mode and credentials match the diff read's own `fetch`, or the
    // browser downloads the diff twice.
    const preloadLink: LinkHTMLAttributes<HTMLLinkElement> = {
      rel: "preload",
      as: "fetch",
      href: loaderData.diffPreloadPath,
      crossOrigin: "use-credentials",
    };
    return { meta, links: [preloadLink] };
  },
  component: PrBriefRoute,
  errorComponent: PrBriefErrorRoute,
  notFoundComponent: PrBriefNotFound,
});

/** The page's own address becomes the sign-in's return path. */
function PrBriefErrorRoute({ error }: ErrorComponentProps) {
  const returnTo = useRouterState({ select: (state) => state.location.href });

  return <PrBriefError error={error} returnTo={returnTo} />;
}

/** Exactly a PR-brief page, never any other repos surface. */
const PR_BRIEF_PATH_PATTERN = /^\/repos\/[^/]+\/pulls\/[^/]+$/;

function PrBriefRoute() {
  // Route-level so BriefView itself stays renderable without a router.
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
  const viewerLogin = useViewerLogin();

  return (
    <AttachmentScopeProvider
      installed={page.meta.appInstalled}
      prNumber={prNumber}
      repoId={params.repoId}
      repoSlug={page.meta.repoSlug ?? undefined}
    >
      <VideoAssetsProvider prNumber={prNumber} repoId={params.repoId}>
        <MentionTargetsProvider
          repoId={params.repoId}
          viewerLogin={viewerLogin}
        >
          <PrBriefBody
            meta={page.meta}
            address={address}
            conversationFilter={page.conversationFilter}
            onConversationFilterChange={page.onConversationFilterChange}
            conversationFocusThreadId={page.conversationFocusThreadId}
            onSelectRevision={page.onSelectRevision}
            onGoToNewest={page.onGoToNewest}
            postingDisabled={page.postingDisabled}
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
        </MentionTargetsProvider>
      </VideoAssetsProvider>
    </AttachmentScopeProvider>
  );
}
