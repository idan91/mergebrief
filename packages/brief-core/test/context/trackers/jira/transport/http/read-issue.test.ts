import { describe, expect, it } from "vitest";
import { TicketUnreadReasons } from "../../../../../../src/types";
import {
  BASIC_CREDENTIAL,
  CLOUD_ID,
  ECOSYSTEM_CLOUD_ID,
  EMAIL,
  TOKEN,
  makeEndlessBody,
  makeSession,
  makeTransport,
  readFixture,
  stubFetch,
  stubStalledFetch,
  stubUnreachableFetch,
  type RecordedAnswer,
} from "./helpers";

const ISSUE_URL = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/issue/ACME-2?fields=summary,status,issuetype,priority,assignee,labels,parent,description`;
/** Mirrors the transport's ceiling on an issue answer. */
const MAX_ISSUE_BYTES = 1024 * 1024;
const PLACEHOLDER_ACCOUNT_ID = "000000:00000000-0000-0000-0000-000000000000";

async function readIssueWith(answer: RecordedAnswer, key = "ACME-2") {
  const { fetch, calls } = stubFetch(answer);
  const result = await makeTransport(fetch).readIssue(makeSession(), key);
  return { result, calls };
}

function readFixtureJson(name: string): Record<string, unknown> {
  return JSON.parse(readFixture(name));
}

/** The empty-description issue with `fields` edited: a key set to `null` or deleted. */
function makeIssueBody(edit: (fields: Record<string, unknown>) => void) {
  const issue = readFixtureJson("issue-empty-description.json");
  const fields = { ...(issue["fields"] as Record<string, unknown>) };
  edit(fields);
  return JSON.stringify({ ...issue, fields });
}

function collectKeys(value: unknown, keys: Set<string> = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe("readIssue request", () => {
  it("asks for the issue's fields in one GET without expand", async () => {
    const { calls } = await readIssueWith({
      status: 200,
      body: readFixture("issue-every-node.json"),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(ISSUE_URL);
  });

  it("sends basic auth and JSON accept, and refuses redirects", async () => {
    const { calls } = await readIssueWith({ status: 404, body: "" });

    expect(calls[0]?.headers).toEqual({
      Authorization: `Basic ${BASIC_CREDENTIAL}`,
      Accept: "application/json",
    });
    expect(calls[0]?.redirect).toBe("error");
  });

  it("encodes the cloud id and the key into the path", async () => {
    const { fetch, calls } = stubFetch({ status: 404, body: "" });
    const session = makeSession(undefined, ECOSYSTEM_CLOUD_ID);

    await makeTransport(fetch).readIssue(session, "A/B?x=1");

    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe(
      `/ex/jira/${ECOSYSTEM_CLOUD_ID}/rest/api/3/issue/A%2FB%3Fx%3D1`,
    );
  });
});

describe("readIssue decoding", () => {
  it("decodes a child issue with every field set", async () => {
    const { result } = await readIssueWith({
      status: 200,
      body: readFixture("issue-every-node.json"),
    });

    if (!result.ok) {
      throw new Error(result.error.detail);
    }
    const { description, ...rest } = result.value;
    expect(rest).toEqual({
      key: "ACME-2",
      summary: expect.any(String),
      status: expect.any(String),
      issueType: expect.any(String),
      priority: "High",
      assigneeName: "Test User",
      labels: ["checkout", "validation"],
      parent: { key: "ACME-1", summary: "Checkout rework" },
    });
    expect(description).toMatchObject({
      type: "doc",
      content: expect.any(Array),
    });
  });

  it("keeps only the assignee's display name of the people on it", async () => {
    const { result } = await readIssueWith({
      status: 200,
      body: readFixture("issue-every-node.json"),
    });

    expect(result.ok).toBe(true);
    const keys = collectKeys(result);
    for (const key of [
      "emailAddress",
      "accountId",
      "avatarUrls",
      "self",
      "iconUrl",
    ]) {
      expect(keys.has(key)).toBe(false);
    }
    const text = JSON.stringify(result);
    expect(text).not.toContain("test.user@example.invalid");
    expect(text).not.toContain("avatar.png");
    expect(text).not.toContain("/rest/api/3/");
    expect(text).not.toContain("/images/icons/");
    const { description: _description, ...outsideDescription } = result.ok
      ? result.value
      : { description: undefined };
    expect(JSON.stringify(outsideDescription)).not.toContain(
      PLACEHOLDER_ACCOUNT_ID,
    );
  });

  it("reads a null description, assignee and no parent as absent", async () => {
    const { result } = await readIssueWith(
      { status: 200, body: readFixture("issue-parent-epic.json") },
      "ACME-1",
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        key: "ACME-1",
        priority: "Medium",
        assigneeName: undefined,
        labels: [],
        parent: undefined,
        description: undefined,
      },
    });
  });

  it.each([
    ["assignee", "assigneeName"],
    ["description", "description"],
  ])("reads a missing %s key as absent", async (field, recordField) => {
    const { result } = await readIssueWith({
      status: 200,
      body: makeIssueBody((fields) => delete fields[field]),
    });

    expect(result.ok).toBe(true);
    expect(
      result.ok && result.value[recordField as "description"],
    ).toBeUndefined();
  });

  it("reads a null parent as no parent", async () => {
    const { result } = await readIssueWith({
      status: 200,
      body: makeIssueBody((fields) => (fields["parent"] = null)),
    });

    expect(result).toMatchObject({ ok: true, value: { parent: undefined } });
  });

  it("reads null or missing priority as no priority", async () => {
    const nulled = await readIssueWith({
      status: 200,
      body: makeIssueBody((fields) => (fields["priority"] = null)),
    });
    const missing = await readIssueWith({
      status: 200,
      body: makeIssueBody((fields) => delete fields["priority"]),
    });

    expect(nulled.result).toMatchObject({
      ok: true,
      value: { priority: undefined },
    });
    expect(missing.result).toMatchObject({
      ok: true,
      value: { priority: undefined },
    });
  });

  it("reads null or missing labels as none", async () => {
    const nulled = await readIssueWith({
      status: 200,
      body: makeIssueBody((fields) => (fields["labels"] = null)),
    });
    const missing = await readIssueWith({
      status: 200,
      body: makeIssueBody((fields) => delete fields["labels"]),
    });

    expect(nulled.result).toMatchObject({ ok: true, value: { labels: [] } });
    expect(missing.result).toMatchObject({ ok: true, value: { labels: [] } });
  });

  it("keeps the key Jira answered under for a moved issue", async () => {
    const { result } = await readIssueWith(
      { status: 200, body: readFixture("issue-moved-to-another-project.json") },
      "ACME-4",
    );

    expect(result).toMatchObject({ ok: true, value: { key: "WEB-1" } });
  });

  it.each([
    ["issue-longest-description.json", "ACME-5"],
    ["issue-written-in-the-editor.json", "ACME-6"],
    ["issue-empty-description.json", "ACME-3"],
  ])("decodes the recorded answer %s", async (fixture, key) => {
    const { result } = await readIssueWith(
      { status: 200, body: readFixture(fixture) },
      key,
    );

    expect(result).toMatchObject({ ok: true, value: { key } });
  });
});

const FAILURE_ROWS: readonly [string, RecordedAnswer, string][] = [
  [
    "a hidden or missing issue",
    { status: 404, body: readFixture("error-404-hidden-or-missing.json") },
    TicketUnreadReasons.NOT_FOUND,
  ],
  [
    "a bad credential",
    {
      status: 401,
      body: readFixture("error-401-bad-credential.json"),
      failureCategory: "FAILURE_CLIENT_AUTH",
    },
    TicketUnreadReasons.NO_CREDENTIAL,
  ],
  [
    "a token without the read scope",
    {
      status: 401,
      body: readFixture("error-401-scope-does-not-match.json"),
      failureCategory: "FAILURE_CLIENT_SCOPE_CHECK",
    },
    TicketUnreadReasons.NO_CREDENTIAL,
  ],
  [
    "a forbidden answer",
    { status: 403, body: "" },
    TicketUnreadReasons.NO_CREDENTIAL,
  ],
  ["a rate limit", { status: 429, body: "" }, TicketUnreadReasons.RATE_LIMITED],
  [
    "a server error",
    { status: 503, body: "<html></html>" },
    TicketUnreadReasons.TIMEOUT,
  ],
  [
    "an unexpected status",
    { status: 302, body: "" },
    TicketUnreadReasons.TIMEOUT,
  ],
  [
    "a 404 with an unrecognised body",
    { status: 404, body: "<html>gone</html>" },
    TicketUnreadReasons.TIMEOUT,
  ],
  ["an answer with no body", { status: 200 }, TicketUnreadReasons.TIMEOUT],
  [
    "a body that is not JSON",
    { status: 200, body: "{not json" },
    TicketUnreadReasons.TIMEOUT,
  ],
  [
    "a body that does not decode",
    { status: 200, body: JSON.stringify({ key: "ACME-2", fields: {} }) },
    TicketUnreadReasons.TIMEOUT,
  ],
  [
    "a description that is not a document",
    {
      status: 200,
      body: makeIssueBody((fields) => (fields["description"] = "plain text")),
    },
    TicketUnreadReasons.TIMEOUT,
  ],
];

describe("readIssue failures", () => {
  it.each(FAILURE_ROWS)(
    "maps %s to its unread reason",
    async (_name, answer, reason) => {
      const { result, calls } = await readIssueWith(answer);

      expect(result).toMatchObject({ ok: false, error: { reason } });
      expect(calls).toHaveLength(1);
    },
  );

  it.each(FAILURE_ROWS)(
    "keeps the credential out of the detail for %s",
    async (_name, answer) => {
      const { result } = await readIssueWith(answer);

      const detail = result.ok ? "" : result.error.detail;
      expect(detail).not.toContain(TOKEN);
      expect(detail).not.toContain(EMAIL);
      expect(detail).not.toContain(BASIC_CREDENTIAL);
      expect(detail).not.toContain("Issue does not exist");
    },
  );

  it("names the failure category in the detail of a refused credential", async () => {
    const { result } = await readIssueWith({
      status: 401,
      body: readFixture("error-401-scope-does-not-match.json"),
      failureCategory: "FAILURE_CLIENT_SCOPE_CHECK",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { detail: "jira answered 401 FAILURE_CLIENT_SCOPE_CHECK" },
    });
  });

  it("does not echo a failure category that is not a plain token", async () => {
    const { result } = await readIssueWith({
      status: 401,
      body: "",
      failureCategory: "Basic abc==",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { detail: "jira answered 401" },
    });
  });

  it("refuses a body past the ceiling as a timeout", async () => {
    const padding = "x".repeat(MAX_ISSUE_BYTES);
    const body = makeIssueBody((fields) => (fields["summary"] = padding));

    const { result } = await readIssueWith({ status: 200, body });

    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT },
    });
  });

  it("stops reading a body that never ends", async () => {
    const endless = makeEndlessBody();

    const { result } = await readIssueWith({ status: 200, body: endless.body });

    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT },
    });
    expect(endless.wasCancelled()).toBe(true);
  });

  it("is a timeout when the connection fails", async () => {
    const result = await makeTransport(stubUnreachableFetch()).readIssue(
      makeSession(),
      "ACME-2",
    );

    expect(result).toEqual({
      ok: false,
      error: {
        reason: TicketUnreadReasons.TIMEOUT,
        detail: "jira unreachable",
      },
    });
  });

  it("is a timeout naming the budget when the session aborts", async () => {
    const controller = new AbortController();
    const transport = makeTransport(stubStalledFetch(), 250);

    const pending = transport.readIssue(
      makeSession(controller.signal),
      "ACME-2",
    );
    controller.abort();

    expect(await pending).toEqual({
      ok: false,
      error: {
        reason: TicketUnreadReasons.TIMEOUT,
        detail: "no answer within 250 ms",
      },
    });
  });
});

describe("readIssue on a cloud id that names no site", () => {
  it("tells the gateway's 404 apart by its failure category", async () => {
    const { result } = await readIssueWith({
      status: 404,
      body: readFixture("error-404-wrong-cloud-id.json"),
      failureCategory: "FAILURE_CLIENT_TCS",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT },
    });
    expect(!result.ok && result.error.unknownCloudId === true).toBe(true);
  });

  it("trusts the failure category over an issue-shaped body", async () => {
    const { result } = await readIssueWith({
      status: 404,
      body: readFixture("error-404-hidden-or-missing.json"),
      failureCategory: "FAILURE_CLIENT_TCS",
    });

    expect(!result.ok && result.error.unknownCloudId === true).toBe(true);
  });

  it("tells the gateway's 404 apart by its body without the header", async () => {
    const { result } = await readIssueWith({
      status: 404,
      body: readFixture("error-404-wrong-cloud-id.json"),
    });

    expect(!result.ok && result.error.unknownCloudId === true).toBe(true);
  });

  it.each(FAILURE_ROWS)(
    "does not read %s as an unknown cloud id",
    async (_name, answer) => {
      const { result } = await readIssueWith(answer);

      expect(!result.ok && result.error.unknownCloudId === true).toBe(false);
    },
  );
});
