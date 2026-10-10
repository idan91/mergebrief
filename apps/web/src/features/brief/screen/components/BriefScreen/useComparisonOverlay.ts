// The comparison-overlay facade hook: resolves the View/Compare state and the
// active baseline's data. Marks/narrative/delta resolve from ONE source, the
// injected plan (DB path) or the local sidecar ids; both query sets exist as
// hooks and `enabled` picks.
import type { StoredRevisionNarrative } from "brief-core/artifact";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type {
  RevisionNarrativeSkipReason,
  RevisionNarrative,
} from "brief-core/types";
import {
  comparisonAvailability,
  resolveBriefSearch,
  type BriefSearch,
  type BriefSearchParams,
  type CompareOptionFlags,
} from "../../../model/comparison/compareState";
import {
  CompareParams,
  type CompareParam,
} from "../../../model/comparison/types";
import type { ComparisonSource } from "../../../model/comparison/runs";
import type { ComparisonOverlayState } from "../../../model/comparison/comparisonOverlay";
import type { ComparisonQuery } from "../../../model/comparison/comparisonQuery";
import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
  buildLocalComparisonMarksQueryOptions,
  buildLocalRevisionNarrativeQueryOptions,
} from "../../../queries";
import {
  attachSlicedDiffs,
  attachSpanDiffs,
  splitUnifiedDiffByFile,
} from "../../../model/utils/diffSlicing";
import {
  createFileRowsCache,
  type FileRowsCache,
} from "../../../model/utils/fileRows";
import {
  buildBriefTimeline,
  type BriefTimeline,
} from "../../../model/utils/timeline";
import type {
  Brief,
  ComparisonMarks,
  LocalBriefSummary,
} from "../../../model/types";
import { type DeltaSpanStatus, DeltaSpanStatuses } from "./types";
import {
  countComparisonRuns,
  disabledComparisonQuery,
  discriminateNarrativeArtifact,
  hasRemovedLines,
  resolveLocalComparisonIds,
} from "./utils";

/**
 * Injected comparison data source (the DB path). When present it REPLACES the
 * local timeline derivation entirely: availability comes from the plan and
 * marks/narrative/delta fetch through its descriptors. Absent → the local
 * sidecar flow is unchanged.
 */
export interface BriefComparisonPlan {
  readonly previousBrief?: {
    readonly marks: ComparisonQuery<ComparisonMarks>;
    /** Present when a narrative artifact exists to fetch (may be a skip stub). */
    readonly narrative?: ComparisonQuery<StoredRevisionNarrative>;
    /** Live raw span diff baseline → head (Changes Only "Show raw diff"). */
    readonly rawDiff?: ComparisonQuery<string>;
  };
  /** The personal checkpoint comparison, offered iff marks exist. */
  readonly lastReview?: {
    readonly marks: ComparisonQuery<ComparisonMarks>;
    /** Absent = marks-only tier: the worker skipped the delta core. */
    readonly delta?: ComparisonQuery<Brief>;
    /** Live raw span diff checkpoint → head. */
    readonly rawDiff?: ComparisonQuery<string>;
  };
}

type ActivePlanSlot =
  | BriefComparisonPlan["previousBrief"]
  | BriefComparisonPlan["lastReview"];

export interface UseComparisonOverlayInput {
  /** Feeds the LOCAL timeline/comparisons; may be empty (self-disables). */
  artifacts: LocalBriefSummary[];
  brief: Brief;
  briefId: string;
  comparisonPlan: BriefComparisonPlan | undefined;
  /** Raw View/Compare URL params. */
  searchParams: BriefSearchParams;
}

export interface UseComparisonOverlayValue {
  /** The LOCAL timeline; its selected point drives availability. */
  timeline: BriefTimeline;
  /** Which Compare baselines the header controls may offer. */
  availability: CompareOptionFlags;
  /** Resolved, normalized View/Compare state for the selected point. */
  compareState: BriefSearch;
  /** The active Compare baseline (`compareState.compare`, named for reach). */
  activeCompare: CompareParam;
  /** The overlay state machine the story view paints from. */
  comparison: ComparisonOverlayState;
  /** Active baseline's mechanical marks, or null. */
  marks: ComparisonMarks | null;
  /** The Previous-Brief revision narrative, or null (failed or skipped). */
  narrative: RevisionNarrative | null;
  /** Why the narrative was deliberately skipped, when it was. */
  skipReason: RevisionNarrativeSkipReason | null;
  /** The last-review Delta Brief, or null (marks-only tier). */
  delta: Brief | null;
  /** The ACTIVE baseline's raw span-diff descriptor (Changes Only toggle). */
  activeRawSpanDiff: ComparisonQuery<string> | undefined;
  /** Where the delta's rows stand on the database path; `absent` elsewhere. */
  deltaSpanStatus: DeltaSpanStatus;
  /**
   * The previous-brief span diff by file, the one source of the lines a
   * revision removed; absent until Changes scope shows a narrative with any.
   */
  narrativeSpanRows: FileRowsCache | undefined;
  /**
   * Last-review marks fetched INDEPENDENT of the active baseline: the
   * per-group since-marker renders with Compare off. Null without a
   * checkpoint (or while loading).
   */
  sinceReviewMarks: ComparisonMarks | null;
}

