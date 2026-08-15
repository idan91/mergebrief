import { useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { localBriefQueryOptions } from "../features/brief/queries";
import type { Brief } from "../features/brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import { SummaryPreview } from "@web/features/review";
import type { Disposition } from "../features/review/session";
import { readSnapshot, type SessionSnapshot } from "../features/review/session";
import styles from "./routeShared.module.scss";

export const Route = createFileRoute("/briefs/$briefId_/summary-preview")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(localBriefQueryOptions(params.briefId)),
  component: SummaryPreviewRoute,
});

function SummaryPreviewRoute() {
  const { t } = useTranslation();
  const { briefId } = Route.useParams();
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  // Storage is client-only; start from the empty snapshot (matching SSR) and
  // hydrate the persisted one on mount.
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() =>
    emptySnapshot(briefId, brief),
  );
  useEffect(() => {
    setSnapshot(readSnapshot(briefId) ?? emptySnapshot(briefId, brief));
  }, [briefId, brief]);

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
