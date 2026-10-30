import {
  resolvePrStack,
  type OpenPullRequest,
  type PrStackSelf,
} from "brief-core/pr-stack";
import type { PullStackView } from "contract";
import type { GitHubCallFailure, ReviewerRepoClient } from "github";
import { createTenantRepository } from "persistence";
import type { Result } from "types/utils";
import {
  AccessFootings,
  type PullRequestAccess,
} from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { buildOpenPullsCacheKey } from "../../../open-pulls-cache";
import { parseOwnerAndName } from "../../utils";
import { PR_STACK_OPEN_PULLS_CACHE_TTL_MS } from "./consts";
import {
  recordResolvedStack,
  shapeFetchedSelf,
  shapeRecordedStack,
  shapeStoredStack,
} from "./logic/last-stack";
import { shapeLiveStack } from "./logic/live-stack";
import type { ReadStackDeps, StackFailure } from "./types";

interface StackSelfRead {
  readonly self: PrStackSelf;
  /** GitHub's answer, not the row's state: a lost webhook leaves a row open. */
  readonly open: boolean;
  readonly draft: boolean;
}

function wrapDenied(error: GitHubCallFailure) {
  return {
    ok: false,
    error: { kind: FailureKinds.GITHUB_DENIED, error },
  } as const;
}

/** One list per session and repo inside the TTL, so a stack walk costs one. */
async function listOpenPulls(
  deps: ReadStackDeps,
  access: PullRequestAccess,
  reader: ReviewerRepoClient,
  now: number,
): Promise<Result<readonly OpenPullRequest[], StackFailure>> {
  const cacheKey = buildOpenPullsCacheKey({
    sessionTokenHash: access.session.sessionTokenHash,
    repoId: access.repoId,
  });
  const cached = deps.openPullsCache.get(cacheKey, now);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }

  const listed = await reader.listOpenPullRequests();
  if (!listed.ok) {
    return wrapDenied(listed.error);
  }
  const expiresAt = now + PR_STACK_OPEN_PULLS_CACHE_TTL_MS;
  deps.openPullsCache.set(cacheKey, listed.value, expiresAt, now);
  return listed;
}

/** The PR's own refs: from the open list, else one fetch for a closed PR or one the list predates. */
async function resolveStackSelf(
  reader: ReviewerRepoClient,
  prNumber: number,
  open: readonly OpenPullRequest[],
): Promise<Result<StackSelfRead, StackFailure>> {
  const listed = open.find((item) => item.number === prNumber);
  if (listed !== undefined) {
    return {
      ok: true,
      value: { self: listed, open: true, draft: listed.draft },
    };
  }

  const fetched = await reader.fetchPullRequest(prNumber);
  if (!fetched.ok) {
    return wrapDenied(fetched.error);
  }
  return {
    ok: true,
    value: {
      self: shapeFetchedSelf(prNumber, fetched.value),
      open: fetched.value.state === "open",
      draft: fetched.value.draft,
    },
  };
}

/**
 * The PR's stack as GitHub has it now, on the viewer's binding. A resolve is
 * folded into the row's record: an open PR serves the live resolve with each
 * member's state and branch, a closed one the record. An operator pass gets
 * no stack and no GitHub call: the open list names every PR in a repository
 * the reader cannot see.
 */
export async function readStack(
  deps: ReadStackDeps,
  access: PullRequestAccess,
): Promise<Result<PullStackView, StackFailure>> {
  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return { ok: false, error: { kind: "not-found" } };
  }
  if (access.footing === AccessFootings.OPERATOR) {
    return { ok: true, value: { stack: null } };
  }

  const reader = access.github.forRepo(repo);
  const now = Date.now();
  const open = await listOpenPulls(deps, access, reader, now);
  if (!open.ok) {
    return open;
  }
  const selfRead = await resolveStackSelf(reader, access.prNumber, open.value);
  if (!selfRead.ok) {
    return selfRead;
  }

  const { self, open: selfOpen, draft } = selfRead.value;
  const stack = resolvePrStack(self, open.value);
  if (stack === undefined) {
    return { ok: true, value: shapeStoredStack(access.row, selfOpen) };
  }
  const tenant = createTenantRepository(deps.handle, access.rowScope);
  const recordDeps = { tenant, log: deps.log };
  const record = await recordResolvedStack(
    recordDeps,
    access.row,
    stack,
    new Date(now),
  );
  if (selfOpen) {
    return {
      ok: true,
      value: shapeLiveStack(stack, { ...self, draft }, open.value),
    };
  }
  return { ok: true, value: shapeRecordedStack(record) };
}
