import { describe, expect, it } from "vitest";
import { bindInstallationGitHub } from "../../src/client/installation";
import { bindOperatorGitHub } from "../../src/client/operator";
import { bindReviewerGitHub } from "../../src/client/reviewer";
import type { AccountReader } from "../../src/client/types";
import { GitHubApiErrorCodes } from "../../src/errors";
import {
  MINT_OK,
  MINT_PATH,
  makeApp,
  makeLogger,
  makeOctokitFactory,
  requireInstallationId,
  requireOperatorToken,
  stubCredential,
  stubGitHubFetch,
  type GitHubFetchStub,
  type StubResponse,
} from "./helpers";

const ISSUE = { owner: "acme", repo: "widgets", number: 12 };
const ISSUE_PATH = "/repos/acme/widgets/issues/12";
const DESTINATION_PATH = "/repositories/555/issues/12";

const TRANSFERRED: StubResponse = {
  status: 301,
  body: {
    message: "Moved Permanently",
    url: `https://api.github.com${DESTINATION_PATH}`,
  },
  headers: { location: `https://api.github.com${DESTINATION_PATH}` },
};

const DESTINATION_BODY = "private tracker text";

function makeIssueBody(body: string): unknown {
  return {
    title: "Ship widgets",
    state: "open",
    state_reason: null,
    labels: [],
    milestone: null,
    body,
  };
}

function routeIssueRead(issueAnswer: StubResponse) {
  return stubGitHubFetch((request) => {
    if (request.path === MINT_PATH) {
      return MINT_OK;
    }
    if (request.path === ISSUE_PATH) {
      return issueAnswer;
    }
    return { status: 200, body: makeIssueBody(DESTINATION_BODY) };
  });
}

interface IssueBinding {
  readonly name: string;
  bind(stub: GitHubFetchStub): AccountReader;
}

const BINDINGS: readonly IssueBinding[] = [
  {
    name: "installation",
    bind: (stub) =>
      bindInstallationGitHub(makeApp(stub), requireInstallationId(99n)),
  },
  {
    name: "reviewer",
    bind: (stub) =>
      bindReviewerGitHub(stubCredential("ghu_viewer", undefined), {
        log: makeLogger(),
        octokitFactory: makeOctokitFactory(stub),
      }),
  },
  {
    name: "operator",
    bind: (stub) =>
      bindOperatorGitHub(requireOperatorToken("ghp_operator"), {
        octokitFactory: makeOctokitFactory(stub),
      }),
  },
];

describe.each(BINDINGS)("fetchIssue on the $name binding", (binding) => {
  it("refuses a transferred issue without reading its new home", async () => {
    const stub = routeIssueRead(TRANSFERRED);

    const result = await binding.bind(stub).fetchIssue(ISSUE);

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(JSON.stringify(result)).not.toContain(DESTINATION_BODY);
    const paths = stub.requests.map((request) => request.path);
    expect(paths).not.toContain(DESTINATION_PATH);
  });

  it("reads an issue that has not moved", async () => {
    const stub = routeIssueRead({
      status: 200,
      body: makeIssueBody("Details"),
    });

    const result = await binding.bind(stub).fetchIssue(ISSUE);

    expect(result.ok && result.value.body).toBe("Details");
  });
});
