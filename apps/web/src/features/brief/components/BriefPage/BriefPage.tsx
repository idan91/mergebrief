import { useSuspenseQuery } from "@tanstack/react-query";

import type { BriefSearchParams } from "../../comparison/compareState";
import { localBriefQueryOptions } from "../../queries";
import type { LocalBriefSummary } from "../../types";
import { BriefView } from "../BriefView/BriefView";

export interface BriefPageProps {
  artifacts: LocalBriefSummary[];
  briefId: string;
  /** Raw View/Compare URL params (ADR 0024 plan step 6); undefined keys mean
   * "nothing chosen yet", resolved against comparison availability in BriefScreen's comparison overlay hook. */
  searchParams: BriefSearchParams;
}

/** Per-brief page over the LOCAL file-backed store: fetch, then render. */
export function BriefPage({
  artifacts,
  briefId,
  searchParams,
}: BriefPageProps) {
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  return (
    <BriefView
      artifacts={artifacts}
      brief={brief}
      briefId={briefId}
      searchParams={searchParams}
    />
  );
}
