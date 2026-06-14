import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { localBriefQueryOptions } from "../features/brief/queries";
import type { Brief } from "../features/brief/types";
import { buildBriefViewModel } from "../features/brief/viewModel";
import { SummaryPreview } from "../features/review/SummaryPreview";
import type { DemoReviewSnapshot } from "../features/review/demoState";
import { useDemoReviewSnapshot } from "../features/review/demoState";

export const Route = createFileRoute("/briefs/$briefId_/summary-preview")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(localBriefQueryOptions(params.briefId)),
  component: SummaryPreviewRoute,
});

function SummaryPreviewRoute() {
  const { briefId } = Route.useParams();
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  const snapshot = useDemoReviewSnapshot(briefId) ?? emptySnapshot(briefId, brief);

  return (
    <>
      <SummaryPreview brief={brief} snapshot={snapshot} />
      <Link className="summary-back" params={{ briefId }} to="/briefs/$briefId">Back to review</Link>
    </>
  );
}

function emptySnapshot(briefId: string, brief: Brief): DemoReviewSnapshot {
  return {
    briefId,
    reviewMode: "reviewer",
    briefMode: brief.delta ? "delta" : "current",
    reviewOutcome: "comment",
    flagStates: Object.fromEntries(buildBriefViewModel(brief).flags.map((flag) => [flag.id, { status: "open", reason: "" }])),
    riskEvidence: {},
    reviewedChunkIds: [],
    reviewComments: [],
  };
}
