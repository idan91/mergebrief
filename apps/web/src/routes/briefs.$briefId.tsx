import { useCallback } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import {
  BriefError,
  BriefPage,
  type ScopeExitOptions,
} from "@web/features/brief";
import {
  buildBriefSearchParams,
  parseCompareParam,
  parseDiffParam,
  parseViewParam,
  type BriefSearchParams,
} from "@web/features/brief/comparison";
import { resolveLegacyDeltaRedirect } from "@web/features/brief/utils";
import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
  buildLocalBriefsQueryOptions,
  buildLocalRevisionChangesQueryOptions,
} from "../features/brief/queries";
import { buildViewerQueryOptions } from "../features/account/queries";
import { ViewerStates } from "../features/account/types";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";

/** Exactly a brief page (`/briefs/<id>`), never a subpath of one. */
const BRIEF_PATH_PATTERN = /^\/briefs\/[^/]+$/;

export const Route = createFileRoute("/briefs/$briefId")({
  // Unrecognized or absent keys are OMITTED, not defaulted, so the page can
  // tell "nothing chosen yet" apart from an explicit choice.
  validateSearch: (search: Record<string, unknown>): BriefSearchParams => {
    const view = parseViewParam(search["view"]);
    const diff = parseDiffParam(search["diff"]);
    const compare = parseCompareParam(search["compare"]);
    return buildBriefSearchParams(view, compare, diff);
  },
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
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        buildLocalBriefQueryOptions(params.briefId),
      ),
      context.queryClient.ensureQueryData(
        buildLocalBriefDiffsQueryOptions(params.briefId),
      ),
      context.queryClient.ensureQueryData(buildLocalBriefsQueryOptions()),
      context.queryClient.ensureQueryData(
        buildLocalRevisionChangesQueryOptions(params.briefId),
      ),
    ]),
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
  const searchParams = Route.useSearch();
  const artifacts = useSuspenseQuery(buildLocalBriefsQueryOptions()).data;
  const navigate = Route.useNavigate();
  // Pending only while a navigation targeting another brief page runs its
  // loader (revision links land on another briefId of the same route):
  // leaving the page, including to the summary-preview subpath, never
  // dims the brief.
  const revisionPending = useRouterState({
    select: (state) =>
      state.status === "pending" &&
      BRIEF_PATH_PATTERN.test(state.location.pathname),
  });
  // Route-owned: the brief feature never touches the router.
  const exitChangesScope = useCallback(
    (options?: ScopeExitOptions) => {
      void navigate({
        search: (prev) => ({ ...prev, view: "full" as const }),
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
  return (
    <BriefPage
      artifacts={artifacts}
      briefId={briefId}
      searchParams={searchParams}
      exitChangesScope={exitChangesScope}
      clearDiffParam={clearDiffParam}
      revisionPending={revisionPending}
    />
  );
}
