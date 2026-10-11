import type { Octokit } from "octokit";
import { createUserOctokit, fetchUserInstallations } from "../auth/oauth";
import type { RepositoryRef } from "../operations/pull-request/types";
import { listInstallationRepositoriesForUser } from "../operations/repo";
import { buildAccountReader } from "./account-reader";
import { CREATE_OCTOKIT_OPTIONS } from "./consts";
import {
  createRepoReadRunner,
  selectOperatorFallback,
} from "./operator-fallback";
import { buildReviewerRepoClient } from "./reviewer-repo";
import {
  createTokenState,
  runOnReviewerToken,
  type TokenState,
} from "./reviewer-token";
import type {
  CallRunner,
  ReviewerBindingOptions,
  ReviewerCredential,
  ReviewerGitHub,
  ReviewerRepoClient,
  ReviewerRunners,
} from "./types";

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
