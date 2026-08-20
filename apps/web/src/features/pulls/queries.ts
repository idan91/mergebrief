// The feature's queryOptions door, referenced by routes: react-query
// descriptors for the DB-backed read API, all over the isomorphic `apiFetch`
// boundary so loaders can SSR-prefetch them and the client refetches through
// the same gate. Artifact bodies are immutable per span (natural-key upserts)
// → Infinity staleTime; the list and PR-meta are live projections → short
// staleTime.
import { queryOptions, type QueryKey } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  apiFetchJson,
  apiFetchText,
  apiJsonFromResponse,
} from "../../data/apiFetch";
import { getSsrWarnSink } from "../../data/ssrWarnSink";
import {
  parseBrief,
  parseComparisonMarks,
  parseDeltaBrief,
  parseRevisionNarrativeArtifact,
} from "../brief/utils/validation";
import {
  hasPendingSessionWrite,
  parseReviewSessionPayload,
  type ReviewSessionPayload,
} from "../review/session";
import {
  parseBriefContext,
  type RepoConfigContext,
} from "../brief/utils/repoConfig";
import type {
  Brief,
  ComparisonMarks,
  RevisionNarrativeArtifact,
} from "../brief/types";
import {
  parsePrSummary,
  parsePullsList,
  type PrSummary,
  type PullsSession,
} from "./types";

function spanQuery(base: string, head: string): string {
  return `base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`;
}

function prPath(repoId: string, prNumber: number): string {
  return `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}`;
}

/**
 * The picker's list. A 401 (logged out) and a 502/503 (backend/GitHub down)
 * are EXPECTED states the picker renders inline — they must not blow away the
 * whole route (the local-briefs section still works). Only contract
 * violations (malformed 200) throw.
 */
export function pullsSessionQueryOptions() {
  return queryOptions({
    queryKey: ["pulls", "session-list"],
    queryFn: async (): Promise<PullsSession> => {
      const path = "/api/pulls";
      const response = await apiFetch(path);
      if (response.status === 401) {
        return { kind: "logged-out" };
      }
      if (response.status === 502 || response.status === 503) {
        return { kind: "unavailable" };
      }
      const body = await apiJsonFromResponse(response, path);
      const parsed = parsePullsList(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
      }
      return { kind: "ready", pulls: parsed.value };
    },
    staleTime: 15_000,
    retry: false,
  });
}

/** PR meta — the single generation-status poll target. */
export function prMetaQueryOptions(repoId: string, prNumber: number) {
  return queryOptions({
    queryKey: ["pr-meta", repoId, prNumber],
    queryFn: async (): Promise<PrSummary> => {
      const path = prPath(repoId, prNumber);
      const body = await apiFetchJson(path);
      const parsed = parsePrSummary(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: 2_000,
    retry: false,
  });
}

/** A DB-stored Brief artifact for an exact span — immutable once written. */
export function dbBriefQueryOptions(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
) {
  return queryOptions({
    queryKey: ["brief", "db", repoId, prNumber, base, head],
    queryFn: async (): Promise<Brief> => {
      const path = `${prPath(repoId, prNumber)}/brief?${spanQuery(base, head)}`;
      const body = await apiFetchJson(path);
      // Route loaders SSR-prefetch this queryFn, so the sink is what keeps a
      // lenient drop (a malformed optional section on a STORED Brief) from
      // shipping with zero signal. The browser refetch resolves no sink and
      // stays silent by design.
      const parsed = parseBrief(body, await getSsrWarnSink());
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * The span's repo-config snapshot — origin + policy display weights. Best-effort: a failure renders the Brief without source markers
 * or de-emphasis, never blocks it. Immutable per span (like the brief).
 */
export function dbBriefContextQueryOptions(
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
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * The reviewer's Review Session on this Brief — read in the route loader so
 * the first paint already carries marks, drafts and dispositions. The read is
 * PURE: it never creates the session row. Live rather than immutable (a CLI
 * write lands in the same session), so it holds only briefly.
 */
export function sessionQueryOptions(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
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
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    // Refetch on window focus, so a CLI write made while the tab was in the
    // background appears when the reviewer comes back. No polling and no live
    // channel: the payload scales with reviewer actions, not PR size. The
    // refetch REPLACES the store, which is safe because every action already
    // wrote through — composer text is component state and survives it.
    staleTime: 0,
    // Suppressed while this tab has a write in flight: the refetch replaces
    // the store, and a payload computed before that write lands would take
    // the reviewer's own action back off the screen.
    refetchOnWindowFocus: () => !hasPendingSessionWrite(),
    // A remount re-reads: the loader's read can be up to its own freshness
    // window old, and the store is derived from the payload, so a cached one
    // would drop everything written since.
    refetchOnMount: "always",
    retry: false,
  });
}

/**
 * Comparison marks for a (baseline, head) span — immutable once written.
 * The key is deliberately widened to `QueryKey`: these descriptors cross the
 * `BriefComparisonPlan` boundary typed as plain `UseQueryOptions`, and a narrower
 * inferred key breaks that assignment (queryFn context contravariance).
 *
 * The DB body is coordinates-only (`{ baselineSha, headSha, files }` —
 * persistence REJECTS `baselineLabel`/`baselineIndex` at write time), while
 * the renderer's `ComparisonMarks` carries both summary fields. They are
 * synthesized here from what the caller already knows: which comparison this
 * query IS (`previous-brief` or the `checkpoint` baseline), and the index
 * from PR-meta's availability (null when the checkpoint SHA was never a
 * briefed head).
 */
export function dbComparisonMarksQueryOptions(
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
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
      }
      const parsed = parseComparisonMarks({
        ...body,
        baselineLabel,
        baselineIndex,
      });
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * The pre-warmed delta core for (baseline = checkpoint SHA, head) — immutable
 * once written. The body is the DELTA artifact shape (`changedGroups`,
 * `baselineSha`, `commentsAddressed` — `parseDeltaBrief`, NOT `parseBrief`).
 * The caller only mounts this when PR-meta said `deltaAvailable`, so a 404
 * here is a real error, not a tier.
 */
export function dbDeltaQueryOptions(
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
      const body = await apiFetchJson(path);
      const parsed = parseDeltaBrief(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/** Revision narrative for (prevHead, head) — real narrative or a skip stub. */
export function dbRevisionNarrativeQueryOptions(
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
    queryFn: async (): Promise<RevisionNarrativeArtifact> => {
      const path = `${prPath(repoId, prNumber)}/narrative?prevHead=${encodeURIComponent(prevHeadSha)}&head=${encodeURIComponent(headSha)}`;
      const body = await apiFetchJson(path);
      const parsed = parseRevisionNarrativeArtifact(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, 200, path);
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
export function prDiffQueryOptions(
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
