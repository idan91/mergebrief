import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { BriefPage } from "../features/brief/components/BriefPage/BriefPage";
import {
  parseCompareParam,
  parseViewParam,
  type BriefSearchParams,
} from "../features/brief/compareState";
import { resolveLegacyDeltaRedirect } from "../features/brief/legacyRedirect";
import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localRevisionChangesQueryOptions,
} from "../features/brief/queries";
import styles from "./routeShared.module.scss";

export const Route = createFileRoute("/briefs/$briefId")({
  // View/Compare (ADR 0024): session-only, URL-carried state. Keys are
  // omitted (not defaulted here) when absent or unrecognized so the page can
  // tell "nothing chosen yet" (product-aware default) apart from an explicit
  // choice (normalize) — see `resolveBriefSearch`.
  validateSearch: (search: Record<string, unknown>): BriefSearchParams => {
    const view = parseViewParam(search["view"]);
    const compare = parseCompareParam(search["compare"]);
    return {
      ...(view !== undefined ? { view } : {}),
      ...(compare !== undefined ? { compare } : {}),
    };
  },
  // Migration (ADR 0024 plan step 10): a direct link to a Delta artifact's own
  // id used to render that Delta in place — Delta is no longer a route target,
  // it's Changes Only + Your last review on its head Brief. Redirect before
  // the loader runs so the old URL never renders the pre-ADR-0024 shape.
  beforeLoad: async ({ context, params }) => {
    const artifacts = await context.queryClient.ensureQueryData(
      localBriefsQueryOptions(),
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
        localBriefQueryOptions(params.briefId),
      ),
      context.queryClient.ensureQueryData(localBriefsQueryOptions()),
      context.queryClient.ensureQueryData(
        localRevisionChangesQueryOptions(params.briefId),
      ),
    ]),
  component: BriefRoute,
  errorComponent: BriefError,
});

function BriefRoute() {
  const { briefId } = Route.useParams();
  const searchParams = Route.useSearch();
  const artifacts = useSuspenseQuery(localBriefsQueryOptions()).data;
  return (
    <BriefPage
      artifacts={artifacts}
      briefId={briefId}
      searchParams={searchParams}
      key={briefId}
    />
  );
}

function BriefError({ error }: { error: Error }) {
  return (
    <main className="main">
      <section className={styles["errorState"]}>
        <h1>Brief failed to load</h1>
        <p>{error.message}</p>
      </section>
    </main>
  );
}
