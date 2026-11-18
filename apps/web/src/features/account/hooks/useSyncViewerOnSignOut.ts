// The viewer follows the data layer's `signed-out` reports, so a tab whose
// session ended elsewhere shows the signed-out state on its next read.
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { subscribeSignedOut } from "../../../data/signed-out";
import { buildViewerQueryOptions } from "../queries";
import { ViewerStates, type ViewerState } from "../types";
import { clearSignedInReads } from "./utils";

/**
 * Sets the viewer instead of refetching it: the viewer's own read reports
 * `signed-out` too, so a refetch here would loop. Marked stale, the next
 * focus reads it again and picks up a sign-in from another tab. Only the
 * first report clears the signed-in reads; the refetches that follow report
 * again and must find nothing left to do.
 */
export function useSyncViewerOnSignOut(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let stopClearing = () => {};
    const unsubscribe = subscribeSignedOut(() => {
      const { queryKey } = buildViewerQueryOptions();
      const viewer = queryClient.getQueryData<ViewerState>(queryKey);
      if (viewer?.kind === ViewerStates.SIGNED_OUT) {
        return;
      }

      queryClient.setQueryData(queryKey, { kind: ViewerStates.SIGNED_OUT });
      void queryClient.invalidateQueries({
        queryKey,
        exact: true,
        refetchType: "none",
      });
      stopClearing();
      stopClearing = clearSignedInReads(queryClient, hashKey(queryKey));
    });

    return () => {
      unsubscribe();
      stopClearing();
    };
  }, [queryClient]);
}
