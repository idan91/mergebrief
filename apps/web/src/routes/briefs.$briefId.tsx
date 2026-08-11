import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { BriefPage } from "@web/features/brief";
import {
  parseCompareParam,
  parseViewParam,
  type BriefSearchParams,
} from "../features/brief/comparison/compareState";
import { briefErrorDetail } from "@web/features/brief/utils/briefErrors";
import { resolveLegacyDeltaRedirect } from "@web/features/brief/utils";
import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localRevisionChangesQueryOptions,
} from "../features/brief/queries";
import styles from "./routeShared.module.scss";
import { useUnsavedComposerBlocker } from "@web/hooks/useUnsavedComposerGuard";

export const Route = createFileRoute("/briefs/$briefId")({
  // Unrecognized or absent keys are OMITTED, not defaulted, so the page can
  // tell "nothing chosen yet" apart from an explicit choice.
  validateSearch: (search: Record<string, unknown>): BriefSearchParams => {
    const view = parseViewParam(search["view"]);
    const compare = parseCompareParam(search["compare"]);
    return {
      ...(view !== undefined ? { view } : {}),
      ...(compare !== undefined ? { compare } : {}),
    };
  },
  // A Delta artifact id is no longer a route target. Redirect before the
  // loader runs so the old URL never renders the superseded shape.
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
  useUnsavedComposerBlocker();
  const { briefId } = Route.useParams();
  const searchParams = Route.useSearch();
  const artifacts = useSuspenseQuery(localBriefsQueryOptions()).data;
  const navigate = Route.useNavigate();
  // Route-owned: the brief feature never touches the router.
  const exitChangesScope = useCallback(() => {
    void navigate({ search: (prev) => ({ ...prev, view: "full" as const }) });
  }, [navigate]);
  return (
    <BriefPage
      artifacts={artifacts}
      briefId={briefId}
      searchParams={searchParams}
      exitChangesScope={exitChangesScope}
      key={briefId}
    />
  );
}

function BriefError({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section className={styles["errorState"]}>
        <h1>{t("shell.briefFailed")}</h1>
        {/* Curated copy only: a raw server message here would print the
            deployment's filesystem paths into the page. */}
        <p>{briefErrorDetail(t, error)}</p>
      </section>
    </main>
  );
}
