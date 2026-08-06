import { useSuspenseQuery } from "@tanstack/react-query";

import type { BriefSearchParams } from "./comparison/compareState";
import { localBriefQueryOptions } from "./queries";
import type { LocalBriefSummary } from "./types";
import { BriefView } from "./components/BriefView/BriefView";

// Curated feature entry (ADR 0037): components only. NEVER re-export
// anything that touches server/ — a server edge through this barrel would
// put server-only code on the client graph and fail the import-protection
// build. Internal brief files import their targets directly, never this
// index (import/no-cycle).
export {
  BriefView,
  type BriefComparisonPlan,
  type BriefViewProps,
} from "./components/BriefView/BriefView";

export interface BriefPageProps {
  artifacts: LocalBriefSummary[];
  briefId: string;
  /** Raw View/Compare URL params (ADR 0024 plan step 6); undefined keys mean
   * "nothing chosen yet", resolved against comparison availability in BriefScreen's comparison overlay hook. */
  searchParams: BriefSearchParams;
  /** Navigates the Scope axis to `full` (BRIEF-134); route-owned. */
  exitChangesScope?: (() => void) | undefined;
}

/** Per-brief page over the LOCAL file-backed store: fetch, then render. */
export function BriefPage({
  artifacts,
  briefId,
  searchParams,
  exitChangesScope,
}: BriefPageProps) {
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  return (
    <BriefView
      artifacts={artifacts}
      brief={brief}
      briefId={briefId}
      searchParams={searchParams}
      exitChangesScope={exitChangesScope}
    />
  );
}
