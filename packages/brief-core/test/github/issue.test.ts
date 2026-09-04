import { describe, expect, it } from "vitest";
import { createGhIssueReader, type GhExec } from "../../src/github/issue";
import { TicketUnreadReasons } from "../../src/types";

const LOCATOR = { owner: "acme", repo: "widget", number: 42 };

const PAYLOAD = {
  title: "Add the thing",
  state: "closed",
  state_reason: "completed",
  labels: [{ name: "bug" }, "p1"],
  milestone: { title: "v1.2" },
  body: "Please add the thing.",
};

interface ExecCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly signal: AbortSignal;
}

function stubExecReturning(stdout: string, calls: ExecCall[] = []): GhExec {
  return async (file, args, options) => {
    calls.push({ file, args, signal: options.signal });
    return { stdout };
  };
}

function stubExecFailing(failure: {
  code?: number | string;
  stderr?: string;
  name?: string;
}): GhExec {
  return async () => {
    throw Object.assign(new Error("gh failed"), failure);
  };
}

describe("createGhIssueReader", () => {
  it("reads the issue through gh api and maps the payload", async () => {
    const calls: ExecCall[] = [];
    const signal = new AbortController().signal;
    const reader = createGhIssueReader(
      stubExecReturning(JSON.stringify(PAYLOAD), calls),
    );

    const result = await reader.readIssue(LOCATOR, signal);

    expect(calls).toEqual([
      { file: "gh", args: ["api", "repos/acme/widget/issues/42"], signal },
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Add the thing",
        state: "closed",
        stateReason: "completed",
        labels: ["bug", "p1"],
        milestone: "v1.2",
        body: "Please add the thing.",
        isPullRequest: false,
      },
    });
  });

  it("normalizes null body, milestone and labels", async () => {
    const reader = createGhIssueReader(
      stubExecReturning(
        JSON.stringify({ title: "t", state: "open", body: null, labels: [] }),
      ),
    );
    const result = await reader.readIssue(
      LOCATOR,
      new AbortController().signal,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        title: "t",
        state: "open",
        stateReason: null,
        labels: [],
        milestone: null,
        body: "",
        isPullRequest: false,
      },
    });
  });

  it("flags a payload carrying pull_request", async () => {
    const reader = createGhIssueReader(
      stubExecReturning(
        JSON.stringify({ ...PAYLOAD, pull_request: { url: "x" } }),
      ),
    );
    const result = await reader.readIssue(
      LOCATOR,
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.isPullRequest).toBe(true);
  });

  it.each([
    [{ code: 4, stderr: "" }, TicketUnreadReasons.NO_CREDENTIAL],
    [
      { code: 1, stderr: "gh: Not Found (HTTP 404)" },
      TicketUnreadReasons.NOT_FOUND,
    ],
    [
      { code: 1, stderr: "gh: Resource not accessible (HTTP 403)" },
      TicketUnreadReasons.NO_CREDENTIAL,
    ],
    [
      { code: 1, stderr: "gh: Bad credentials (HTTP 401)" },
      TicketUnreadReasons.NO_CREDENTIAL,
    ],
    [
      {
        code: 1,
        stderr: "gh: API rate limit exceeded for user ID 1 (HTTP 403)",
      },
      TicketUnreadReasons.RATE_LIMITED,
    ],
    [
      { code: 1, stderr: "gh: rate limit exceeded (HTTP 429)" },
      TicketUnreadReasons.RATE_LIMITED,
    ],
    [
      { code: 1, stderr: "gh: server error (HTTP 502)" },
      TicketUnreadReasons.TIMEOUT,
    ],
    [{ code: "ENOENT", stderr: "" }, TicketUnreadReasons.UNSUPPORTED],
    [{ name: "AbortError" }, TicketUnreadReasons.TIMEOUT],
    [{ code: 1, stderr: "something else" }, TicketUnreadReasons.TIMEOUT],
  ])("maps the gh failure %j to %s", async (failure, reason) => {
    const reader = createGhIssueReader(stubExecFailing(failure));
    const result = await reader.readIssue(
      LOCATOR,
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.reason).toBe(reason);
  });

  it("never lets stderr reach the failure detail", async () => {
    const reader = createGhIssueReader(
      stubExecFailing({
        code: 1,
        stderr: "token ghp_SECRET leaked (HTTP 404)",
      }),
    );
    const result = await reader.readIssue(
      LOCATOR,
      new AbortController().signal,
    );
    expect(JSON.stringify(result)).not.toContain("ghp_SECRET");
  });

  it.each([
    { owner: "a b", repo: "widget", number: 42 },
    { owner: "..", repo: "widget", number: 42 },
    { owner: "acme", repo: ".", number: 42 },
    { owner: "acme", repo: "widget", number: 0 },
  ])("refuses the malformed locator %j before touching gh", async (locator) => {
    const calls: ExecCall[] = [];
    const reader = createGhIssueReader(stubExecReturning("{}", calls));
    const result = await reader.readIssue(
      locator,
      new AbortController().signal,
    );
    expect(calls).toEqual([]);
    expect(result).toEqual({
      ok: false,
      error: {
        reason: TicketUnreadReasons.UNSUPPORTED,
        detail: "malformed issue locator",
      },
    });
  });

  it("throws on a payload gh should never produce", async () => {
    const reader = createGhIssueReader(stubExecReturning('{"title": 3}'));
    await expect(
      reader.readIssue(LOCATOR, new AbortController().signal),
    ).rejects.toThrow("expected string");
  });
});
