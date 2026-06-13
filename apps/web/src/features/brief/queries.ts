import { queryOptions } from "@tanstack/react-query";

import { getLocalBrief } from "./brief.functions";

export function localBriefQueryOptions() {
  return queryOptions({
    queryKey: ["brief", "local", "Idan91-flexer-55"],
    queryFn: () => getLocalBrief(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
