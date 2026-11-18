import {
  PrSpanFailureKinds,
  readPrSpan,
  type PrSpanFailure,
  type PrSpanRefs,
  type PrSpanResult,
} from "brief-core/pr-span";
import { DiffModes } from "contract";
import type { RepositoryRef } from "github";
import type { Logger } from "logging";
import type { Mutable } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { parseOwnerAndName } from "../../utils";
import { DIFF_FETCH_DEADLINE_MS } from "./consts";
import { buildDiffCacheKey } from "./logic/keys";
import { measureHeldBytes } from "./logic/held-bytes";
import {
  buildApiPrSpanSource,
  type ApiPrSpanSource,
} from "./logic/span-source";
import type { DiffQuery } from "./schemas";
import {
  DiffLifetimes,
  SpanReadKinds,
  type DiffLifetime,
  type DiffRead,
  type ModedDiffRead,
  type ReadDiffDeps,
} from "./types";
import { commitShaSchema } from "../../../wire-bounds";

const NOT_FOUND: DiffRead = { ok: false, error: { kind: "not-found" } };
const SPAN_TOO_LARGE: DiffRead = {
  ok: false,
  error: { kind: "span-too-large" },
};
const PAST_DEADLINE: DiffRead = { ok: false, error: { kind: "deadline" } };

/**
 * The LIVE diff for the requested `base...head` pair, read on the viewer's
 * binding by the gate's verified slug and cached per session, NEVER
 * persisted. A pair a marks row certifies is served as that revision span,
 * on the refs the row stores; a whole-PR pair, or one no span key covers,
 * as GitHub's compare. Concurrent reads of one cache key share one read,
 * which stops at its deadline, never at a caller's disconnect. Behind an
 * operator pass the binding falls back only when both refs are full SHAs
 * recorded for the granted PR.
 */
export async function readDiff(
  deps: ReadDiffDeps,
  access: PullRequestAccess,
  query: DiffQuery,
): Promise<ModedDiffRead> {
  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return { mode: DiffModes.COMPARE, read: NOT_FOUND };
  }

  const spanRead = await deps.spanKeys.classify(access, query);
  if (spanRead.kind === SpanReadKinds.REFUSED) {
    return { mode: DiffModes.REVISION_SPAN, read: SPAN_TOO_LARGE };
  }
  const isSpan = spanRead.kind === SpanReadKinds.SPAN;
  const mode = isSpan ? DiffModes.REVISION_SPAN : DiffModes.COMPARE;
  const keyInput: Mutable<Parameters<typeof buildDiffCacheKey>[0]> = {
    sessionTokenHash: access.session.sessionTokenHash,
    repoId: access.repoId,
    prNumber: access.prNumber,
    base: query.base,
    head: query.head,
  };
  if (isSpan) {
    keyInput.refs = spanRead.refs;
  }
  const cacheKey = buildDiffCacheKey(keyInput);

  const now = Date.now();
  const cached =
    deps.diffCache.get(cacheKey, now) ?? deps.largeDiffCache.get(cacheKey, now);
  if (cached !== undefined) {
    return { mode, read: { ok: true, value: cached } };
  }
  const inFlight = deps.diffFetches.get(cacheKey);
  if (inFlight !== undefined) {
    return { mode, read: await inFlight };
  }

  const fetching = (
    isSpan
      ? fetchSpanDiff(deps, access, { repo, refs: spanRead.refs, cacheKey })
      : fetchDiff(deps, access, repo, query, cacheKey)
  ).finally(() => {
    deps.diffFetches.delete(cacheKey);
  });
  deps.diffFetches.set(cacheKey, fetching);
  return { mode, read: await fetching };
}

/**
 * Reads the span's diff so the page's own read lands on the cache. Never
 * rejects: a failure caches nothing and reaches no caller.
 */
export async function warmDiff(
  deps: ReadDiffDeps,
  access: PullRequestAccess,
  query: DiffQuery,
  log: Logger,
): Promise<void> {
  try {
    const { read } = await readDiff(deps, access, query);
    if (!read.ok) {
      log.debug("span diff warm refused", { failure: read.error.kind });
    }
  } catch (error) {
    log.debug("span diff warm failed", { err: error });
  }
}

