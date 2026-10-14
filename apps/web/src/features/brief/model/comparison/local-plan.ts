import type { LocalComparisonAvailability } from "contract";
import { queryOptions, type QueryKey } from "@tanstack/react-query";
import type { Mutable } from "types/utils";

import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
  buildLocalComparisonMarksQueryOptions,
  buildLocalRevisionNarrativeQueryOptions,
} from "../../queries";
import { createFileRowsCache } from "../file-rows/cache";
import type { Brief } from "../types";
import { attachSlicedDiffs } from "../utils/diff-slicing";
import type { ComparisonQuery } from "./comparison-query";
import type { BriefComparisonPlan } from "./types";

type PreviousBriefPlan = Mutable<
  NonNullable<BriefComparisonPlan["previousBrief"]>
>;
type LastReviewPlan = Mutable<NonNullable<BriefComparisonPlan["lastReview"]>>;

/**
 * The file route's comparison plan, read from one Brief head's local
 * sidecars. A local baseline carries no raw span diff.
 */
export function buildLocalComparisonPlan(
  comparisons: LocalComparisonAvailability | undefined,
): BriefComparisonPlan {
  const plan: Mutable<BriefComparisonPlan> = {};

  const previous = comparisons?.previousBrief;
  if (previous !== undefined) {
    const previousBrief: PreviousBriefPlan = {
      marks: buildLocalComparisonMarksQueryOptions(previous.marksId),
    };
    if (previous.narrativeId !== undefined) {
      previousBrief.narrative = buildLocalRevisionNarrativeQueryOptions(
        previous.narrativeId,
      );
    }
    plan.previousBrief = previousBrief;
  }

  const lastReview = comparisons?.lastReview;
  if (lastReview !== undefined) {
    const lastReviewPlan: LastReviewPlan = {
      marks: buildLocalComparisonMarksQueryOptions(lastReview.marksId),
    };
    if (lastReview.deltaId !== undefined) {
      lastReviewPlan.delta = buildLocalDeltaQueryOptions(lastReview.deltaId);
    }
    plan.lastReview = lastReviewPlan;
  }

  return plan;
}

/**
 * The delta's rows come from its own diffs sidecar (baseline to head), never
 * the head brief's (base to head). One query over both sidecars: a failed
 * read means no delta, never row-less cards.
 */
function buildLocalDeltaQueryOptions(deltaId: string): ComparisonQuery<Brief> {
  const queryKey: QueryKey = ["comparisonDelta", "local", deltaId];
  return queryOptions({
    queryKey,
    queryFn: async ({ client }) => {
      const [delta, patches] = await Promise.all([
        client.fetchQuery(buildLocalBriefQueryOptions(deltaId)),
        client.fetchQuery(buildLocalBriefDiffsQueryOptions(deltaId)),
      ]);
      const patchesByFile = new Map(
        patches.map((entry) => [entry.file, entry.patch]),
      );

      return attachSlicedDiffs(delta, createFileRowsCache(patchesByFile));
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}
