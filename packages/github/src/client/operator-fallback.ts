import type { Logger } from "logging";
import type { UserOctokitFactory } from "../auth/oauth";
import { GitHubApiErrorCodes } from "../errors";
import type { RepositoryRef } from "../operations/pull-request/types";
import type {
  CallRunner,
  GitHubCallFailure,
  OperatorReads,
  ReadReach,
  RepoReadRunner,
} from "./types";
import { isUnauthorized } from "./utils";

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;

export interface OperatorFallback {
  readonly reads: OperatorReads;
  readonly log: Logger;
}

function isSameRepository(left: RepositoryRef, right: RepositoryRef): boolean {
  const sameOwner = left.owner.toLowerCase() === right.owner.toLowerCase();
  return sameOwner && left.repo.toLowerCase() === right.repo.toLowerCase();
}

/** The fallback for `repo`, absent unless the gate passed this repository. */
export function selectOperatorFallback(
  reads: OperatorReads | undefined,
  repo: RepositoryRef,
  log: Logger,
): OperatorFallback | undefined {
  if (reads === undefined || !isSameRepository(reads.repo, repo)) {
    return undefined;
  }
  return { reads, log };
}

function isFullCommitSha(commit: string | undefined): commit is string {
  return commit !== undefined && FULL_COMMIT_SHA.test(commit);
}

/** Fails closed: an empty commit list or an absent commit is out of reach. */
export async function isWithinReach(
  reads: OperatorReads,
  reach: ReadReach,
): Promise<boolean> {
  if ("prNumber" in reach) {
    return reach.prNumber === reads.prNumber;
  }
  const commits = reach.commits;
  if (commits.length === 0 || !commits.every(isFullCommitSha)) {
    return false;
  }
  const known = await reads.loadKnownCommits();
  return commits.every((commit) => known.has(commit));
}

export function isDenial(error: GitHubCallFailure): boolean {
  return (
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.FORBIDDEN
  );
}

/** Reads on `own`; a denied read in reach retries on the operator token. */
export function createRepoReadRunner(
  own: CallRunner,
  createOctokit: UserOctokitFactory,
  fallback: OperatorFallback | undefined,
): RepoReadRunner {
  return async (call, context, reach) => {
    const ownResult = await own(call, context);
    if (fallback === undefined || ownResult.ok || !isDenial(ownResult.error)) {
      return ownResult;
    }
    const inReach = await isWithinReach(fallback.reads, reach);
    if (!inReach) {
      return ownResult;
    }

    const operator = await call(createOctokit(fallback.reads.token));
    if (!isUnauthorized(operator)) {
      return operator;
    }
    // The operator's own key is what GitHub rejected; its 401 would send the
    // reviewer to sign in again, which cannot repair it.
    fallback.log.warn("operator token rejected by GitHub", {
      owner: fallback.reads.repo.owner,
      repo: fallback.reads.repo.repo,
    });
    return ownResult;
  };
}
