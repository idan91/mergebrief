import { describe, expect, it } from "vitest";
import {
  createGhTransport,
  createInstallationTransport,
  type GhExec,
  type InstallationIssueApi,
  type IssueRecord,
} from "../../../../src/context/trackers/github";
import { TicketUnreadReasons } from "../../../../src/types";

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

describe("GitHubTransports.GH", () => {
  it("reads the issue through gh api and maps the payload", async () => {
    const calls: ExecCall[] = [];
    const signal = new AbortController().signal;
    const transport = createGhTransport(
      stubExecReturning(JSON.stringify(PAYLOAD), calls),
    );

    const result = await transport.readIssue(LOCATOR, signal);

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
    const transport = createGhTransport(
      stubExecReturning(
        JSON.stringify({ title: "t", state: "open", body: null, labels: [] }),
      ),
    );
    const result = await transport.readIssue(
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
    const transport = createGhTransport(
      stubExecReturning(
        JSON.stringify({ ...PAYLOAD, pull_request: { url: "x" } }),
      ),
    );
    const result = await transport.readIssue(
      LOCATOR,
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.isPullRequest).toBe(true);
  });

  it.each([
    [{ code: 4, stderr: "" }, TicketUnreadReasons.NO_CREDENTIAL],
    [
      { code: 1, stderr: "gh: Not Found (HTTP 404)" },
      TicketUnreadReasons.NOT_FOUND,
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
    [{ code: "ENOENT", stderr: "" }, TicketUnreadReasons.UNSUPPORTED],
    [{ name: "AbortError" }, TicketUnreadReasons.TIMEOUT],
    [{ code: 1, stderr: "something else" }, TicketUnreadReasons.TIMEOUT],
  ])("maps the gh failure %j to %s", async (failure, reason) => {
    const transport = createGhTransport(stubExecFailing(failure));
    const result = await transport.readIssue(
      LOCATOR,
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.reason).toBe(reason);
  });

  it("never lets stderr reach the failure detail", async () => {
    const transport = createGhTransport(
      stubExecFailing({
        code: 1,
        stderr: "token ghp_SECRET leaked (HTTP 404)",
      }),
    );
    const result = await transport.readIssue(
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
    const transport = createGhTransport(stubExecReturning("{}", calls));
    const result = await transport.readIssue(
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
    const transport = createGhTransport(stubExecReturning('{"title": 3}'));
    await expect(
      transport.readIssue(LOCATOR, new AbortController().signal),
    ).rejects.toThrow("expected string");
  });
});

const ISSUE: IssueRecord = {
  title: "t",
  state: "open",
  stateReason: null,
  labels: ["bug"],
  milestone: null,
  body: "b",
  isPullRequest: false,
};

function stubApi(calls: unknown[] = []): InstallationIssueApi {
  return {
    async fetchIssue(locator) {
      calls.push(locator);
      return { ok: true, value: ISSUE };
    },
  };
}

describe("GitHubTransports.INSTALLATION", () => {
  const signal = new AbortController().signal;

  it("reads through the job's issue API, addressed by the locator", async () => {
    const calls: unknown[] = [];
    const transport = createInstallationTransport(stubApi(calls));
    await expect(transport.readIssue(LOCATOR, signal)).resolves.toEqual({
      ok: true,
      value: ISSUE,
    });
    expect(calls).toEqual([LOCATOR]);
  });

  it("is not-found outside the bound repos, without calling the API", async () => {
    const calls: unknown[] = [];
    const transport = createInstallationTransport(stubApi(calls), {
      onlyRepos: [
        { owner: "acme", repo: "other" },
        { owner: "acme", repo: "tracker" },
      ],
    });
    const result = await transport.readIssue(LOCATOR, signal);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.reason).toBe(TicketUnreadReasons.NOT_FOUND);
    expect(calls).toEqual([]);
  });

  it("reads a bound repo named in different letter case", async () => {
    const calls: unknown[] = [];
    const transport = createInstallationTransport(stubApi(calls), {
      onlyRepos: [{ owner: "Acme", repo: "Widget" }],
    });
    await expect(transport.readIssue(LOCATOR, signal)).resolves.toEqual({
      ok: true,
      value: ISSUE,
    });
    expect(calls).toEqual([LOCATOR]);
  });

  it("reads any one of several bound repos", async () => {
    const calls: unknown[] = [];
    const transport = createInstallationTransport(stubApi(calls), {
      onlyRepos: [
        { owner: "acme", repo: "tracker" },
        { owner: "acme", repo: "widget" },
      ],
    });
    const result = await transport.readIssue(LOCATOR, signal);
    expect(result.ok).toBe(true);
  });
});
