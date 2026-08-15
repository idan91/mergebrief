import { useSuspenseQuery } from "@tanstack/react-query";

import type { BriefSearchParams } from "./comparison/compareState";
import { localBriefQueryOptions } from "./queries";
import type { LocalBriefSummary } from "./types";
import { BriefView } from "./components/BriefView/BriefView";

// Curated feature entry: components only. NEVER re-export anything that
// touches server/ — a server edge here fails the import-protection build.
// Internal brief files import their targets directly, never this index.
export {
  BriefView,
  type BriefComparisonPlan,
  type BriefViewProps,
} from "./components/BriefView/BriefView";
export { DB_BRIEF_ID_PREFIX, isDbBriefId } from "./utils/briefIdentity";

export interface BriefPageProps {
  artifacts: LocalBriefSummary[];
  briefId: string;
  /** Raw View/Compare URL params; undefined keys mean "nothing chosen yet",
   * resolved against comparison availability in BriefScreen's comparison overlay hook. */
  searchParams: BriefSearchParams;
  /** Navigates the Scope axis to `full`; route-owned. */
  exitChangesScope?: (() => void) | undefined;
  /** A revision navigation is in flight (router pending); route-owned. */
  revisionPending?: boolean | undefined;
}

/** Per-brief page over the LOCAL file-backed store: fetch, then render. */
export function BriefPage({
  artifacts,
  briefId,
  searchParams,
  exitChangesScope,
  revisionPending,
}: BriefPageProps) {
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  return (
    <BriefView
      artifacts={artifacts}
      brief={brief}
      briefId={briefId}
      searchParams={searchParams}
      exitChangesScope={exitChangesScope}
      revisionPending={revisionPending}
    />
  );
}
