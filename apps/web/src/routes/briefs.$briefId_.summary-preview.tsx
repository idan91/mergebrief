import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { localBriefQueryOptions } from "../features/brief/queries";
import type { Brief } from "../features/brief/types";
import { buildBriefViewModel } from "../features/brief/viewModel";
import { SummaryPreview } from "../features/review/components/SummaryPreview/SummaryPreview";
import type { Disposition } from "../features/review/session";
import { readSnapshot, type SessionSnapshot } from "../features/review/session";
import type { ReviewMode } from "../features/review/state";
import styles from "./routeShared.module.scss";

interface SummaryPreviewSearch {
  mode: ReviewMode;
}

export const Route = createFileRoute("/briefs/$briefId_/summary-preview")({
  // reviewMode is transient (not persisted); the in-app "Summary preview" link
  // carries it through as a search param so this cross-route preview keeps the
  // author-vs-reviewer framing.
  validateSearch: (search: Record<string, unknown>): SummaryPreviewSearch => ({
    mode: search["mode"] === "author" ? "author" : "reviewer",
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(localBriefQueryOptions(params.briefId)),
  component: SummaryPreviewRoute,
});

function SummaryPreviewRoute() {
  const { briefId } = Route.useParams();
  const { mode } = Route.useSearch();
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
      <SummaryPreview brief={brief} mode={mode} snapshot={snapshot} />
      <Link
        className={styles["summaryBack"]}
        params={{ briefId }}
        to="/briefs/$briefId"
      >
        Back to review
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
    checkedItems: {},
    reviewComments: [],
    reviewOutcome: "comment",
  };
}
