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
  buildOperationPath,
  ProductQueryIds,
  type OperationParams,
  type ProductQueryId,
} from "contract";
import { HttpStatuses, type ComparisonBaselineLabel } from "types";
import { z } from "zod/v4";

import { ApiError, ApiErrorCodes } from "../../data/apiFetch";
import { request, requestText } from "../../data/request";
import { getSsrWarnSink } from "../../data/ssrWarnSink";
import {
  briefContextSchema,
  type Brief,
  type ComparisonMarks,
  parseBrief,
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
import {
  briefLayoutReplySchema,
  prSummarySchema,
  pullStackSchema,
} from "./schemas";
import type { PrSummary, StoredBriefLayout } from "./types";
import { resolveOutagePollMs } from "./utils/poll-backoff";

/** A stored body is checked only for being an object; its reader parses the rest. */
const storedObjectSchema = z.record(z.string(), z.unknown());

/** Any JSON body; its reader judges the shape and can say why it refused. */
const jsonBodySchema = z.unknown();

/** A 2xx body its reader refused, named by the operation's path. */
function buildMalformedError<Id extends ProductQueryId>(
  id: Id,
  params: OperationParams<Id>,
): ApiError {
  const path = buildOperationPath(id, params);
  return new ApiError(ApiErrorCodes.MALFORMED, HttpStatuses.OK, path);
}

function readPrSummary(repoId: string, prNumber: number): Promise<PrSummary> {
  return request(
    ProductQueryIds.READ_PULL,
    { params: { repoId, prNumber } },
    prSummarySchema,
  );
}

/** PR meta, the single generation-status poll target. */
export function buildPrMetaQueryOptions(repoId: string, prNumber: number) {
  return queryOptions({
    queryKey: ["pr-meta", repoId, prNumber],
    queryFn: () => readPrSummary(repoId, prNumber),
    staleTime: 2_000,
  });
}

/** Below the poll so a refocus after a hidden stretch refetches at once. */
const STACK_STALE_MS = 15_000;

function readPrStack(repoId: string, prNumber: number): Promise<PullStack> {
  return request(
    ProductQueryIds.READ_STACK,
    { params: { repoId, prNumber } },
    pullStackSchema,
  );
}

/** The PR's stack on GitHub now, or the record for a closed PR, polled while the tab is visible. */
export function buildPrStackQueryOptions(repoId: string, prNumber: number) {
  return queryOptions({
    queryKey: ["pr-stack", repoId, prNumber],
    queryFn: () => readPrStack(repoId, prNumber),
    staleTime: STACK_STALE_MS,
    refetchInterval: (query) => resolveOutagePollMs(query.state, LIVE_POLL_MS),
  });
}

async function readDbBrief(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
): Promise<Brief> {
  const params = { repoId, prNumber };
  const body = await requestText(ProductQueryIds.READ_BRIEF, {
    params,
    query: { base, head },
  });
  // Route loaders SSR-prefetch this read, so the sink is what keeps a
  // repair on a STORED Brief from shipping with zero signal. The browser
  // refetch resolves no sink and stays silent by design.
  const parsed = parseBrief(body, await getSsrWarnSink());
  if (!parsed.ok) {
    throw buildMalformedError(ProductQueryIds.READ_BRIEF, params);
  }
  return parsed.value;
}

async function readDbBriefLayout(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
): Promise<StoredBriefLayout> {
  const reply = await request(
    ProductQueryIds.READ_BRIEF_LAYOUT,
    { params: { repoId, prNumber }, query: { base, head } },
    briefLayoutReplySchema,
  );
  const layout: StoredBriefLayout = {};
  if (reply.layout !== undefined) {
    layout.body = reply.layout;
  }
  return layout;
}

/**
 * The brief's stored per-chunk row counts, written with the brief and
 * immutable like it. A brief written without them reads as a layout with no
 * body: the page then sizes its cards from its own estimate, as it does when
 * the read fails.
 */
export function buildDbBriefLayoutQueryOptions(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
) {
  return queryOptions({
    queryKey: ["brief-layout", "db", repoId, prNumber, base, head],
    queryFn: () => readDbBriefLayout(repoId, prNumber, base, head),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
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
    queryFn: () => readDbBrief(repoId, prNumber, base, head),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
  });
}

function readDbBriefContext(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
): Promise<RepoConfigContext | null> {
  return request(
    ProductQueryIds.READ_BRIEF_CONTEXT,
    { params: { repoId, prNumber }, query: { base, head } },
    briefContextSchema,
  );
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
    queryFn: () => readDbBriefContext(repoId, prNumber, base, head),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
  });
}

