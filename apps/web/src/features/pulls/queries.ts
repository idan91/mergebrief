// react-query descriptors for the DB-backed read API (BRIEF-19 PR 3.1), all
// over the isomorphic `apiFetch` seam so loaders can SSR-prefetch them and the
// client refetches through the same gate. Artifact bodies are immutable per
// span (natural-key upserts) → Infinity staleTime; the list and PR-meta are
// live projections → short staleTime (PR-meta is the 3.2 poll target).
import { queryOptions, type QueryKey } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorKind,
  apiFetch,
  apiFetchJson,
  apiFetchText,
  apiJsonFromResponse,
} from "../../data/apiFetch";
import {
  parseBrief,
  parseComparisonMarks,
  parseRevisionNarrativeArtifact,
} from "../brief/validation";
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
        throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
      }
      return { kind: "ready", pulls: parsed.value };
    },
    staleTime: 15_000,
    retry: false,
  });
}

/** PR meta — the single generation-status poll target (polling wired in 3.2). */
export function prMetaQueryOptions(repoId: string, prNumber: number) {
  return queryOptions({
    queryKey: ["pr-meta", repoId, prNumber],
    queryFn: async (): Promise<PrSummary> => {
      const path = prPath(repoId, prNumber);
      const body = await apiFetchJson(path);
      const parsed = parsePrSummary(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorKind.MALFORMED, 200, path);
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
      const parsed = parseBrief(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorKind.MALFORMED, 200, path);
      }
      return parsed.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
}

/**
 * Comparison marks for a (baseline, head) span — immutable once written.
 * The key is deliberately widened to `QueryKey`: these descriptors cross the
 * `BriefComparisonPlan` seam typed as plain `UseQueryOptions`, and a narrower
 * inferred key breaks that assignment (queryFn context contravariance).
 *
 * The DB body is D13 coordinates-only (`{ baselineSha, headSha, files }` —
 * persistence REJECTS `baselineLabel`/`baselineIndex` at write time), while
 * the renderer's `ComparisonMarks` carries both summary fields. They are
 * synthesized here from what the caller already knows: this query IS the
 * previous-brief comparison, and the index comes from PR-meta's availability.
 */
export function dbComparisonMarksQueryOptions(
  repoId: string,
  prNumber: number,
  baselineSha: string,
  headSha: string,
  baselineIndex: number,
) {
  const queryKey: QueryKey = [
    "comparisonMarks",
    "db",
    repoId,
    prNumber,
    baselineSha,
    headSha,
  ];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<ComparisonMarks> => {
      const path = `${prPath(repoId, prNumber)}/marks?baseline=${encodeURIComponent(baselineSha)}&head=${encodeURIComponent(headSha)}`;
      const body = await apiFetchJson(path);
      if (typeof body !== "object" || body === null) {
        throw new ApiError(ApiErrorKind.MALFORMED, 200, path);
      }
      const parsed = parseComparisonMarks({
        ...body,
        baselineLabel: "previous-brief",
        baselineIndex,
      });
      if (!parsed.ok) {
        throw new ApiError(ApiErrorKind.MALFORMED, 200, path);
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
        throw new ApiError(ApiErrorKind.MALFORMED, 200, path);
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
 * never persisted (ADR 0016 #10); match that staleness here. The client
 * slices it per chunk with the shared `diffSlicing` module.
 */
export function prDiffQueryOptions(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
) {
  return queryOptions({
    queryKey: ["pr-diff", repoId, prNumber, base, head],
    queryFn: (): Promise<string> =>
      apiFetchText(`${prPath(repoId, prNumber)}/diff?${spanQuery(base, head)}`),
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });
}
