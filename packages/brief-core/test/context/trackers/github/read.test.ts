import { describe, expect, it } from "vitest";
import {
  createGitHubRead,
  readFailureForStatus,
  renderIssueHeader,
  type IssueLocator,
  type GitHubTransport,
  type IssueRecord,
} from "../../../../src/context/trackers/github";
import {
  ContextProviderTypes,
  MAX_SNIPPET_CHARS,
  type ContextReadFailure,
} from "../../../../src/context/types";
import type { TicketReference } from "../../../../src/context/trackers/types";
import { TicketTrackers } from "types/trackers";
import { ReferenceLocations, TicketUnreadReasons } from "../../../../src/types";

const ISSUE: IssueRecord = {
  title: "Add the thing",
  state: "open",
  stateReason: null,
  labels: ["bug", "p1"],
  milestone: "v1.2",
  body: "Please add the thing.",
  isPullRequest: false,
};

const REFERENCE: TicketReference = {
  tracker: TicketTrackers.GITHUB,
  key: "",
  number: 42,
  url: "https://github.com/acme/widget/issues/42",
  foundIn: ReferenceLocations.TITLE,
  closing: false,
};

function stubDeps() {
  return { log: () => {}, signal: new AbortController().signal };
}

function stubReaderReturning(
  outcome: IssueRecord | ContextReadFailure,
  calls: IssueLocator[] = [],
): GitHubTransport {
  return {
    async readIssue(locator) {
      calls.push(locator);
      if ("reason" in outcome) {
        return { ok: false, error: outcome };
      }
      return { ok: true, value: outcome };
    },
  };
}

const SHARED = { env: {}, contextSources: [] };

/** The read for a root whose GitHub slot holds this transport; the test's one way in. */
function readWith(transport: GitHubTransport) {
  const read = createGitHubRead(SHARED, transport);
  if (!read.ok) {
    throw new Error("unreachable");
  }
  return read.value;
}

describe("createGitHubRead", () => {
  it("refuses a root with no GitHub slot", () => {
    const read = createGitHubRead(SHARED, undefined);
    expect(read.ok).toBe(false);
    if (read.ok) {
      throw new Error("unreachable");
    }
    expect(read.error.issues[0]).toMatch(/no transport/);
  });

  it("declares the github kind when the root binds a reader", () => {
    expect(readWith(stubReaderReturning(ISSUE)).kind).toBe(
      TicketTrackers.GITHUB,
    );
  });

  it("reads the primary through the reader at the URL's owner/repo", async () => {
    const calls: IssueLocator[] = [];
    const provider = readWith(stubReaderReturning(ISSUE, calls));

    const result = await provider.readPrimary(REFERENCE, stubDeps());

    expect(calls).toEqual([{ owner: "acme", repo: "widget", number: 42 }]);
    expect(result).toEqual({
      ok: true,
      value: {
        providerId: ContextProviderTypes.GITHUB_ISSUES,
        source: REFERENCE.url,
        text: "Please add the thing.",
        tracker: TicketTrackers.GITHUB,
        key: "",
        title: "Add the thing",
        header: "open · bug, p1 · v1.2",
        foundIn: ReferenceLocations.TITLE,
      },
    });
  });

  it("caps the body at the shared snippet cap", async () => {
    const provider = readWith(
      stubReaderReturning({
        ...ISSUE,
        body: "x".repeat(MAX_SNIPPET_CHARS + 5),
      }),
    );
    const result = await provider.readPrimary(REFERENCE, stubDeps());
    expect(result?.ok).toBe(true);
    if (!result?.ok) {
      throw new Error("unreachable");
    }
    expect(result.value.text).toHaveLength(MAX_SNIPPET_CHARS);
  });

  it("treats a pull request hit as not found", async () => {
    const provider = readWith(
      stubReaderReturning({ ...ISSUE, isPullRequest: true }),
    );
    const result = await provider.readPrimary(REFERENCE, stubDeps());
    expect(result).toEqual({
      ok: false,
      error: {
        reason: TicketUnreadReasons.NOT_FOUND,
        detail: "#42 is a pull request, not an issue",
        resolvedToPullRequest: true,
      },
    });
  });

  it("passes a refusal from the reader through unchanged", async () => {
    const failure = {
      reason: TicketUnreadReasons.RATE_LIMITED,
      detail: "reader said rate-limited",
    };
    const provider = readWith(stubReaderReturning(failure));
    const result = await provider.readPrimary(REFERENCE, stubDeps());
    expect(result).toEqual({ ok: false, error: failure });
  });

  it("reports an aborted read as a timeout", async () => {
    const controller = new AbortController();
    const reader: GitHubTransport = {
      async readIssue() {
        controller.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    };
    const provider = readWith(reader);
    const result = await provider.readPrimary(REFERENCE, {
      log: () => {},
      signal: controller.signal,
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT, detail: "read aborted" },
    });
  });

  it("lets a reader bug propagate instead of dressing it as a refusal", async () => {
    const reader: GitHubTransport = {
      async readIssue() {
        throw new Error("boom");
      },
    };
    const provider = readWith(reader);
    await expect(provider.readPrimary(REFERENCE, stubDeps())).rejects.toThrow(
      "boom",
    );
  });

  it.each([
    ["not a GitHub issue URL", "https://example.com/acme/widget/issues/42"],
    ["a dot-dot repo segment", "https://github.com/acme/../issues/42"],
    ["a dot owner segment", "https://github.com/./widget/issues/42"],
  ])("refuses a reference whose URL is %s", async (_shape, url) => {
    const calls: IssueLocator[] = [];
    const provider = readWith(stubReaderReturning(ISSUE, calls));
    const result = await provider.readPrimary(
      { ...REFERENCE, url },
      stubDeps(),
    );
    expect(calls).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.error.reason).toBe(TicketUnreadReasons.UNSUPPORTED);
  });
});

describe("renderIssueHeader", () => {
  it.each([
    [{ ...ISSUE }, "open · bug, p1 · v1.2"],
    [{ ...ISSUE, labels: [], milestone: null }, "open"],
    [{ ...ISSUE, labels: ["docs"], milestone: null }, "open · docs"],
    [
      { ...ISSUE, state: "closed", stateReason: "not_planned", labels: [] },
      "closed (not_planned) · v1.2",
    ],
    [{ ...ISSUE, stateReason: "reopened" }, "open · bug, p1 · v1.2"],
  ])("renders %j as %s", (record, expected) => {
    expect(renderIssueHeader(record)).toBe(expected);
  });
});

describe("readFailureForStatus", () => {
  it.each([
    [404, TicketUnreadReasons.NOT_FOUND],
    [401, TicketUnreadReasons.NO_CREDENTIAL],
    [403, TicketUnreadReasons.NO_CREDENTIAL],
    [429, TicketUnreadReasons.RATE_LIMITED],
    [500, TicketUnreadReasons.TIMEOUT],
  ])("maps HTTP %i to %s", (status, reason) => {
    expect(readFailureForStatus(status)).toEqual({
      reason,
      detail: `HTTP ${status}`,
    });
  });
});