/**
 * The active Compare baseline drives both the Full Brief highlights and the
 * Changes Only content. Marks are the sole source of truth for highlights;
 * the narrative/Delta only supplies callout text and the changed-only
 * summaries. One state machine parameterized by baseline, not two.
 */
export function useComparisonOverlay(
  input: UseComparisonOverlayInput,
): UseComparisonOverlayValue {
  const { artifacts, brief, briefId, comparisonPlan, searchParams } = input;
  const timeline = useMemo(
    () => buildBriefTimeline(artifacts, briefId),
    [artifacts, briefId],
  );
  const availability = useMemo(
    () =>
      comparisonPlan === undefined
        ? comparisonAvailability(timeline.selectedPoint)
        : {
            previousBrief: comparisonPlan.previousBrief !== undefined,
            lastReview: comparisonPlan.lastReview !== undefined,
          },
    [comparisonPlan, timeline.selectedPoint],
  );
  const compareState = useMemo(
    () => resolveBriefSearch(searchParams, availability),
    [availability, searchParams],
  );

  const activeCompare = compareState.compare;
  const { marksId, narrativeId, deltaId } = resolveLocalComparisonIds(
    activeCompare,
    timeline.selectedPoint?.comparisons,
  );

  // The plan's marks descriptor follows the ACTIVE baseline; narrative stays
  // previous-brief-only, delta last-review-only, mirroring the local ids.
  const planPrevious = comparisonPlan?.previousBrief;
  const planLastReview = comparisonPlan?.lastReview;
  const planSlotByCompare: Record<CompareParam, ActivePlanSlot> = {
    [CompareParams.PREVIOUS_BRIEF]: planPrevious,
    [CompareParams.LAST_REVIEW]: planLastReview,
    [CompareParams.OFF]: undefined,
  };
  const activePlanSlot = planSlotByCompare[activeCompare];
  const planActive =
    comparisonPlan !== undefined && activePlanSlot !== undefined;
  // Each slot carries its own baseline's raw span diff. Absent on the local
  // path and while Compare is off → the Changes Only toggle hides.
  const activeRawSpanDiff = activePlanSlot?.rawDiff;
  const localMarks = useQuery({
    ...buildLocalComparisonMarksQueryOptions(marksId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(marksId),
  });
  const planMarksOptions =
    activePlanSlot?.marks ?? disabledComparisonQuery<ComparisonMarks>("marks");
  const planMarks = useQuery({ ...planMarksOptions, enabled: planActive });
  const marks =
    (comparisonPlan === undefined ? localMarks.data : planMarks.data) ?? null;
  const localNarrative = useQuery({
    ...buildLocalRevisionNarrativeQueryOptions(narrativeId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(narrativeId),
  });
  const planNarrativeOptions =
    planPrevious?.narrative ??
    disabledComparisonQuery<StoredRevisionNarrative>("narrative");
  const planNarrative = useQuery({
    ...planNarrativeOptions,
    enabled:
      planActive &&
      activeCompare === CompareParams.PREVIOUS_BRIEF &&
      planPrevious?.narrative !== undefined,
  });
  const narrativeArtifact: StoredRevisionNarrative | null =
    (comparisonPlan === undefined ? localNarrative.data : planNarrative.data) ??
    null;
  const localDelta = useQuery({
    ...buildLocalBriefQueryOptions(deltaId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(deltaId),
  });
  // The delta's rows come from its own sidecar (baseline to head), never
  // from the head brief's patches (base to head).
  const localDeltaDiffs = useQuery({
    ...buildLocalBriefDiffsQueryOptions(deltaId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(deltaId),
  });
  const localDeltaPatches = localDeltaDiffs.data;
  const localDeltaFailed = localDeltaDiffs.isError;
  const localDeltaArtifact = localDelta.data;
  const slicedLocalDelta = useMemo(() => {
    // A sidecar that failed to read means no delta, never row-less cards.
    if (localDeltaFailed) {
      return undefined;
    }
    if (localDeltaArtifact === undefined || localDeltaPatches === undefined) {
      return localDeltaArtifact;
    }
    const patches = new Map(
      localDeltaPatches.map((entry) => [entry.file, entry.patch]),
    );
    return attachSlicedDiffs(localDeltaArtifact, createFileRowsCache(patches));
  }, [localDeltaArtifact, localDeltaFailed, localDeltaPatches]);
  const planDeltaOptions =
    planLastReview?.delta ?? disabledComparisonQuery<Brief>("delta");
  const planDelta = useQuery({
    ...planDeltaOptions,
    enabled:
      planActive &&
      activeCompare === CompareParams.LAST_REVIEW &&
      planLastReview?.delta !== undefined,
  });
  // The stored delta core carries no rows: they slice from the span diff,
  // the same query the raw toggle runs, so the two never fetch twice. Only
  // Changes scope shows delta rows, and a descriptor that disabled itself
  // stays unfetched.
  const planSpanOptions =
    planLastReview?.rawDiff ?? disabledComparisonQuery<string>("delta-span");
  const spanWanted =
    planActive &&
    compareState.view === "changes" &&
    activeCompare === CompareParams.LAST_REVIEW &&
    planLastReview?.rawDiff !== undefined &&
    planSpanOptions.enabled !== false &&
    planDelta.data !== undefined;
  const planSpan = useQuery({ ...planSpanOptions, enabled: spanWanted });
  const planDeltaCore = planDelta.data;
  const planSpanDiff = planSpan.data;
  const planDeltaWithRows = useMemo(() => {
    if (planDeltaCore === undefined || planSpanDiff === undefined) {
      return planDeltaCore;
    }
    const spanRows = createFileRowsCache(splitUnifiedDiffByFile(planSpanDiff));
    return attachSpanDiffs(planDeltaCore, spanRows);
  }, [planDeltaCore, planSpanDiff]);
  const delta =
    (comparisonPlan === undefined ? slicedLocalDelta : planDeltaWithRows) ??
    null;
  const deltaSpanStatus = resolveDeltaSpanStatus(
    spanWanted,
    planSpanDiff !== undefined,
    planSpan.isError,
  );

  const { narrative, skipReason } =
    discriminateNarrativeArtifact(narrativeArtifact);

  // Narrative cards show the lines a revision removed from the span diff,
  // whose old side is the previous head; the brief's own rows run base to
  // head and cannot name them. Same query the raw toggle runs.
  const narrativeSpanOptions =
    planPrevious?.rawDiff ?? disabledComparisonQuery<string>("narrative-span");
  const narrativeSpanWanted =
    planActive &&
    compareState.view === "changes" &&
    activeCompare === CompareParams.PREVIOUS_BRIEF &&
    planPrevious?.rawDiff !== undefined &&
    narrativeSpanOptions.enabled !== false &&
    hasRemovedLines(narrative);
  const narrativeSpan = useQuery({
    ...narrativeSpanOptions,
    enabled: narrativeSpanWanted,
  });
  const narrativeSpanDiff = narrativeSpan.data;
  const narrativeSpanRows = useMemo(
    () =>
      narrativeSpanDiff === undefined
        ? undefined
        : createFileRowsCache(splitUnifiedDiffByFile(narrativeSpanDiff)),
    [narrativeSpanDiff],
  );

  // Since-marker source: the last-review marks, fetched whenever the
  // checkpoint slot EXISTS rather than when it is the active baseline. Shares
  // the queryKey with the active fetch above, so React Query dedupes when
  // Compare = last-review is on.
  const localSinceIds = resolveLocalComparisonIds(
    CompareParams.LAST_REVIEW,
    timeline.selectedPoint?.comparisons,
  );
  const localSinceMarks = useQuery({
    ...buildLocalComparisonMarksQueryOptions(localSinceIds.marksId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(localSinceIds.marksId),
  });
  const planSinceMarksOptions =
    planLastReview?.marks ??
    disabledComparisonQuery<ComparisonMarks>("since-marks");
  const planSinceMarks = useQuery({
    ...planSinceMarksOptions,
    enabled: planLastReview !== undefined,
  });
  const sinceReviewMarks =
    (comparisonPlan === undefined
      ? localSinceMarks.data
      : planSinceMarks.data) ?? null;

  const comparisonSource: ComparisonSource = useMemo(
    () =>
      activeCompare === CompareParams.LAST_REVIEW
        ? { kind: "last-review", delta }
        : { kind: "previous-brief", brief, narrative },
    [activeCompare, brief, delta, narrative],
  );

  const comparison: ComparisonOverlayState = useMemo(() => {
    // The overlay only paints in Full Brief; Changes Only renders its own view.
    const available =
      compareState.view === "full" &&
      activeCompare !== CompareParams.OFF &&
      Boolean(marks);
    const effectiveMarks = available ? marks : null;
    return {
      compare: activeCompare,
      marks: effectiveMarks,
      source: comparisonSource,
      skipReason,
      available,
      runCount: countComparisonRuns(brief.chunks, effectiveMarks),
    };
  }, [
    activeCompare,
    brief.chunks,
    compareState.view,
    comparisonSource,
    marks,
    skipReason,
  ]);

  return {
    timeline,
    availability,
    compareState,
    activeCompare,
    comparison,
    marks,
    narrative,
    skipReason,
    delta,
    activeRawSpanDiff,
    deltaSpanStatus,
    narrativeSpanRows,
    sinceReviewMarks,
  };
}

/** Rows that landed stay ready through a failed background refetch. */
function resolveDeltaSpanStatus(
  wanted: boolean,
  landed: boolean,
  failed: boolean,
): DeltaSpanStatus {
  if (!wanted) {
    return DeltaSpanStatuses.ABSENT;
  }
  if (landed) {
    return DeltaSpanStatuses.READY;
  }

  return failed ? DeltaSpanStatuses.ERROR : DeltaSpanStatuses.LOADING;
}
