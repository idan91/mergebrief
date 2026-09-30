import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { BriefSearchParams } from "./comparison/compareState";
import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
} from "./queries";
import type { LocalBriefSummary } from "./types";
import { attachSlicedDiffs } from "./utils/diffSlicing";
import { createFileRowsCache } from "./utils/fileRows";
import { buildRevisionTimelineView } from "./utils/revision-timeline";
import { buildBriefTimeline } from "./utils/timeline";
import { BriefView, type ScopeExitOptions } from "./components/BriefView";

// Curated feature entry: components only. NEVER re-export anything that
// touches server/: a server edge here fails the import-protection build.
// Internal brief files import their targets directly, never this index.
export {
  BriefView,
  type BriefComparisonPlan,
  type BriefViewProps,
  type ScopeExitOptions,
} from "./components/BriefView";
export { DB_BRIEF_ID_PREFIX, isDbBriefId } from "./utils/briefIdentity";
export { LocalBriefsSection } from "./components/LocalBriefsSection";
export { BriefError } from "./components/BriefError";
export { readDiffView } from "./components/BriefScreen/diffViewStorage";

export interface BriefPageProps {
  artifacts: LocalBriefSummary[];
  briefId: string;
  /** Raw View/Compare URL params; undefined keys mean "nothing chosen yet",
   * resolved against comparison availability in BriefScreen's comparison overlay hook. */
  searchParams: BriefSearchParams;
  /** Navigates the Scope axis to `full`; route-owned. */
  exitChangesScope?: ((options?: ScopeExitOptions) => void) | undefined;
  /** Drops the `diff` deep link once the viewer picks a view; route-owned. */
  clearDiffParam?: (() => void) | undefined;
  /** The link param the URL carries: a chunk, or lines, to land on. */
  link?: string | undefined;
  /** Writes or drops the link param with replace; route-owned. */
  navigateLink?: ((link: string | undefined) => void) | undefined;
  /** A revision navigation is in flight (router pending); route-owned. */
  revisionPending?: boolean | undefined;
  /** Goes to another brief of this PR by id; route-owned. */
  selectRevision?: ((briefId: string) => void) | undefined;
}

/** Per-brief page over the LOCAL file-backed store: fetch, then render. */
export function BriefPage({
  artifacts,
  briefId,
  searchParams,
  exitChangesScope,
  clearDiffParam,
  link,
  navigateLink,
  revisionPending,
  selectRevision,
}: BriefPageProps) {
  const { t } = useTranslation();
  const artifact = useSuspenseQuery(buildLocalBriefQueryOptions(briefId)).data;
  const patches = useSuspenseQuery(
    buildLocalBriefDiffsQueryOptions(briefId),
  ).data;
  // One parse per file for the page: the provider below hands the same rows
  // to hunk-edge expansion, so the identity has to hold across renders.
  const fileRows = useMemo(
    () =>
      createFileRowsCache(
        new Map(patches.map((entry) => [entry.file, entry.patch])),
      ),
    [patches],
  );
  const brief = useMemo(
    () => attachSlicedDiffs(artifact, fileRows),
    [artifact, fileRows],
  );
  const timeline = useMemo(
    () => buildBriefTimeline(artifacts, briefId),
    [artifacts, briefId],
  );
  const revisionView = useMemo(
    () => buildRevisionTimelineView(timeline),
    [timeline],
  );
  const selectedPoint = timeline.selectedPoint;
  // Moving to another brief keeps this page mounted, so the text changes and
  // the polite region announces it; the first render stays silent.
  const viewingAnnouncement =
    selectedPoint === undefined
      ? ""
      : t("brief.timeline.viewingBrief", {
          index: selectedPoint.index,
          total: timeline.points.length,
        });
  const revisions =
    selectRevision === undefined
      ? undefined
      : { view: revisionView, selectRevision };
  // A file-backed Brief has no `brief` row, no installation and no reviewer,
  // so it carries no Review Session, and with nowhere to keep the work the
  // screen reads rather than writes.
  return (
    <>
      <span aria-live="polite" className="sr-only" role="status">
        {viewingAnnouncement}
      </span>
      <BriefView
        artifacts={artifacts}
        brief={brief}
        briefId={briefId}
        fileRows={fileRows}
        readOnly={{ reason: t("brief.screen.fileBriefReadOnly") }}
        searchParams={searchParams}
        exitChangesScope={exitChangesScope}
        clearDiffParam={clearDiffParam}
        link={link}
        navigateLink={navigateLink}
        revisionPending={revisionPending}
        revisions={revisions}
      />
    </>
  );
}
