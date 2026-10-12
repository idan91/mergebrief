// The feature's queryOptions door, referenced by routes: react-query
// descriptors for the DB-backed read API, all over the isomorphic `apiFetch`
// boundary so loaders can SSR-prefetch them and the client refetches through
// the same gate. Artifact bodies are immutable per span (natural-key upserts)
// → Infinity staleTime; the list and PR-meta are live projections → short
// staleTime.
import {
  hashKey,
  queryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorCodes,
  apiFetchJson,
  apiFetchText,
} from "../../data/apiFetch";
import { getSsrWarnSink } from "../../data/ssrWarnSink";
import {
  type Brief,
  type ComparisonMarks,
  parseBrief,
  parseBriefContext,
  parseComparisonMarks,
  parseDeltaBrief,
  parseRevisionNarrativeArtifact,
  type PullStack,
  type RepoConfigContext,
} from "@web/features/brief/model";
import {
  parseReviewSessionPayload,
  type ReviewSessionPayload,
  type SessionReadListener,
  type SessionReadSource,
} from "../review/session";
import type { StoredRevisionNarrative } from "brief-core/artifact";
import { LIVE_POLL_MS } from "./consts";
import { parsePrSummary, parsePullStack } from "./schemas";
import type { PrSummary } from "./types";

function spanQuery(base: string, head: string): string {
  return `base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`;
}

function prPath(repoId: string, prNumber: number): string {
  return `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}`;
}

