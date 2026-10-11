import type { Logger } from "logging";
import type { Result } from "types/utils";
import { createUserOctokit, type UserOctokitFactory } from "../auth/oauth";
import { GitHubApiErrorCodes, type GitHubApiError } from "../errors";
import { createInlineReviewComment } from "../operations/inline-comment";
import type { RepositoryRef } from "../operations/pull-request/types";
import { fetchRepositoryById } from "../operations/repo";
import { CREATE_OCTOKIT_OPTIONS } from "./consts";
import { buildRepoReader } from "./repo-reader";
import type {
  CallRunner,
  CredentialFailure,
  GitHubCall,
  GitHubCallFailure,
  OperatorReads,
  OperatorToken,
  ReviewerBindingOptions,
  ReviewerCredential,
  ReviewerGitHub,
  ReviewerRepoClient,
} from "./types";

interface TokenState {
  current(): Promise<Result<string, CredentialFailure>>;
  renewPast(rejected: string): Promise<string | undefined>;
}

/**
 * The renewal is memoized in flight and never re-spent, so concurrent callers
 * that hit a 401 share one rotation.
 */
function createTokenState(credential: ReviewerCredential): TokenState {
  let read: Promise<Result<string, CredentialFailure>> | undefined;
  let renewal: Promise<string | undefined> | undefined;

  return {
    current() {
      read ??= credential.readToken();
      return read;
    },
    async renewPast(rejected) {
      renewal ??= credential.renewToken(rejected);
      const renewed = await renewal;
      if (renewed !== undefined) {
        read = Promise.resolve({ ok: true, value: renewed });
      }
      return renewed;
    },
  };
}

function isUnauthorized(result: Result<unknown, GitHubApiError>): boolean {
  return !result.ok && result.error.code === GitHubApiErrorCodes.UNAUTHORIZED;
}

function isDenial(error: GitHubCallFailure): boolean {
  return (
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.FORBIDDEN
  );
}

async function runOnReviewerToken<Value>(
  state: TokenState,
  call: (token: string) => Promise<Result<Value, GitHubApiError>>,
): GitHubCall<Value> {
  const token = await state.current();
  if (!token.ok) {
    return { ok: false, error: token.error };
  }

  const first = await call(token.value);
  if (!isUnauthorized(first)) {
    return first;
  }

  const renewed = await state.renewPast(token.value);
  // A 401 on the rotated token itself gets no second rotation.
  const rotatedPastCall = renewed !== undefined && renewed !== token.value;
  if (!rotatedPastCall) {
    return first;
  }
  return call(renewed);
}

function isSameRepository(left: RepositoryRef, right: RepositoryRef): boolean {
  const sameOwner = left.owner.toLowerCase() === right.owner.toLowerCase();
  return sameOwner && left.repo.toLowerCase() === right.repo.toLowerCase();
}

function selectOperatorToken(
  operatorReads: OperatorReads | undefined,
  repo: RepositoryRef,
): OperatorToken | undefined {
  if (operatorReads === undefined) {
    return undefined;
  }
  return isSameRepository(operatorReads.repo, repo)
    ? operatorReads.token
    : undefined;
}

interface OperatorFallback {
  readonly token: OperatorToken;
  readonly repo: RepositoryRef;
  readonly log: Logger;
}

function createRepoReadRunner(
  state: TokenState,
  createOctokit: UserOctokitFactory,
  fallback: OperatorFallback | undefined,
): CallRunner {
  return async (call) => {
    const own = await runOnReviewerToken(state, (token) =>
      call(createOctokit(token)),
    );
    if (fallback === undefined || own.ok || !isDenial(own.error)) {
      return own;
    }

    const operator = await call(createOctokit(fallback.token));
    if (!isUnauthorized(operator)) {
      return operator;
    }
    // The operator's own key is what GitHub rejected; its 401 would send the
    // reviewer to sign in again, which cannot repair it.
    fallback.log.warn("operator token rejected by GitHub", {
      owner: fallback.repo.owner,
      repo: fallback.repo.repo,
    });
    return own;
  };
}

/**
 * The reviewer's GitHub, for one request or job. Writes run on the reviewer's
 * token only; `operatorReads` adds the operator token as a second try for a
 * denied read of that one repository.
 */
export function bindReviewerGitHub(
  credential: ReviewerCredential,
  options: ReviewerBindingOptions,
): ReviewerGitHub {
  const createOctokit = options.octokitFactory ?? createUserOctokit;
  const state = createTokenState(credential);

  function forRepo(repo: RepositoryRef): ReviewerRepoClient {
    const operatorToken = selectOperatorToken(options.operatorReads, repo);
    let fallback: OperatorFallback | undefined;
    if (operatorToken !== undefined) {
      fallback = { token: operatorToken, repo, log: options.log };
    }
    const read = createRepoReadRunner(state, createOctokit, fallback);

    return {
      ...buildRepoReader(repo, read),
      createInlineReviewComment(input) {
        return runOnReviewerToken(state, (token) =>
          createInlineReviewComment(
            createOctokit(token, CREATE_OCTOKIT_OPTIONS),
            { ...input, ...repo },
          ),
        );
      },
    };
  }

  return {
    forRepo,
    fetchRepositoryById(repoId) {
      return runOnReviewerToken(state, (token) =>
        fetchRepositoryById(createOctokit(token), repoId),
      );
    },
  };
}
