import { useMemo } from "react";

import { useDelayedPending } from "../../../hooks/useDelayedPending";
import { buildAttributeRail } from "../../../../model/utils/view-model";
import type { ComparisonState, UseComparisonInput } from "../types";
import { deriveSinceMarkers } from "../utils";
import { useComparisonOverlay } from "./useComparisonOverlay";

export function useComparison({
  reading,
  address,
}: UseComparisonInput): ComparisonState {
  const { brief, model, comparisonPlan, fileRows } = reading;
  const { searchParams } = address;

  const attributeRail = useMemo(() => buildAttributeRail(model), [model]);
  const pendingShown = useDelayedPending(address.revisionPending);

  const overlay = useComparisonOverlay({
    brief,
    comparisonPlan,
    fileRows,
    searchParams,
  });
  const { sinceReviewMarks } = overlay;
  const sinceMarkers = useMemo(
    () => deriveSinceMarkers(model.groups, sinceReviewMarks),
    [model.groups, sinceReviewMarks],
  );

  return { attributeRail, pendingShown, overlay, sinceMarkers };
}
