import { queryOptions } from "@tanstack/react-query";

import {
  getLocalBrief,
  getLocalBriefs,
  getLocalComparisonMarks,
  getLocalRevisionChanges,
  getLocalRevisionNarrative,
} from "./brief.functions";

export function localBriefQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["brief", "local", briefId],
    queryFn: () => getLocalBrief({ data: { briefId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function localRevisionChangesQueryOptions(briefId: string) {
  return queryOptions({
    queryKey: ["revisionChanges", "local", briefId],
    queryFn: () => getLocalRevisionChanges({ data: { briefId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function localComparisonMarksQueryOptions(marksId: string) {
  return queryOptions({
    queryKey: ["comparisonMarks", "local", marksId],
    queryFn: () => getLocalComparisonMarks({ data: { id: marksId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function localRevisionNarrativeQueryOptions(narrativeId: string) {
  return queryOptions({
    queryKey: ["revisionNarrative", "local", narrativeId],
    queryFn: () => getLocalRevisionNarrative({ data: { id: narrativeId } }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function localBriefsQueryOptions() {
  return queryOptions({
    queryKey: ["briefs", "local"],
    queryFn: () => getLocalBriefs(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
