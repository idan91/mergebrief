// The comparison-overlay facade hook: resolves the View/Compare state and the
// active baseline's data from the supplied plan's descriptors.
import type { StoredRevisionNarrative } from "brief-core/artifact";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type {
  RevisionNarrativeSkipReason,
  RevisionNarrative,
} from "brief-core/types";
import {
  resolveBriefSearch,
  type BriefSearch,
  type BriefSearchParams,
  type CompareOptionFlags,
} from "../../../model/comparison/compare-state";
import {
  CompareParams,
  type BriefComparisonPlan,
  type CompareParam,
} from "../../../model/comparison/types";
import type { ComparisonSource } from "../../../model/comparison/runs";
import type { ComparisonOverlayState } from "../../../model/comparison/comparison-overlay";
import type { ComparisonQuery } from "../../../model/comparison/comparison-query";
import {
  attachSpanDiffs,
  splitUnifiedDiffByFile,
} from "../../../model/utils/diff-slicing";
import {
  createFileRowsCache,
  type FileRowsCache,
} from "../../../model/file-rows/cache";
import type { Brief, ComparisonMarks } from "../../../model/types";
import { type DeltaSpanStatus, DeltaSpanStatuses } from "./types";
import {
  countComparisonRuns,
  disabledComparisonQuery,
  discriminateNarrativeArtifact,
  hasRemovedLines,
} from "./utils";

type ActivePlanSlot =
  | BriefComparisonPlan["previousBrief"]
  | BriefComparisonPlan["lastReview"];

export interface UseComparisonOverlayInput {
  brief: Brief;
  comparisonPlan: BriefComparisonPlan | undefined;
  /** Raw View/Compare URL params. */
  searchParams: BriefSearchParams;
}

export interface UseComparisonOverlayValue {
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
  /** Where the delta's span rows stand; `absent` without a raw diff to slice. */
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
  const { brief, comparisonPlan, searchParams } = input;
  const planPrevious = comparisonPlan?.previousBrief;
  const planLastReview = comparisonPlan?.lastReview;
  const availability = useMemo(
    () => ({
      previousBrief: planPrevious !== undefined,
      lastReview: planLastReview !== undefined,
    }),
    [planLastReview, planPrevious],
  );
  const compareState = useMemo(
    () => resolveBriefSearch(searchParams, availability),
    [availability, searchParams],
  );

  // Marks follow the ACTIVE baseline; narrative stays previous-brief-only,
  // delta last-review-only.
  const activeCompare = compareState.compare;
  const planSlotByCompare: Record<CompareParam, ActivePlanSlot> = {
    [CompareParams.PREVIOUS_BRIEF]: planPrevious,
    [CompareParams.LAST_REVIEW]: planLastReview,
    [CompareParams.OFF]: undefined,
  };
  const activePlanSlot = planSlotByCompare[activeCompare];
  const planActive = activePlanSlot !== undefined;
  // Each slot carries its own baseline's raw span diff. Absent, or Compare
  // off, hides the Changes Only toggle.
  const activeRawSpanDiff = activePlanSlot?.rawDiff;
  const planMarksOptions =
    activePlanSlot?.marks ?? disabledComparisonQuery<ComparisonMarks>("marks");
  const planMarks = useQuery({ ...planMarksOptions, enabled: planActive });
  const marks = planMarks.data ?? null;
  const planNarrativeOptions =
    planPrevious?.narrative ??
    disabledComparisonQuery<StoredRevisionNarrative>("narrative");
  const planNarrative = useQuery({
    ...planNarrativeOptions,
    enabled:
      activeCompare === CompareParams.PREVIOUS_BRIEF &&
      planPrevious?.narrative !== undefined,
  });
  const narrativeArtifact: StoredRevisionNarrative | null =
    planNarrative.data ?? null;
  const planDeltaOptions =
    planLastReview?.delta ?? disabledComparisonQuery<Brief>("delta");
  const planDelta = useQuery({
    ...planDeltaOptions,
    enabled:
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
  const delta = planDeltaWithRows ?? null;
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
  const planSinceMarksOptions =
    planLastReview?.marks ??
    disabledComparisonQuery<ComparisonMarks>("since-marks");
  const planSinceMarks = useQuery({
    ...planSinceMarksOptions,
    enabled: planLastReview !== undefined,
  });
  const sinceReviewMarks = planSinceMarks.data ?? null;

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
