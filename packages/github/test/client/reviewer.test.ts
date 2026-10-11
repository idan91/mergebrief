import { describe, expect, it, vi } from "vitest";
import { bindReviewerGitHub } from "../../src/client/reviewer";
import { CredentialFailureCodes } from "../../src/client/types";
import { GitHubApiErrorCodes } from "../../src/errors";
import {
  ReviewCommentSides,
  ReviewSubjectTypes,
} from "../../src/operations/review-thread";
import {
  REPO,
  formatTokenAuthorization,
  makeLogger,
  makeOctokitFactory,
  makePullRequestBody,
  makeRepositoryBody,
  requireOperatorToken,
  requireRepoId,
  stubCredential,
  stubGitHubFetch,
  type RecordedRequest,
  type StubResponse,
} from "./helpers";

const OLD_TOKEN = "ghu_old";
const NEW_TOKEN = "ghu_new";
const OPERATOR = "ghp_operator";
const PR_PATH = "/repos/acme/widgets/pulls/7";

const REPO_ID = requireRepoId(4242n);

function answerByToken(
  answers: Readonly<Record<string, StubResponse>>,
): (request: RecordedRequest) => StubResponse {
  return (request) => {
    const token = request.authorization?.replace("token ", "") ?? "";
    return answers[token] ?? { status: 500, body: { message: "unrouted" } };
  };
}

const UNAUTHORIZED = { status: 401, body: { message: "Bad credentials" } };
const NOT_FOUND = { status: 404, body: { message: "Not Found" } };
const PULL = { status: 200, body: makePullRequestBody(7) };

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

  it("answers credential-unreadable without calling GitHub", async () => {
    const stub = stubGitHubFetch(() => PULL);
    const credential = stubCredential(OLD_TOKEN, NEW_TOKEN);
    credential.readToken.mockResolvedValue({
      ok: false,
      error: {
        code: CredentialFailureCodes.CREDENTIAL_UNREADABLE,
        message: "token unreadable",
      },
    });
    const github = bindReviewerGitHub(credential, {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    });

    const result = await github.forRepo(REPO).fetchPullRequest(7);

    expect(result.ok || result.error.code).toBe("credential-unreadable");
    expect(stub.requests).toHaveLength(0);
  });

  it("reads a repository by id on the reviewer's token", async () => {
    const stub = stubGitHubFetch(() => ({
      status: 200,
      body: makeRepositoryBody("acme/widgets"),
    }));
    const github = bindReviewerGitHub(stubCredential(OLD_TOKEN, undefined), {
      log: makeLogger(),
      octokitFactory: makeOctokitFactory(stub),
    });

    const result = await github.fetchRepositoryById(REPO_ID);

    expect(result).toEqual({
      ok: true,
      value: {
        repoId: 4242n,
        fullName: "acme/widgets",
        private: true,
        viewerCanPush: true,
        viewerIsAdmin: false,
      },
    });
    expect(stub.requests).toEqual([
      {
        method: "GET",
        path: "/repositories/4242",
        authorization: formatTokenAuthorization(OLD_TOKEN),
      },
    ]);
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

describe("bindReviewerGitHub operator reads", () => {
  function bindWithOperator(stub: ReturnType<typeof stubGitHubFetch>) {
    const log = makeLogger();
    const github = bindReviewerGitHub(stubCredential(OLD_TOKEN, undefined), {
      log,
      octokitFactory: makeOctokitFactory(stub),
      operatorReads: { token: requireOperatorToken(OPERATOR), repo: REPO },
    });
    return { github, log };
  }

  it.each([403, 404])(
    "reads on the operator token after a %i",
    async (status) => {
      const stub = stubGitHubFetch(
        answerByToken({
          [OLD_TOKEN]: { status, body: { message: "denied" } },
          [OPERATOR]: PULL,
        }),
      );
      const { github } = bindWithOperator(stub);

      const result = await github.forRepo(REPO).fetchPullRequest(7);

      expect(result.ok && result.value.repoFullName).toBe("acme/widgets");
      expect(stub.requests.map((request) => request.authorization)).toEqual([
        formatTokenAuthorization(OLD_TOKEN),
        formatTokenAuthorization(OPERATOR),
      ]);
    },
  );

  it("answers the reviewer's denial when the operator token gets a 401", async () => {
    const stub = stubGitHubFetch(
      answerByToken({ [OLD_TOKEN]: NOT_FOUND, [OPERATOR]: UNAUTHORIZED }),
    );
    const { github, log } = bindWithOperator(stub);

    const result = await github.forRepo(REPO).fetchPullRequest(7);

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("never reads another repository on the operator token", async () => {
    const stub = stubGitHubFetch(
      answerByToken({ [OLD_TOKEN]: NOT_FOUND, [OPERATOR]: PULL }),
    );
    const { github } = bindWithOperator(stub);

    const result = await github
      .forRepo({ owner: "acme", repo: "secrets" })
      .fetchPullRequest(7);

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(stub.requests).toHaveLength(1);
  });

  it("matches the operator repository ignoring case", async () => {
    const stub = stubGitHubFetch(
      answerByToken({ [OLD_TOKEN]: NOT_FOUND, [OPERATOR]: PULL }),
    );
    const { github } = bindWithOperator(stub);

    const result = await github
      .forRepo({ owner: "Acme", repo: "Widgets" })
      .fetchPullRequest(7);

    expect(result.ok).toBe(true);
  });

  it("never writes on the operator token", async () => {
    const stub = stubGitHubFetch(
      answerByToken({ [OLD_TOKEN]: NOT_FOUND, [OPERATOR]: PULL }),
    );
    const { github } = bindWithOperator(stub);

    const result = await github.forRepo(REPO).createInlineReviewComment({
      prNumber: 7,
      commitId: "b".repeat(40),
      path: "src/index.ts",
      line: 3,
      side: ReviewCommentSides.RIGHT,
      body: "why",
    });

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(stub.requests.map((request) => request.authorization)).toEqual([
      formatTokenAuthorization(OLD_TOKEN),
    ]);
  });

  it("keeps account reads on the reviewer's token", async () => {
    const stub = stubGitHubFetch(
      answerByToken({ [OLD_TOKEN]: NOT_FOUND, [OPERATOR]: PULL }),
    );
    const { github } = bindWithOperator(stub);

    const result = await github.fetchRepositoryById(REPO_ID);

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(stub.requests).toHaveLength(1);
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

  it("posts the comment on the repository the client is bound to", async () => {
    const stub = stubGitHubFetch(() => ({
      status: 201,
      body: { id: 901, pull_request_review_id: 77 },
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

    expect(result).toEqual({
      ok: true,
      value: { commentId: 901n, reviewId: 77n },
    });
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
