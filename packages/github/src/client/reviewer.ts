import type { Octokit } from "octokit";
import type { Result } from "types/utils";
import { createUserOctokit, fetchUserInstallations } from "../auth/oauth";
import type { GitHubApiError } from "../errors";
import type { RepositoryRef } from "../operations/pull-request/types";
import { listInstallationRepositoriesForUser } from "../operations/repo";
import { buildAccountReader } from "./account-reader";
import { CREATE_OCTOKIT_OPTIONS } from "./consts";
import {
  createRepoReadRunner,
  selectOperatorFallback,
} from "./operator-fallback";
import { buildReviewerRepoClient } from "./reviewer-repo";
import type {
  CallRunner,
  CredentialFailure,
  GitHubCall,
  ReviewerBindingOptions,
  ReviewerCredential,
  ReviewerGitHub,
  ReviewerRepoClient,
  ReviewerRunners,
} from "./types";
import { isUnauthorized } from "./utils";

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

function createTokenRunner(
  state: TokenState,
  buildClient: (token: string) => Octokit,
): CallRunner {
  return (call) =>
    runOnReviewerToken(state, (token) => call(buildClient(token)));
}

/**
 * The reviewer's GitHub, for one request or job. Writes run on the reviewer's
 * token only; `operatorReads` adds the operator token as a second try for a
 * denied read within that one pull request's reach.
 */
export function bindReviewerGitHub(
  credential: ReviewerCredential,
  options: ReviewerBindingOptions,
): ReviewerGitHub {
  const createOctokit = options.octokitFactory ?? createUserOctokit;
  const state = createTokenState(credential);
  const own = createTokenRunner(state, (token) => createOctokit(token));
  const create = createTokenRunner(state, (token) =>
    createOctokit(token, CREATE_OCTOKIT_OPTIONS),
  );

  function forRepo(repo: RepositoryRef): ReviewerRepoClient {
    const fallback = selectOperatorFallback(
      options.operatorReads,
      repo,
      options.log,
    );
    const runners: ReviewerRunners = {
      read: createRepoReadRunner(own, createOctokit, fallback),
      own,
      create,
    };
    return buildReviewerRepoClient(repo, runners);
  }

  return {
    ...buildAccountReader(own),
    forRepo,
    listUserInstallations() {
      return own(
        (octokit) => fetchUserInstallations(octokit),
        "list user installations",
      );
    },
    listInstallationRepositories(installationId) {
      return own(
        (octokit) =>
          listInstallationRepositoriesForUser(octokit, installationId),
        "list installation repositories",
      );
    },
  };
}
