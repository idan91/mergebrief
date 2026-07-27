// The comparison-overlay facade hook: resolves the View/Compare state and the
// active baseline's data. Marks/narrative/delta resolve from ONE source — the
// injected plan (DB path) or the local sidecar ids; both query sets exist as
// hooks and `enabled` picks.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  comparisonAvailability,
  resolveBriefSearch,
  type BriefSearch,
  type BriefSearchParams,
  type CompareOptionFlags,
  type CompareParam,
} from "../../comparison/compareState";
import type { ComparisonSource } from "../../comparison/comparison";
import type { ComparisonOverlayState } from "../../comparison/comparisonOverlay";
import type { ComparisonQuery } from "../../comparison/comparisonQuery";
import {
  localBriefQueryOptions,
  localComparisonMarksQueryOptions,
  localRevisionNarrativeQueryOptions,
} from "../../queries";
import { buildBriefTimeline, type BriefTimeline } from "../../utils/timeline";
import type {
  Brief,
  ComparisonMarks,
  LocalBriefSummary,
  RevisionNarrative,
  RevisionNarrativeArtifact,
  RevisionNarrativeSkipReason,
} from "../../types";
import {
  countComparisonRuns,
  disabledComparisonQuery,
  discriminateNarrativeArtifact,
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
    readonly narrative?: ComparisonQuery<RevisionNarrativeArtifact>;
    /** Live raw span diff baseline → head (Changes Only "Show raw diff"). */
    readonly rawDiff?: ComparisonQuery<string>;
  };
  /** The personal checkpoint comparison — offered iff marks exist. */
  readonly lastReview?: {
    readonly marks: ComparisonQuery<ComparisonMarks>;
    /** Absent = marks-only tier: the worker skipped the delta core. */
    readonly delta?: ComparisonQuery<Brief>;
    /** Live raw span diff checkpoint → head. */
    readonly rawDiff?: ComparisonQuery<string>;
  };
}

export interface UseComparisonOverlayInput {
  /** Feeds the LOCAL timeline/comparisons; may be empty (self-disables). */
  artifacts: LocalBriefSummary[];
  brief: Brief;
  briefId: string;
  comparisonPlan: BriefComparisonPlan | undefined;
  /** Raw View/Compare URL params (ADR 0024 plan step 6). */
  searchParams: BriefSearchParams;
}

export interface UseComparisonOverlayValue {
  /** The LOCAL timeline (header's revision strip on the file-backed path). */
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
}

/**
 * Comparison overlay (ADR 0024): the active Compare baseline drives both the
 * Full Brief highlights and the Changes Only content. Marks are mechanical —
 * the sole source of truth for highlights; the narrative/Delta only supplies
 * callout text and the changed-only summaries (highlights never derive from
 * them). One state machine parameterized by baseline, not two.
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
  // previous-brief-only, delta last-review-only — mirroring the local ids.
  const planPrevious = comparisonPlan?.previousBrief;
  const planLastReview = comparisonPlan?.lastReview;
  const activePlanSlot =
    activeCompare === "previous-brief"
      ? planPrevious
      : activeCompare === "last-review"
        ? planLastReview
        : undefined;
  const planActive =
    comparisonPlan !== undefined && activePlanSlot !== undefined;
  // Each slot carries its own baseline's raw span diff. Absent on the local
  // path and while Compare is off → the Changes Only toggle hides.
  const activeRawSpanDiff =
    activeCompare === "previous-brief"
      ? planPrevious?.rawDiff
      : activeCompare === "last-review"
        ? planLastReview?.rawDiff
        : undefined;
  const localMarks = useQuery({
    ...localComparisonMarksQueryOptions(marksId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(marksId),
  });
  const planMarks = useQuery({
    ...(activePlanSlot?.marks ??
      disabledComparisonQuery<ComparisonMarks>("marks")),
    enabled: planActive,
  });
  const marks =
    (comparisonPlan === undefined ? localMarks.data : planMarks.data) ?? null;
  const localNarrative = useQuery({
    ...localRevisionNarrativeQueryOptions(narrativeId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(narrativeId),
  });
  const planNarrative = useQuery({
    ...(planPrevious?.narrative ??
      disabledComparisonQuery<RevisionNarrativeArtifact>("narrative")),
    enabled:
      planActive &&
      activeCompare === "previous-brief" &&
      planPrevious?.narrative !== undefined,
  });
  const narrativeArtifact: RevisionNarrativeArtifact | null =
    (comparisonPlan === undefined ? localNarrative.data : planNarrative.data) ??
    null;
  const localDelta = useQuery({
    ...localBriefQueryOptions(deltaId ?? ""),
    enabled: comparisonPlan === undefined && Boolean(deltaId),
  });
  const planDelta = useQuery({
    ...(planLastReview?.delta ?? disabledComparisonQuery<Brief>("delta")),
    enabled:
      planActive &&
      activeCompare === "last-review" &&
      planLastReview?.delta !== undefined,
  });
  const delta =
    (comparisonPlan === undefined ? localDelta.data : planDelta.data) ?? null;

  const { narrative, skipReason } =
    discriminateNarrativeArtifact(narrativeArtifact);

  const comparisonSource: ComparisonSource = useMemo(
    () =>
      activeCompare === "last-review"
        ? { kind: "last-review", delta }
        : { kind: "previous-brief", brief, narrative },
    [activeCompare, brief, delta, narrative],
  );

  const comparison: ComparisonOverlayState = useMemo(() => {
    // The overlay only paints in Full Brief; Changes Only renders its own view.
    const available =
      compareState.view === "full" && activeCompare !== "off" && Boolean(marks);
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
  };
}
