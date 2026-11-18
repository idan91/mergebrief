import { isDiffFetchTimeout } from "../../../model/utils/brief-errors";
import type { DiffFetchRetry, DiffQueryState } from "./types";

/** Present only while the read timed out with no body landed before it. */
export function readDiffFetchRetry(
  query: DiffQueryState,
  releaseFocus: () => void,
): DiffFetchRetry | undefined {
  const timedOut = query.data === undefined && isDiffFetchTimeout(query.error);
  if (!timedOut) {
    return undefined;
  }

  return {
    pending: query.isFetching,
    failureCount: query.errorUpdateCount,
    retry: () => {
      void query.refetch();
    },
    releaseFocus,
  };
}

/** The read settled on an error the notice offers no retry for. */
export function isRetryFailed(
  query: DiffQueryState,
  retry: DiffFetchRetry | undefined,
): boolean {
  const hasError = query.error !== null && query.error !== undefined;
  const settled = !query.isFetching && query.data === undefined;
  const failedWithNoRetry = retry === undefined && hasError && settled;
  return failedWithNoRetry;
}

/** Focus went with a removed element: nothing on the page holds it now. */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}
