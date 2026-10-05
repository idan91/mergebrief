import { TicketUnreadReasons } from "brief-core";
import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type IssueInfo,
} from "github";
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
