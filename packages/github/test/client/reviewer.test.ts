import { describe, expect, it, vi } from "vitest";
import { bindReviewerGitHub } from "../../src/client/reviewer";
import { GitHubApiErrorCodes } from "../../src/errors";
import { RenewalFailureCodes } from "../../src/client/types";
import { ReviewCommentSides } from "types/conversation";
import { ReviewSubjectTypes } from "../../src/operations/review-thread";
import {
  OLD_TOKEN,
  PULL,
  REPO,
  UNAUTHORIZED,
  answerByToken,
  formatTokenAuthorization,
  makeLogger,
  makeOctokitFactory,
  requireRepoId,
  stubCredential,
  stubGitHubFetch,
} from "./helpers";

const NEW_TOKEN = "ghu_new";
const PR_PATH = "/repos/acme/widgets/pulls/7";

const REPO_ID = requireRepoId(4242n);

describe("bindReviewerGitHub token renewal", () => {
  it("renews once for concurrent 401s and re-runs each call", async () => {
    const stub = stubGitHubFetch(
      answerByToken({ [OLD_TOKEN]: UNAUTHORIZED, [NEW_TOKEN]: PULL }),
    );
    const credential = stubCredential(OLD_TOKEN, NEW_TOKEN);
    const repo = bindReviewerGitHub(credential, {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    }).forRepo(REPO);

    const [first, second] = await Promise.all([
      repo.fetchPullRequest(7),
      repo.fetchPullRequest(7),
    ]);

    expect(first.ok && first.value.headSha).toBe("b".repeat(40));
    expect(second.ok && second.value.headSha).toBe("b".repeat(40));
    expect(credential.readToken).toHaveBeenCalledTimes(1);
    expect(credential.renewToken).toHaveBeenCalledTimes(1);
    expect(credential.renewToken).toHaveBeenCalledWith(OLD_TOKEN);
  });

  it("re-runs a stale-token call on the token already renewed", async () => {
    const stub = stubGitHubFetch(
      answerByToken({ [OLD_TOKEN]: UNAUTHORIZED, [NEW_TOKEN]: PULL }),
    );
    const credential = stubCredential(OLD_TOKEN, NEW_TOKEN);
    const github = bindReviewerGitHub(credential, {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    });

    await github.forRepo(REPO).fetchPullRequest(7);
    const later = await github.forRepo(REPO).fetchPullRequest(7);

    expect(later.ok).toBe(true);
    expect(credential.renewToken).toHaveBeenCalledTimes(1);
    expect(stub.requests.map((request) => request.authorization)).toEqual([
      formatTokenAuthorization(OLD_TOKEN),
      formatTokenAuthorization(NEW_TOKEN),
      formatTokenAuthorization(NEW_TOKEN),
    ]);
  });

  it("answers the 401 once a renewed token is rejected too", async () => {
    const stub = stubGitHubFetch(() => UNAUTHORIZED);
    const credential = stubCredential(OLD_TOKEN, NEW_TOKEN);
    const github = bindReviewerGitHub(credential, {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    });

    const first = await github.forRepo(REPO).fetchPullRequest(7);
    const second = await github.forRepo(REPO).fetchPullRequest(7);

    expect(first.ok || first.error.code).toBe(GitHubApiErrorCodes.UNAUTHORIZED);
    expect(second.ok || second.error.code).toBe(
      GitHubApiErrorCodes.UNAUTHORIZED,
    );
    expect(credential.renewToken).toHaveBeenCalledTimes(1);
    expect(stub.requests).toHaveLength(3);
  });

  it("answers the 401 when the credential cannot renew", async () => {
    const stub = stubGitHubFetch(() => UNAUTHORIZED);
    const credential = stubCredential(OLD_TOKEN, undefined);
    const github = bindReviewerGitHub(credential, {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    });

    const result = await github.fetchRepositoryById(REPO_ID);

    expect(result.ok || result.error.code).toBe(
      GitHubApiErrorCodes.UNAUTHORIZED,
    );
    expect(stub.requests).toHaveLength(1);
  });

  it("answers request-failed when GitHub cannot be reached to renew", async () => {
    const stub = stubGitHubFetch(() => UNAUTHORIZED);
    const credential = stubCredential(OLD_TOKEN, {
      code: RenewalFailureCodes.UNAVAILABLE,
    });
    const github = bindReviewerGitHub(credential, {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    });

    const result = await github.forRepo(REPO).fetchPullRequest(7);

    expect(result.ok || result.error.code).toBe(
      GitHubApiErrorCodes.REQUEST_FAILED,
    );
    expect(stub.requests).toHaveLength(1);
  });

  it("fetches the pull request at the bound repository path", async () => {
    const stub = stubGitHubFetch(() => PULL);
    const github = bindReviewerGitHub(stubCredential(OLD_TOKEN, undefined), {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    });

    await github.forRepo(REPO).fetchPullRequest(7);

    expect(stub.requests[0]?.path).toBe(PR_PATH);
  });
});

describe("bindReviewerGitHub creates", () => {
  it("sends a create once when GitHub answers a 5xx", async () => {
    const stub = stubGitHubFetch(() => ({
      status: 502,
      body: { message: "Bad Gateway" },
    }));
    const github = bindReviewerGitHub(stubCredential(OLD_TOKEN, undefined), {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    });

    const result = await github.forRepo(REPO).createInlineReviewComment({
      prNumber: 7,
      commitId: "b".repeat(40),
      path: "src/index.ts",
      line: 3,
      side: ReviewCommentSides.RIGHT,
      body: "why",
    });

    expect(result.ok).toBe(false);
    expect(stub.requests).toEqual([
      {
        method: "POST",
        path: "/repos/acme/widgets/pulls/7/comments",
        authorization: formatTokenAuthorization(OLD_TOKEN),
      },
    ]);
  });

  it("builds the create client with retry off and the rate-limit cap", async () => {
    const stub = stubGitHubFetch(() => ({
      status: 201,
      body: { id: 901, pull_request_review_id: 77 },
    }));
    const factory = vi.fn(makeOctokitFactory(stub));
    const github = bindReviewerGitHub(stubCredential(OLD_TOKEN, undefined), {
      log: makeLogger(),
      octokitFactory: factory,
    });

    await github.forRepo(REPO).createInlineReviewComment({
      prNumber: 7,
      commitId: "b".repeat(40),
      path: "src/index.ts",
      subjectType: ReviewSubjectTypes.FILE,
      body: "why",
    });

    expect(factory).toHaveBeenCalledWith(OLD_TOKEN, {
      retry: false,
      maxRetryAfterSeconds: 20,
    });
  });
});
