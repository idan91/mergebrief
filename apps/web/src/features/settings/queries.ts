// The Instance tab's one read. The count moves with every run the Instance
// starts and resets at 00:00 UTC, so it refetches on focus and once a minute
// while the page is visible; the panel reads its relative time off the fetch.
import { queryOptions } from "@tanstack/react-query";
import { ProductQueryIds, type SpendView } from "contract";

import { request } from "../../data/request";
import { spendViewSchema } from "./schemas";

const SPEND_POLL_MS = 60_000;

function readSpend(): Promise<SpendView> {
  return request(ProductQueryIds.READ_SPEND, { params: {} }, spendViewSchema);
}

export function buildSpendQueryOptions() {
  return queryOptions({
    queryKey: ["spend"],
    queryFn: readSpend,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: SPEND_POLL_MS,
    refetchIntervalInBackground: false,
  });
}
