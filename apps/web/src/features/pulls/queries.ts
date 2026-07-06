// react-query descriptors for the DB-backed read API (BRIEF-19 PR 3.1), all
// over the isomorphic `apiFetch` seam so loaders can SSR-prefetch them and the
// client refetches through the same gate. Artifact bodies are immutable per
// span (natural-key upserts) → Infinity staleTime; the list and PR-meta are
// live projections → short staleTime (PR-meta is the 3.2 poll target).
import { queryOptions } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorKind,
  apiFetch,
  apiFetchJson,
  apiFetchText,
  apiJsonFromResponse,
} from "../../data/apiFetch";
import { parseBrief } from "../brief/validation";
import type { Brief } from "../brief/types";
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
