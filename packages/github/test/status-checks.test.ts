import { describe, expect, it } from "vitest";
import { bindInstallationGitHub } from "../src/client/installation";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  MINT_OK,
  MINT_PATH,
  REPO,
  makeApp,
  requireInstallationId,
  stubGitHubFetch,
  type RecordedRequest,
  type StubResponse,
} from "./client/helpers";

const HEAD = "a".repeat(40);
const CHECK_RUNS_PATH = `/repos/acme/widgets/commits/${HEAD}/check-runs`;
const STATUSES_PATH = `/repos/acme/widgets/commits/${HEAD}/statuses`;
const RULES_PATH = "/repos/acme/widgets/rules/branches/main";
const REVIEWS_PATH = "/repos/acme/widgets/pulls/7/reviews";
const SECOND_PAGE = "?page=2";

const FORBIDDEN: StubResponse = {
  status: 403,
  body: { message: "Resource not accessible by integration" },
};
const UPGRADE_REQUIRED: StubResponse = {
  status: 403,
  body: {
    message:
      "Upgrade to GitHub Pro or make this repository public to enable this feature.",
  },
};

/** Answers the mint, then each later request by its path and query. */
function stubPages(
  answer: (request: RecordedRequest) => StubResponse,
): ReturnType<typeof stubGitHubFetch> {
  return stubGitHubFetch((request) => {
    if (request.path === MINT_PATH) {
      return MINT_OK;
    }
    return answer(request);
  });
}

function bindRepo(stub: ReturnType<typeof stubGitHubFetch>) {
  const github = bindInstallationGitHub(
    makeApp(stub),
    requireInstallationId(99n),
  );
  return github.forRepo(REPO);
}

function linkNextPage(path: string): Readonly<Record<string, string>> {
  return {
    link: `<https://api.github.com${path}${SECOND_PAGE}>; rel="next"`,
  };
}

function listReadPaths(stub: ReturnType<typeof stubGitHubFetch>): string[] {
  const reads = stub.requests.filter((request) => request.path !== MINT_PATH);
  return reads.map((request) => `${request.path}${request.search}`);
}

const CLAUDE_RUN = {
  id: 9001,
  name: "Claude Code Review",
  status: "completed",
  conclusion: "neutral",
  app: { id: 1236702 },
  output: {
    title: "Code review found 2 issues",
    text: '<!-- bughunter-severity: {"nit":0,"normal":2,"pre_existing":0} -->',
  },
};
const QUEUED_RUN = {
  id: 9002,
  name: "build",
  status: "queued",
  conclusion: null,
  app: { id: 15368 },
  output: { title: null, text: null },
};

describe("listCheckRuns", () => {
  it("reads every run on the commit across pages, reruns included", async () => {
    const stub = stubPages((request) => {
      if (request.search.includes("page=2")) {
        return {
          status: 200,
          body: { total_count: 2, check_runs: [QUEUED_RUN] },
        };
      }
      return {
        status: 200,
        body: { total_count: 2, check_runs: [CLAUDE_RUN] },
        headers: linkNextPage(CHECK_RUNS_PATH),
      };
    });

    const result = await bindRepo(stub).listCheckRuns(HEAD);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          checkRunId: 9001n,
          name: "Claude Code Review",
          appId: 1236702n,
          completed: true,
          conclusion: "neutral",
          title: "Code review found 2 issues",
          text: CLAUDE_RUN.output.text,
        },
        { checkRunId: 9002n, name: "build", appId: 15368n, completed: false },
      ],
    });
    const [firstPage] = listReadPaths(stub);
    expect(firstPage).toContain("filter=all");
    expect(firstPage).toContain("per_page=100");
  });

  it("answers forbidden when the installation lacks Checks read", async () => {
    const stub = stubPages(() => FORBIDDEN);

    const result = await bindRepo(stub).listCheckRuns(HEAD);

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.FORBIDDEN, status: 403 },
    });
  });

  it("fails the answer on a run it cannot parse", async () => {
    const stub = stubPages(() => ({
      status: 200,
      body: { total_count: 1, check_runs: [{ id: 1, status: "completed" }] },
    }));

    const result = await bindRepo(stub).listCheckRuns(HEAD);

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.REQUEST_FAILED },
    });
  });
});

