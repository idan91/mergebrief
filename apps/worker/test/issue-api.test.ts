import { TicketUnreadReasons } from "brief-core";
import {
  GitHubApiErrorCodes,
  RepositoryVisibilities,
  type GitHubApiError,
  type IssueInfo,
  type RepositoryVisibility,
} from "github";
import type { Result } from "types/utils";
import { describe, expect, it } from "vitest";
import type { PullRequestSource } from "../src/task/github-port";
import { createInstallationIssueApi } from "../src/task/issue-api";

const ISSUE: IssueInfo = {
  title: "t",
  state: "open",
  stateReason: null,
  labels: ["bug"],
  milestone: null,
  body: "b",
  isPullRequest: false,
};

const LOCATOR = { owner: "acme", repo: "widget", number: 42 };
const SIGNAL = new AbortController().signal;

function makeSource(
  fetchIssue: PullRequestSource["fetchIssue"],
  calls: unknown[][] = [],
): PullRequestSource {
  // Only fetchIssue is exercised; the rest of the port is a type-level stand-in.
  const source = {
    fetchIssue: async (owner: string, repo: string, number: number) => {
      calls.push([owner, repo, number]);
      return fetchIssue(owner, repo, number);
    },
  } as unknown as PullRequestSource;
  return source;
}

describe("createInstallationIssueApi", () => {
  it("passes a successful read through, addressed by the locator", async () => {
    const calls: unknown[][] = [];
    const api = createInstallationIssueApi(
      makeSource(async () => ({ ok: true, value: ISSUE }), calls),
    );
    await expect(api.fetchIssue(LOCATOR, SIGNAL)).resolves.toEqual({
      ok: true,
      value: ISSUE,
    });
    expect(calls).toEqual([["acme", "widget", 42]]);
  });

  it.each([
    [GitHubApiErrorCodes.NOT_FOUND, TicketUnreadReasons.NOT_FOUND],
    [GitHubApiErrorCodes.FORBIDDEN, TicketUnreadReasons.NO_CREDENTIAL],
    [GitHubApiErrorCodes.UNAUTHORIZED, TicketUnreadReasons.NO_CREDENTIAL],
    [GitHubApiErrorCodes.RATE_LIMITED, TicketUnreadReasons.RATE_LIMITED],
    [GitHubApiErrorCodes.REQUEST_FAILED, TicketUnreadReasons.TIMEOUT],
  ])("maps a %s API error to the %s unread reason", async (code, reason) => {
    const error: GitHubApiError = { code, message: "failed to fetch issue" };
    const api = createInstallationIssueApi(
      makeSource(async () => ({ ok: false, error })),
    );
    await expect(api.fetchIssue(LOCATOR, SIGNAL)).resolves.toEqual({
      ok: false,
      error: { reason, detail: "failed to fetch issue" },
    });
  });
});

type VisibilityAnswer = Result<RepositoryVisibility, GitHubApiError>;

function makeVisibilitySource(
  answers: Record<string, VisibilityAnswer>,
  calls: unknown[][] = [],
): PullRequestSource {
  // Only fetchRepositoryVisibility is exercised; the rest is a type-level stand-in.
  const source = {
    fetchRepositoryVisibility: async (owner: string, repo: string) => {
      calls.push([owner, repo]);
      const answer = answers[repo];
      if (answer === undefined) {
        throw new Error(`no visibility stubbed for ${repo}`);
      }
      return answer;
    },
  } as unknown as PullRequestSource;
  return source;
}

const TRACKER = { owner: "acme", repo: "tracker" };
const SITE = { owner: "acme", repo: "site" };
const { PRIVATE, INTERNAL, PUBLIC } = RepositoryVisibilities;

describe("createInstallationIssueApi isVisibleToReadersOf", () => {
  it.each([
    [PRIVATE, PRIVATE, true],
    [PRIVATE, INTERNAL, false],
    [PRIVATE, PUBLIC, false],
    [INTERNAL, PRIVATE, true],
    [INTERNAL, INTERNAL, true],
    [INTERNAL, PUBLIC, false],
  ])(
    "answers a %s issue repo under a %s pull request as %s",
    async (issueSide, pullRequestSide, expected) => {
      const calls: unknown[][] = [];
      const answers = {
        tracker: { ok: true, value: issueSide },
        site: { ok: true, value: pullRequestSide },
      } as const;
      const api = createInstallationIssueApi(
        makeVisibilitySource(answers, calls),
      );

      const result = await api.isVisibleToReadersOf(TRACKER, SITE, SIGNAL);

      expect(result).toEqual({ ok: true, value: expected });
      expect(calls).toEqual([
        ["acme", "tracker"],
        ["acme", "site"],
      ]);
    },
  );

  it("answers a public issue repo without reading the pull request's", async () => {
    const calls: unknown[][] = [];
    const answers = { tracker: { ok: true, value: PUBLIC } } as const;
    const api = createInstallationIssueApi(
      makeVisibilitySource(answers, calls),
    );

    const result = await api.isVisibleToReadersOf(TRACKER, SITE, SIGNAL);

    expect(result).toEqual({ ok: true, value: true });
    expect(calls).toEqual([["acme", "tracker"]]);
  });

  it.each([
    [GitHubApiErrorCodes.NOT_FOUND, TicketUnreadReasons.NOT_FOUND],
    [GitHubApiErrorCodes.FORBIDDEN, TicketUnreadReasons.NO_CREDENTIAL],
    [GitHubApiErrorCodes.RATE_LIMITED, TicketUnreadReasons.RATE_LIMITED],
    [GitHubApiErrorCodes.REQUEST_FAILED, TicketUnreadReasons.TIMEOUT],
  ])("maps a %s visibility error to the %s reason", async (code, reason) => {
    const error: GitHubApiError = { code, message: "failed to read" };
    const answers = { tracker: { ok: false, error } } as const;
    const api = createInstallationIssueApi(makeVisibilitySource(answers));

    const result = await api.isVisibleToReadersOf(TRACKER, SITE, SIGNAL);

    expect(result).toEqual({
      ok: false,
      error: { reason, detail: "failed to read" },
    });
  });

  it("gives no answer when the pull request's repository cannot be read", async () => {
    const error: GitHubApiError = {
      code: GitHubApiErrorCodes.REQUEST_FAILED,
      message: "failed to read",
    };
    const answers = {
      tracker: { ok: true, value: PRIVATE },
      site: { ok: false, error },
    } as const;
    const api = createInstallationIssueApi(makeVisibilitySource(answers));

    const result = await api.isVisibleToReadersOf(TRACKER, SITE, SIGNAL);

    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT },
    });
  });
});
