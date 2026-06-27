import { queryOptions } from "@tanstack/react-query";

import {
  getLocalBrief,
  getLocalBriefs,
  getLocalRevisionChanges,
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

export function localBriefsQueryOptions() {
  return queryOptions({
    queryKey: ["briefs", "local"],
    queryFn: () => getLocalBriefs(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