/** PR meta, the single generation-status poll target. */
export function buildPrMetaQueryOptions(repoId: string, prNumber: number) {
  return queryOptions({
    queryKey: ["pr-meta", repoId, prNumber],
    queryFn: async (): Promise<PrSummary> => {
      const path = prPath(repoId, prNumber);
      const body = await apiFetchJson(path);
      const parsed = parsePrSummary(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: 2_000,
    retry: false,
  });
}

/** Below the poll so a refocus after a hidden stretch refetches at once. */
const STACK_STALE_MS = 15_000;

/** The PR's stack on GitHub now, or the record for a closed PR, polled while the tab is visible. */
export function buildPrStackQueryOptions(repoId: string, prNumber: number) {
  return queryOptions({
    queryKey: ["pr-stack", repoId, prNumber],
    queryFn: async (): Promise<PullStack> => {
      const path = `${prPath(repoId, prNumber)}/stack`;
      const body = await apiFetchJson(path);
      const parsed = parsePullStack(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: STACK_STALE_MS,
    refetchInterval: LIVE_POLL_MS,
    retry: false,
  });
}

/** A DB-stored Brief artifact for an exact span, immutable once written. */
export function buildDbBriefQueryOptions(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
) {
  return queryOptions({
    queryKey: ["brief", "db", repoId, prNumber, base, head],
    queryFn: async (): Promise<Brief> => {
      const path = `${prPath(repoId, prNumber)}/brief?${spanQuery(base, head)}`;
      const body = await apiFetchText(path);
      // Route loaders SSR-prefetch this queryFn, so the sink is what keeps a
      // repair on a STORED Brief from shipping with zero signal. The browser
      // refetch resolves no sink and stays silent by design.
      const parsed = parseBrief(body, await getSsrWarnSink());
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * The span's repo-config snapshot, origin plus policy display weights.
 * Best-effort: a failure renders the Brief without source markers or
 * de-emphasis, never blocks it. Immutable per span, like the brief.
 */
export function buildDbBriefContextQueryOptions(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
) {
  return queryOptions({
    queryKey: ["brief-context", "db", repoId, prNumber, base, head],
    queryFn: async (): Promise<RepoConfigContext | null> => {
      const path = `${prPath(repoId, prNumber)}/brief-context?${spanQuery(base, head)}`;
      const body = await apiFetchJson(path);
      const parsed = parseBriefContext(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * The reviewer's Review Session on this Brief, read in the route loader so
 * the first paint already carries marks, drafts and dispositions. The read is
 * PURE: it never creates the session row. Live rather than immutable (a CLI
 * write lands in the same session), so it holds only briefly.
 */
export function buildSessionQueryOptions(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
  reads?: SessionReads,
) {
  return queryOptions({
    queryKey: ["review-session", repoId, prNumber, base, head],
    queryFn: async (): Promise<ReviewSessionPayload> => {
      const path = `${prPath(repoId, prNumber)}/session?${spanQuery(base, head)}`;
      const body = await apiFetchJson(path);
      const parsed = parseReviewSessionPayload(body);
      if (!parsed.ok) {
        // This runs during route-loader SSR prefetch, where the rejection is
        // absorbed into cache state and the UI quietly degrades to read-only.
        // The server side is the only one with an operator to tell.
        (await getSsrWarnSink())?.warn(
          `malformed review-session payload: ${parsed.error}`,
        );
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    // Refetch on window focus, so a CLI write made while the tab was in the
    // background appears when the reviewer comes back. No polling and no live
    // channel: the payload scales with reviewer actions, not PR size. The
    // store decides whether a landed read replaces it; composer text is
    // component state and survives either way.
    staleTime: 0,
    // Held while the Brief's store has a write in flight: the store would
    // drop that read anyway.
    refetchOnWindowFocus:
      reads === undefined ? true : () => !reads.hasPendingWrite(),
    // A remount re-reads: the loader's read can be up to its own freshness
    // window old, and the store is derived from the payload, so a cached one
    // would drop everything written since.
    refetchOnMount: "always",
    retry: false,
  });
}

/** One Brief's session reads, plus the pending-write check its focus refetch holds on. */
export interface SessionReads extends SessionReadSource {
  hasPendingWrite(): boolean;
}

/**
 * Feeds the session query's fetch start and landed data to the stores that
 * subscribe. The query cache notifies synchronously when a fetch begins, so
 * a store marks the read before any later write can start.
 */
export function createSessionReads(
  queryClient: QueryClient,
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
): SessionReads {
  const { queryKey } = buildSessionQueryOptions(repoId, prNumber, base, head);
  const queryHash = hashKey(queryKey);
  const listeners = new Set<SessionReadListener>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribeCache = queryClient
        .getQueryCache()
        .subscribe((event) => {
          const ownUpdate =
            event.type === "updated" && event.query.queryHash === queryHash;
          if (!ownUpdate) {
            return;
          }
          if (event.action.type === "fetch") {
            listener.startRead();
            return;
          }
          if (event.action.type !== "success") {
            return;
          }
          const payload = queryClient.getQueryData(queryKey);
          if (payload !== undefined) {
            listener.landRead(payload);
          }
        });
      return () => {
        unsubscribeCache();
        listeners.delete(listener);
      };
    },
    hasPendingWrite: () =>
      [...listeners].some((listener) => listener.hasPendingWrite()),
    requestRead() {
      void queryClient.refetchQueries({
        queryKey,
        exact: true,
        type: "active",
      });
    },
  };
}

/**
 * Comparison marks for a (baseline, head) span, immutable once written.
 * The key is widened to `QueryKey` because these descriptors cross the
 * `BriefComparisonPlan` boundary as plain `UseQueryOptions`, and a narrower
 * inferred key breaks that assignment through queryFn context contravariance.
 *
 * The DB body is coordinates-only, `{ baselineSha, headSha, files }`, because
 * persistence REJECTS `baselineLabel` and `baselineIndex` at write time; both
 * are synthesized here from the comparison this query IS and PR-meta's index,
 * null when the checkpoint SHA was never a briefed head.
 */
export function buildDbComparisonMarksQueryOptions(
  repoId: string,
  prNumber: number,
  baselineSha: string,
  headSha: string,
  baselineLabel: "previous-brief" | "checkpoint",
  baselineIndex: number | null,
) {
  const queryKey: QueryKey = [
    "comparisonMarks",
    "db",
    repoId,
    prNumber,
    baselineLabel,
    baselineSha,
    headSha,
  ];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<ComparisonMarks> => {
      const path = `${prPath(repoId, prNumber)}/marks?baseline=${encodeURIComponent(baselineSha)}&head=${encodeURIComponent(headSha)}`;
      const body = await apiFetchJson(path);
      if (typeof body !== "object" || body === null) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      const parsed = parseComparisonMarks({
        ...body,
        baselineLabel,
        baselineIndex,
      });
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * The pre-warmed delta core for (baseline = checkpoint SHA, head), immutable
 * once written. The body is the DELTA artifact shape (`changedGroups`,
 * `baselineSha`, `commentsAddressed`), read by `parseDeltaBrief`.
 * The caller only mounts this when PR-meta said `deltaAvailable`, so a 404
 * here is a real error, not a tier.
 */
export function buildDbDeltaQueryOptions(
  repoId: string,
  prNumber: number,
  baselineSha: string,
  headSha: string,
) {
  const queryKey: QueryKey = [
    "delta",
    "db",
    repoId,
    prNumber,
    baselineSha,
    headSha,
  ];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<Brief> => {
      const path = `${prPath(repoId, prNumber)}/delta?baseline=${encodeURIComponent(baselineSha)}&head=${encodeURIComponent(headSha)}`;
      const body = await apiFetchText(path);
      const parsed = parseDeltaBrief(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/** Revision narrative for (prevHead, head), real narrative or a skip stub. */
export function buildDbRevisionNarrativeQueryOptions(
  repoId: string,
  prNumber: number,
  prevHeadSha: string,
  headSha: string,
) {
  const queryKey: QueryKey = [
    "revisionNarrative",
    "db",
    repoId,
    prNumber,
    prevHeadSha,
    headSha,
  ];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<StoredRevisionNarrative> => {
      const path = `${prPath(repoId, prNumber)}/narrative?prevHead=${encodeURIComponent(prevHeadSha)}&head=${encodeURIComponent(headSha)}`;
      const body = await apiFetchText(path);
      const parsed = parseRevisionNarrativeArtifact(
        body,
        await getSsrWarnSink(),
      );
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCodes.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * The LIVE span diff (text). Server-side it is per-session cached ~60s and
 * never persisted; match that staleness here. The client slices it per chunk
 * with the shared `diffSlicing` module.
 */
export function buildPrDiffQueryOptions(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
) {
  const queryKey: QueryKey = ["pr-diff", repoId, prNumber, base, head];
  return queryOptions({
    queryKey,
    queryFn: (): Promise<string> =>
      apiFetchText(`${prPath(repoId, prNumber)}/diff?${spanQuery(base, head)}`),
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });
}
