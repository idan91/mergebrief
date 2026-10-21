import { describe, expect, it, vi } from "vitest";
import { bindReviewerGitHub } from "../../src/client/reviewer";
import { GitHubApiErrorCodes } from "../../src/errors";
import {
  NOT_FOUND,
  OLD_TOKEN,
  OPERATOR_TOKEN,
  PULL,
  REPO,
  UNAUTHORIZED,
  answerByToken,
  formatTokenAuthorization,
  makeLogger,
  makeOctokitFactory,
  requireOperatorToken,
  requireRepoId,
  stubCredential,
  stubGitHubFetch,
  type GitHubFetchStub,
  type StubResponse,
} from "./helpers";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const UNKNOWN_SHA = "c".repeat(40);
const DIFF = { status: 200, body: "diff --git a/src/a.ts b/src/a.ts\n" };
const FORBIDDEN = { status: 403, body: { message: "denied" } };

async function loadPassedCommits(): Promise<ReadonlySet<string>> {
  return new Set([BASE_SHA, HEAD_SHA]);
}

function bindWithOperator(
  stub: GitHubFetchStub,
  loadKnownCommits = loadPassedCommits,
) {
  const log = makeLogger();
  const github = bindReviewerGitHub(stubCredential(OLD_TOKEN, undefined), {
    log,
    octokitFactory: makeOctokitFactory(stub),
    operatorReads: {
      token: requireOperatorToken(OPERATOR_TOKEN),
      repo: REPO,
      prNumber: 7,
      loadKnownCommits,
    },
  });
  return { github, log };
}

function stubDeniedReviewer(
  operatorAnswer: StubResponse,
  reviewerDenial: StubResponse = NOT_FOUND,
): GitHubFetchStub {
  return stubGitHubFetch(
    answerByToken({
      [OLD_TOKEN]: reviewerDenial,
      [OPERATOR_TOKEN]: operatorAnswer,
    }),
  );
}

function listAuthorizations(stub: GitHubFetchStub): (string | undefined)[] {
  return stub.requests.map((request) => request.authorization);
}

const REVIEWER_ONLY = [formatTokenAuthorization(OLD_TOKEN)];
const REVIEWER_THEN_OPERATOR = [
  formatTokenAuthorization(OLD_TOKEN),
  formatTokenAuthorization(OPERATOR_TOKEN),
];

describe("bindReviewerGitHub operator reads", () => {
  it.each([403, 404])(
    "reads on the operator token after a %i",
    async (status) => {
      const stub = stubGitHubFetch(
        answerByToken({
          [OLD_TOKEN]: { status, body: { message: "denied" } },
          [OPERATOR_TOKEN]: PULL,
        }),
      );
      const { github } = bindWithOperator(stub);

      const result = await github.forRepo(REPO).fetchPullRequest(7);

      expect(result.ok && result.value.repoFullName).toBe("acme/widgets");
      expect(listAuthorizations(stub)).toEqual(REVIEWER_THEN_OPERATOR);
    },
  );

  it("answers the reviewer's denial when the operator token gets a 401", async () => {
    const stub = stubDeniedReviewer(UNAUTHORIZED);
    const { github, log } = bindWithOperator(stub);

    const result = await github.forRepo(REPO).fetchPullRequest(7);

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure that is not a denial off the operator token", async () => {
    const stub = stubDeniedReviewer(PULL, {
      status: 422,
      body: { message: "unprocessable" },
    });
    const { github } = bindWithOperator(stub);

    const result = await github.forRepo(REPO).fetchPullRequest(7);

    expect(result.ok).toBe(false);
    expect(listAuthorizations(stub)).not.toContain(
      formatTokenAuthorization(OPERATOR_TOKEN),
    );
  });

  it("matches the operator repository ignoring case", async () => {
    const stub = stubDeniedReviewer(PULL);
    const { github } = bindWithOperator(stub);

    const result = await github
      .forRepo({ owner: "Acme", repo: "Widgets" })
      .fetchPullRequest(7);

    expect(result.ok).toBe(true);
  });

  it("keeps account reads on the reviewer's token", async () => {
    const stub = stubDeniedReviewer(PULL);
    const { github } = bindWithOperator(stub);

    const result = await github.fetchRepositoryById(requireRepoId(4242n));

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(listAuthorizations(stub)).toEqual(REVIEWER_ONLY);
  });
});

describe("bindReviewerGitHub operator reach", () => {
  it.each([
    ["an unknown commit", UNKNOWN_SHA],
    ["a short sha", HEAD_SHA.slice(0, 7)],
    ["a branch name", "feature"],
  ])("refuses a compare whose head is %s", async (_, head) => {
    const stub = stubDeniedReviewer(DIFF);
    const { github } = bindWithOperator(stub);

    const result = await github
      .forRepo(REPO)
      .fetchCompareDiff({ base: BASE_SHA, head });

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(listAuthorizations(stub)).toEqual(REVIEWER_ONLY);
  });

  it("loads the known commits only for a denied read at commits", async () => {
    const stub = stubDeniedReviewer(PULL);
    const loadKnownCommits = vi.fn(loadPassedCommits);
    const { github } = bindWithOperator(stub, loadKnownCommits);

    await github.forRepo(REPO).fetchPullRequest(7);
    expect(loadKnownCommits).not.toHaveBeenCalled();

    await github
      .forRepo(REPO)
      .fetchCompareDiff({ base: BASE_SHA, head: HEAD_SHA });
    expect(loadKnownCommits).toHaveBeenCalledTimes(1);
  });

  it("refuses a repo file read at a short sha ref", async () => {
    const stub = stubDeniedReviewer(NOT_FOUND, FORBIDDEN);
    const { github } = bindWithOperator(stub);

    const result = await github.forRepo(REPO).fetchRepoFile({
      path: "src/a.ts",
      maxBytes: 1024,
      ref: HEAD_SHA.slice(0, 7),
    });

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.FORBIDDEN);
    expect(listAuthorizations(stub)).toEqual(REVIEWER_ONLY);
  });
});
