import { describe, expect, it } from "vitest";
import { bindOperatorGitHub, isOperatorToken } from "../../src/client/operator";
import { GitHubApiErrorCodes } from "../../src/errors";
import {
  REPO,
  formatTokenAuthorization,
  makeOctokitFactory,
  makeRepositoryBody,
  requireOperatorToken,
  requireRepoId,
  stubGitHubFetch,
} from "./helpers";

const OPERATOR = "ghp_operator";

describe("bindOperatorGitHub", () => {
  it("reads a repository by id on the operator token", async () => {
    const stub = stubGitHubFetch(() => ({
      status: 200,
      body: makeRepositoryBody("acme/widgets"),
    }));
    const github = bindOperatorGitHub(requireOperatorToken(OPERATOR), {
      octokitFactory: makeOctokitFactory(stub),
    });

    const result = await github.fetchRepositoryById(requireRepoId(4242n));

    expect(result.ok && result.value.fullName).toBe("acme/widgets");
    expect(stub.requests[0]?.authorization).toBe(
      formatTokenAuthorization(OPERATOR),
    );
  });

  it("reads a pull request and answers its refusal as is", async () => {
    const stub = stubGitHubFetch(() => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    const github = bindOperatorGitHub(requireOperatorToken(OPERATOR), {
      octokitFactory: makeOctokitFactory(stub),
    });

    const result = await github.forRepo(REPO).fetchPullRequest(7);

    expect(result.ok || result.error.code).toBe(
      GitHubApiErrorCodes.UNAUTHORIZED,
    );
    expect(stub.requests).toHaveLength(1);
  });

  it("refuses an empty operator token", () => {
    expect(isOperatorToken("")).toBe(false);
    expect(isOperatorToken(OPERATOR)).toBe(true);
  });
});
