import type { LocalBriefSummary } from "contract";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { BriefSearchParams } from "./model/comparison/compare-state";
import { buildLocalComparisonPlan } from "./model/comparison/local-plan";
import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
} from "./queries";
import { attachSlicedDiffs } from "./model/utils/diff-slicing";
import { createFileRowsCache } from "./model/file-rows/cache";
import { buildRevisionTimelineView } from "./model/utils/revision-timeline";
import { buildBriefTimeline } from "./model/utils/timeline";
import type { BriefAddressPort } from "./ui/components/BriefView/address/types";
import { buildFileAddress } from "./ui/components/BriefView/address/utils";
import { BriefView } from "./ui/components/BriefView";
import { useBriefReading } from "./ui/hooks/useBriefReading";

// Curated feature entry: components only. NEVER re-export anything that
// touches server/: a server edge here fails the import-protection build.
// Internal brief files import their targets directly, never this index.
export { BriefView } from "./ui/components/BriefView";
export { useBriefReading } from "./ui/hooks/useBriefReading";
export { buildBriefAddress } from "./ui/components/BriefView/address/utils";
export type { BriefComparisonPlan } from "./model/comparison/types";
export type {
  ConversationCapability,
  OwnDraftPlan,
  ReviewCapability,
  ScopeExitOptions,
} from "./ui/components/BriefView/types";
export { useBriefAddress } from "./ui/components/BriefView/address/useBriefAddress";
export type {
  BriefAddressPort,
  NavigateSearch,
} from "./ui/components/BriefView/address/types";
export { DB_BRIEF_ID_PREFIX, isDbBriefId } from "./model/utils/brief-identity";
export { LocalBriefsSection } from "./ui/components/LocalBriefsSection";
export { BriefError } from "./ui/components/BriefError";
export { readDiffView } from "./ui/components/BriefView/diff-view/diff-view-storage";

export interface BriefPageProps {
  artifacts: LocalBriefSummary[];
  briefId: string;
  /** Raw View/Compare URL params; undefined keys mean "nothing chosen yet",
   * resolved against comparison availability in BriefView's comparison overlay hook. */
  searchParams: BriefSearchParams;
  /** The route's URL writes; the Scope exit rides on its `navigateSearch`. */
  address: BriefAddressPort;
  /** A revision navigation is in flight (router pending); route-owned. */
  revisionPending: boolean;
  /** Goes to another brief of this PR by id; route-owned. */
  selectRevision?: ((briefId: string) => void) | undefined;
}

/** Per-brief page over the LOCAL file-backed store: fetch, then render. */
export function BriefPage({
  artifacts,
  briefId,
  searchParams,
  address: port,
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
  const comparisons = selectedPoint?.comparisons;
  const comparisonPlan = useMemo(
    () => buildLocalComparisonPlan(comparisons),
    [comparisons],
  );
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
  const reading = useBriefReading({
    brief,
    briefId,
    comparisonPlan,
    fileRows,
    revisions,
  });
  const address = buildFileAddress({ port, searchParams, revisionPending });
  // A file-backed Brief has no `brief` row, no installation and no reviewer,
  // so it supplies no review, and the screen reads rather than writes.
  return (
    <>
      <span aria-live="polite" className="sr-only" role="status">
        {viewingAnnouncement}
      </span>
      <BriefView reading={reading} address={address} />
    </>
  );
}
