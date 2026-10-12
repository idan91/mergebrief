import type { QueryCacheNotifyEvent, QueryClient } from "@tanstack/react-query";

/** Any update that leaves the read idle, a cancel's revert included. */
function isSettledEvent(event: QueryCacheNotifyEvent): boolean {
  return event.type === "updated" && event.query.state.fetchStatus === "idle";
}

/**
 * Resets every read but the viewer's, so nothing a signed-in viewer loaded
 * stays cached or rendered. A read in flight is reset once it settles:
 * resetting it mid-fetch would cancel a loader's promise, which then rejects
 * with no refusal for the page to show. Returns the stop for that wait.
 */
export function clearSignedInReads(
  queryClient: QueryClient,
  viewerHash: string,
): () => void {
  const cache = queryClient.getQueryCache();
  const inFlight = new Set(
    cache
      .findAll({ predicate: (query) => query.state.fetchStatus !== "idle" })
      .map((query) => query.queryHash)
      .filter((queryHash) => queryHash !== viewerHash),
  );

  void queryClient.resetQueries({
    predicate: (query) => {
      const isIdle = query.state.fetchStatus === "idle";
      const isViewerRead = query.queryHash === viewerHash;
      const resetsNow = isIdle && !isViewerRead;
      return resetsNow;
    },
  });
  if (inFlight.size === 0) {
    return () => {};
  }

  const unsubscribe = cache.subscribe((event) => {
    const { queryHash, queryKey } = event.query;
    if (!inFlight.has(queryHash)) {
      return;
    }
    if (event.type === "removed") {
      inFlight.delete(queryHash);
    }
    if (isSettledEvent(event)) {
      inFlight.delete(queryHash);
      void queryClient.resetQueries({ queryKey, exact: true });
    }
    if (inFlight.size === 0) {
      unsubscribe();
    }
  });
  return unsubscribe;
}
