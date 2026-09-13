import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { BriefSearchParams } from "./comparison/compareState";
import { localBriefQueryOptions } from "./queries";
import type { LocalBriefSummary } from "./types";
import { BriefView } from "./components/BriefView/BriefView";

// Curated feature entry: components only. NEVER re-export anything that
// touches server/: a server edge here fails the import-protection build.
// Internal brief files import their targets directly, never this index.
export {
  BriefView,
  type BriefComparisonPlan,
  type BriefViewProps,
} from "./components/BriefView/BriefView";
export { DB_BRIEF_ID_PREFIX, isDbBriefId } from "./utils/briefIdentity";
export { LocalBriefsSection } from "./components/LocalBriefsSection/LocalBriefsSection";

export interface BriefPageProps {
  artifacts: LocalBriefSummary[];
  briefId: string;
  /** Raw View/Compare URL params; undefined keys mean "nothing chosen yet",
   * resolved against comparison availability in BriefScreen's comparison overlay hook. */
  searchParams: BriefSearchParams;
  /** Navigates the Scope axis to `full`; route-owned. */
  exitChangesScope?: (() => void) | undefined;
  /** Drops the `diff` deep link once the viewer picks a view; route-owned. */
  clearDiffParam?: (() => void) | undefined;
  /** A revision navigation is in flight (router pending); route-owned. */
  revisionPending?: boolean | undefined;
}

/** Per-brief page over the LOCAL file-backed store: fetch, then render. */
export function BriefPage({
  artifacts,
  briefId,
  searchParams,
  exitChangesScope,
  clearDiffParam,
  revisionPending,
}: BriefPageProps) {
  const { t } = useTranslation();
  const brief = useSuspenseQuery(localBriefQueryOptions(briefId)).data;
  // A file-backed Brief has no `brief` row, no installation and no reviewer,
  // so it carries no Review Session, and with nowhere to keep the work the
  // screen reads rather than writes.
  return (
    <BriefView
      artifacts={artifacts}
      brief={brief}
      briefId={briefId}
      readOnly={{ reason: t("brief.screen.fileBriefReadOnly") }}
      searchParams={searchParams}
      exitChangesScope={exitChangesScope}
      clearDiffParam={clearDiffParam}
      revisionPending={revisionPending}
    />
  );
}
