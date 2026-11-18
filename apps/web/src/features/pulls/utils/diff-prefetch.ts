import type { QueryClient } from "@tanstack/react-query";

import { countBriefFiles, type Brief } from "@web/features/brief/model";
import {
  buildPrDiffPath,
  buildPrDiffQueryOptions,
  LARGE_DIFF_FILE_COUNT,
} from "../queries";
import type { Span } from "./briefRouteState";

export interface SpanDiffPrefetch {
  repoId: string;
  prNumber: number;
  span: Span;
  /** The router's hover preload, not a navigation. */
  preload: boolean;
  /** The loader's brief read; a hover reads the diff's size off it. */
  brief: Promise<Brief>;
}

function isServerRender(): boolean {
  return typeof window === "undefined";
}

/**
 * Starts the span diff's read in the browser while the route still loads,
 * so the code does not wait for hydration. Never on the server: the SSR
 * query integration would ship the diff inside the HTML. A hover starts it
 * only for a diff of at most `LARGE_DIFF_FILE_COUNT` files.
 */
export function prefetchSpanDiff(
  queryClient: QueryClient,
  input: SpanDiffPrefetch,
): void {
  if (isServerRender()) {
    return;
  }
  const { repoId, prNumber, span } = input;
  if (!input.preload) {
    void queryClient.prefetchQuery(
      buildPrDiffQueryOptions(repoId, prNumber, span.base, span.head),
    );
    return;
  }

  void input.brief.then(
    (brief) => {
      const fileCount = countBriefFiles(brief);
      if (fileCount > LARGE_DIFF_FILE_COUNT) {
        return undefined;
      }
      const options = buildPrDiffQueryOptions(
        repoId,
        prNumber,
        span.base,
        span.head,
        fileCount,
      );
      return queryClient.prefetchQuery(options);
    },
    () => undefined,
  );
}

/**
 * The span diff's path for the first load's preload link, rendered by the
 * server only: a client navigation reads the diff from the loader instead.
 */
export function readDiffPreloadPath(
  repoId: string,
  prNumber: number,
  span: Span,
): string | undefined {
  if (!isServerRender()) {
    return undefined;
  }
  return buildPrDiffPath(repoId, prNumber, span.base, span.head);
}