describe("listCommitStatuses", () => {
  it("reads each status with its creator, newest first", async () => {
    const stub = stubPages(() => ({
      status: 200,
      body: [
        {
          context: "Unblocked Review",
          state: "success",
          creator: { id: 98133410 },
        },
        {
          context: "Unblocked Review",
          state: "pending",
          creator: { id: 98133410 },
        },
        { context: "deploy", state: "error", creator: null },
      ],
    }));

    const result = await bindRepo(stub).listCommitStatuses(HEAD);

    expect(result).toEqual({
      ok: true,
      value: [
        { context: "Unblocked Review", state: "success", creatorId: 98133410n },
        { context: "Unblocked Review", state: "pending", creatorId: 98133410n },
        { context: "deploy", state: "error" },
      ],
    });
    expect(listReadPaths(stub)[0]).toMatch(new RegExp(`^${STATUSES_PATH}\\?`));
  });

  it("answers forbidden when the installation lacks Commit statuses read", async () => {
    const stub = stubPages(() => FORBIDDEN);

    const result = await bindRepo(stub).listCommitStatuses(HEAD);

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.FORBIDDEN },
    });
  });
});

describe("listSubmittedReviews", () => {
  it("reads submitted reviews with author and commit, pending left out", async () => {
    const stub = stubPages(() => ({
      status: 200,
      body: [
        { id: 1, state: "PENDING", user: { id: 501 }, commit_id: HEAD },
        { id: 2, state: "APPROVED", user: { id: 175728472 }, commit_id: HEAD },
        { id: 3, state: "DISMISSED", user: null, commit_id: null },
      ],
    }));

    const result = await bindRepo(stub).listSubmittedReviews(7);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          reviewId: 2n,
          state: "APPROVED",
          authorId: 175728472n,
          commitId: HEAD,
        },
        { reviewId: 3n, state: "DISMISSED" },
      ],
    });
    expect(listReadPaths(stub)[0]).toMatch(new RegExp(`^${REVIEWS_PATH}\\?`));
  });

  it("fails the answer on a review state GitHub never documented", async () => {
    const stub = stubPages(() => ({
      status: 200,
      body: [{ id: 2, state: "SHRUGGED", user: { id: 1 } }],
    }));

    const result = await bindRepo(stub).listSubmittedReviews(7);

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.REQUEST_FAILED },
    });
  });
});

describe("listRequiredStatusChecks", () => {
  it("collects each required check name once across rulesets", async () => {
    const stub = stubPages(() => ({
      status: 200,
      body: [
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [{ context: "build" }, { context: "lint" }],
          },
        },
        {
          type: "pull_request",
          parameters: { required_approving_review_count: 1 },
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: [
              { context: "build", integration_id: 15368 },
            ],
          },
        },
      ],
    }));

    const result = await bindRepo(stub).listRequiredStatusChecks("main");

    expect(result).toEqual({ ok: true, value: ["build", "lint"] });
    expect(listReadPaths(stub)[0]).toMatch(new RegExp(`^${RULES_PATH}\\?`));
  });

  it("reads a branch no ruleset covers as nothing required", async () => {
    const stub = stubPages(() => ({ status: 200, body: [] }));

    const result = await bindRepo(stub).listRequiredStatusChecks("main");

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("reads GitHub Free's upgrade 403 as nothing required", async () => {
    const stub = stubPages(() => UPGRADE_REQUIRED);

    const result = await bindRepo(stub).listRequiredStatusChecks("main");

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("answers forbidden for any other 403", async () => {
    const stub = stubPages(() => FORBIDDEN);

    const result = await bindRepo(stub).listRequiredStatusChecks("main");

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.FORBIDDEN },
    });
  });

  it("fails the answer on a required checks rule it cannot parse", async () => {
    const stub = stubPages(() => ({
      status: 200,
      body: [{ type: "required_status_checks", parameters: {} }],
    }));

    const result = await bindRepo(stub).listRequiredStatusChecks("main");

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.REQUEST_FAILED },
    });
  });
});
