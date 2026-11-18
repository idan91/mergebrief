import { useCallback, useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import { BriefError, BriefPage, useBriefAddress } from "@web/features/brief";
import {
  parseBriefAddressSearch,
  parseBriefSearchParams,
  resolveLegacyDeltaRedirect,
} from "@web/features/brief/model";
import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
  buildLocalBriefsQueryOptions,
} from "../features/brief/queries";
import { ApiError, ApiErrorCodes } from "../data/apiFetch";
import { buildViewerQueryOptions } from "../features/account/queries";
import { ViewerStates } from "../features/account/types";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";

/** Exactly a brief page (`/briefs/<id>`), never a subpath of one. */
const BRIEF_PATH_PATTERN = /^\/briefs\/[^/]+$/;

/** A missing local Brief becomes a real 404 on SSR, not a 500. */
function mapLoaderError(error: unknown): never {
  if (error instanceof ApiError && error.code === ApiErrorCodes.NOT_FOUND) {
    throw notFound();
  }
  throw error;
}

export const Route = createFileRoute("/briefs/$briefId")({
  validateSearch: parseBriefAddressSearch,
  // A Delta artifact id is no longer a route target. Redirect before the
  // loader runs so the old URL never renders the superseded shape.
  beforeLoad: async ({ context, params }) => {
    // The file surface is development-only. A production build refuses at the
    // route rather than letting the readers throw, so the answer is an
    // ordinary 404 and not a 500 that looks like a broken deployment.
    if (import.meta.env.PROD) {
      throw notFound();
    }
    // The readers refuse without a session; redirecting first keeps a
    // logged-out visit an ordinary navigation instead of a 500.
    const viewer = await context.queryClient.ensureQueryData({
      ...buildViewerQueryOptions(),
      retry: false,
    });
    if (viewer.kind !== ViewerStates.SIGNED_IN) {
      throw redirect({ to: "/" });
    }
    const artifacts = await context.queryClient.ensureQueryData(
      buildLocalBriefsQueryOptions(),
    );
    const legacy = resolveLegacyDeltaRedirect(artifacts, params.briefId);
    if (legacy) {
      throw redirect({
        to: "/briefs/$briefId",
        params: { briefId: legacy.briefId },
        search: legacy.search,
      });
    }
  },
  loader: async ({ context, params }) => {
    const reads = await Promise.allSettled([
      context.queryClient.ensureQueryData(
        buildLocalBriefQueryOptions(params.briefId),
      ),
      context.queryClient.ensureQueryData(
        buildLocalBriefDiffsQueryOptions(params.briefId),
      ),
      context.queryClient.ensureQueryData(buildLocalBriefsQueryOptions()),
    ]);
    // First in array order, not first to settle: a missing Brief's diffs read
    // fails too, and the Brief's own refusal decides the screen.
    const failed = reads.find(
      (read): read is PromiseRejectedResult => read.status === "rejected",
    );
    if (failed !== undefined) {
      mapLoaderError(failed.reason);
    }
  },
  head: () => {
    const pageName = appI18n.t("shell.pageTitle.localBrief");

    return { meta: [{ title: buildPageTitle(appI18n.t, [pageName]) }] };
  },
  component: BriefRoute,
  errorComponent: BriefError,
});

function BriefRoute() {
  useUnsavedComposerBlocker();
  const { briefId } = Route.useParams();
  const search = Route.useSearch();
  const searchParams = useMemo(() => parseBriefSearchParams(search), [search]);
  const artifacts = useSuspenseQuery(buildLocalBriefsQueryOptions()).data;
  const navigate = Route.useNavigate();
  // Pending only while a navigation targeting another brief page runs its
  // loader (revision links land on another briefId of the same route):
  // leaving the page never dims the brief.
  const revisionPending = useRouterState({
    select: (state) =>
      state.status === "pending" &&
      BRIEF_PATH_PATTERN.test(state.location.pathname),
  });
  const address = useBriefAddress(search, navigate);

  // Keeps View and Compare for the new brief to re-normalise; drops only the
  // link, whose chunk id means nothing in another brief.
  const selectRevision = useCallback(
    (targetBriefId: string) => {
      void navigate({
        params: { briefId: targetBriefId },
        search: ({ l: _link, ...rest }) => rest,
      });
    },
    [navigate],
  );
  return (
    <BriefPage
      artifacts={artifacts}
      briefId={briefId}
      searchParams={searchParams}
      address={address}
      revisionPending={revisionPending}
      selectRevision={selectRevision}
    />
  );
}