async function readReviewSession(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
): Promise<ReviewSessionPayload> {
  const params = { repoId, prNumber };
  const body = await request(
    ProductQueryIds.READ_REVIEW_SESSION,
    { params, query: { base, head } },
    jsonBodySchema,
  );
  const parsed = parseReviewSessionPayload(body);
  if (!parsed.ok) {
    // This runs during route-loader SSR prefetch, where the rejection is
    // absorbed into cache state and the UI quietly degrades to read-only.
    // The server side is the only one with an operator to tell.
    (await getSsrWarnSink())?.warn("malformed review-session payload", {
      reason: parsed.error,
    });
    throw buildMalformedError(ProductQueryIds.READ_REVIEW_SESSION, params);
  }
  return parsed.value;
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
    queryFn: () => readReviewSession(repoId, prNumber, base, head),
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

async function readDbComparisonMarks(
  repoId: string,
  prNumber: number,
  baselineSha: string,
  headSha: string,
  baselineLabel: ComparisonBaselineLabel,
  baselineIndex: number | null,
): Promise<ComparisonMarks> {
  const params = { repoId, prNumber };
  const body = await request(
    ProductQueryIds.READ_MARKS,
    { params, query: { baseline: baselineSha, head: headSha } },
    storedObjectSchema,
  );
  const parsed = parseComparisonMarks({
    ...body,
    baselineLabel,
    baselineIndex,
  });
  if (!parsed.ok) {
    throw buildMalformedError(ProductQueryIds.READ_MARKS, params);
  }
  return parsed.value;
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
  baselineLabel: ComparisonBaselineLabel,
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
    queryFn: () =>
      readDbComparisonMarks(
        repoId,
        prNumber,
        baselineSha,
        headSha,
        baselineLabel,
        baselineIndex,
      ),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
  });
}

async function readDbDelta(
  repoId: string,
  prNumber: number,
  baselineSha: string,
  headSha: string,
): Promise<Brief> {
  const params = { repoId, prNumber };
  const body = await requestText(ProductQueryIds.READ_DELTA, {
    params,
    query: { baseline: baselineSha, head: headSha },
  });
  const parsed = parseDeltaBrief(body);
  if (!parsed.ok) {
    throw buildMalformedError(ProductQueryIds.READ_DELTA, params);
  }
  return parsed.value;
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
    queryFn: () => readDbDelta(repoId, prNumber, baselineSha, headSha),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
  });
}

async function readDbRevisionNarrative(
  repoId: string,
  prNumber: number,
  prevHeadSha: string,
  headSha: string,
): Promise<StoredRevisionNarrative> {
  const params = { repoId, prNumber };
  const body = await requestText(ProductQueryIds.READ_NARRATIVE, {
    params,
    query: { prevHead: prevHeadSha, head: headSha },
  });
  const parsed = parseRevisionNarrativeArtifact(body, await getSsrWarnSink());
  if (!parsed.ok) {
    throw buildMalformedError(ProductQueryIds.READ_NARRATIVE, params);
  }
  return parsed.value;
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
    queryFn: () =>
      readDbRevisionNarrative(repoId, prNumber, prevHeadSha, headSha),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1000,
  });
}

function readPrDiff(
  repoId: string,
  prNumber: number,
  base: string,
  head: string,
): Promise<string> {
  return requestText(ProductQueryIds.READ_DIFF, {
    params: { repoId, prNumber },
    query: { base, head },
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
    queryFn: () => readPrDiff(repoId, prNumber, base, head),
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
  });
}
