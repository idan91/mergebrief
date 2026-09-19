import { useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  Link,
} from "@tanstack/react-router";
import { useMemo } from "react";

import { buildLocalBriefQueryOptions } from "../features/brief/queries";
import { buildPullsSessionQueryOptions } from "../features/pulls/queries";
import type { Brief } from "../features/brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import { SummaryPreview } from "@web/features/review";
import type { Disposition, SessionSnapshot } from "../features/review/session";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./routeShared.module.scss";

export const Route = createFileRoute("/briefs/$briefId_/summary-preview")({
  // Development-only, same as the brief route it previews.
  beforeLoad: async ({ context }) => {
    if (import.meta.env.PROD) {
      throw notFound();
    }
    const session = await context.queryClient.ensureQueryData(
      buildPullsSessionQueryOptions(),
    );
    if (session.kind !== "ready") {
      throw redirect({ to: "/" });
    }
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      buildLocalBriefQueryOptions(params.briefId),
    ),
  head: () => {
    const pageName = appI18n.t("shell.pageTitle.summaryPreview");

    return { meta: [{ title: buildPageTitle(appI18n.t, [pageName]) }] };
  },
  component: SummaryPreviewRoute,
});

function SummaryPreviewRoute() {
  const { t } = useTranslation();
  const { briefId } = Route.useParams();
  const brief = useSuspenseQuery(buildLocalBriefQueryOptions(briefId)).data;
  // A file-backed Brief carries no session, so the preview renders the empty
  // one, the shape the Receipt builder takes.
  const snapshot = useMemo(
    () => emptySnapshot(briefId, brief),
    [briefId, brief],
  );

  return (
    <>
      <SummaryPreview brief={brief} snapshot={snapshot} />
      <Link
        className={styles["summaryBack"]}
        params={{ briefId }}
        to="/briefs/$briefId"
      >
        {t("shell.backToReview")}
      </Link>
    </>
  );
}

function emptySnapshot(briefId: string, brief: Brief): SessionSnapshot {
  const dispositions: Record<string, Disposition> = {};
  for (const flag of buildBriefViewModel(brief).flags) {
    dispositions[flag.id] = { kind: "open" };
  }
  return {
    briefId,
    dispositions,
    dominants: {},
    reclassifiedGroupIds: [],
    reviewedChunkIds: [],
    reviewComments: [],
    reviewOutcome: "comment",
  };
}