async function fetchDiff(
  deps: ReadDiffDeps,
  access: PullRequestAccess,
  repo: RepositoryRef,
  query: DiffQuery,
  cacheKey: string,
): Promise<DiffRead> {
  const span = {
    base: query.base,
    head: query.head,
    deadlineMs: DIFF_FETCH_DEADLINE_MS,
  };
  const diff = await access.github.forRepo(repo).fetchCheckedCompareDiff(span);
  if (!diff.ok) {
    const error = diff.error;
    return { ok: false, error: { kind: FailureKinds.GITHUB_DENIED, error } };
  }

  const lifetime = resolveDiffLifetime(query);
  const viewer = access.session.sessionTokenHash;
  cacheDiff(deps, viewer, cacheKey, diff.value, lifetime);
  return diff;
}

interface SpanDiffTarget {
  readonly repo: RepositoryRef;
  readonly refs: PrSpanRefs;
  readonly cacheKey: string;
}

/**
 * A failed span read answers with the GitHub failure behind it, so a render
 * timeout reads as one. Too large with none is the span's own file or line
 * bound; a transient failure with none came from the line-diff runner, whose
 * thread stopped, and answers as a timeout.
 */
function resolveSpanFailure(
  failure: PrSpanFailure,
  span: ApiPrSpanSource,
): DiffRead {
  const error = span.readFailure(failure.kind);
  if (error !== undefined) {
    return { ok: false, error: { kind: FailureKinds.GITHUB_DENIED, error } };
  }
  if (failure.kind === PrSpanFailureKinds.TOO_LARGE) {
    return SPAN_TOO_LARGE;
  }
  if (failure.kind === PrSpanFailureKinds.TRANSIENT) {
    return PAST_DEADLINE;
  }
  return NOT_FOUND;
}

/**
 * The revision span the pair's marks row certifies, read under one deadline
 * every sub-call shares. The deadline, or a stopped span thread,
 * answers every waiter as a timeout.
 */
async function fetchSpanDiff(
  deps: ReadDiffDeps,
  access: PullRequestAccess,
  target: SpanDiffTarget,
): Promise<DiffRead> {
  const deadline = AbortSignal.timeout(DIFF_FETCH_DEADLINE_MS);
  const deadlineAt = Date.now() + DIFF_FETCH_DEADLINE_MS;
  const reader = access.github.forRepo(target.repo);
  const span = buildApiPrSpanSource(reader, deadlineAt);
  let read: PrSpanResult;
  try {
    read = await readPrSpan(
      span.source,
      target.refs,
      deadline,
      deps.spanRunner,
    );
  } catch (error) {
    if (deadline.aborted) {
      return PAST_DEADLINE;
    }
    throw error;
  }
  if (!read.ok) {
    return resolveSpanFailure(read.error, span);
  }

  const diff = read.value.filteredDiff;
  const viewer = access.session.sessionTokenHash;
  cacheDiff(deps, viewer, target.cacheKey, diff, DiffLifetimes.SHA_PINNED);
  return { ok: true, value: diff };
}

/** Both refs full SHAs: GitHub can never answer that span differently. */
function resolveDiffLifetime(query: DiffQuery): DiffLifetime {
  const pinned =
    commitShaSchema.safeParse(query.base).success &&
    commitShaSchema.safeParse(query.head).success;
  return pinned ? DiffLifetimes.SHA_PINNED : DiffLifetimes.LIVE;
}

/** A diff the small cache refuses goes to the large-diff cache, and only
 * when both refs are commit SHAs: a branch ref's diff moves on push, and that
 * cache outlives the debounce. */
function cacheDiff(
  deps: ReadDiffDeps,
  viewer: string,
  cacheKey: string,
  diff: string,
  lifetime: DiffLifetime,
): void {
  const storedAt = Date.now();
  const bytes = measureHeldBytes(diff);
  const heldBySpanCache = deps.diffCache.set(
    cacheKey,
    diff,
    bytes,
    storedAt,
    lifetime,
  );
  if (heldBySpanCache) {
    return;
  }
  if (lifetime === DiffLifetimes.SHA_PINNED) {
    deps.largeDiffCache.set(viewer, cacheKey, diff, bytes, storedAt);
  }
}
