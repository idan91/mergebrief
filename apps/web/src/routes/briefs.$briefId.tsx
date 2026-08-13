import { useTranslation } from "react-i18next";
import { useCallback } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

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

/** Exactly a brief page (`/briefs/<id>`), never a subpath of one. */
const BRIEF_PATH_PATTERN = /^\/briefs\/[^/]+$/;

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
  // Pending only while a navigation targeting another brief page runs its
  // loader (revision links land on another briefId of the same route):
  // leaving the page — including to the summary-preview subpath — never
  // dims the brief.
  const revisionPending = useRouterState({
    select: (state) =>
      state.status === "pending" &&
      BRIEF_PATH_PATTERN.test(state.location.pathname),
  });
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
      revisionPending={revisionPending}
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
