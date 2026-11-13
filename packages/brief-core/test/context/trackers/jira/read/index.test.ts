import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JiraTransports,
  createJiraRead,
} from "../../../../../src/context/trackers/jira";
import type { SharedRootDeps } from "../../../../../src/context/trackers/types";
import {
  ContextProviderTypes,
  MAX_SNIPPET_CHARS,
} from "../../../../../src/context/types";
import { TicketUnreadReasons } from "../../../../../src/types";
import {
  BASIC_CREDENTIAL,
  CLOUD_ID,
  EMAIL,
  SITE,
  TENANT_INFO_URL,
  TOKEN,
  readFixture,
  stubSiteFetch,
  stubStalledFetch,
  stubUnreachableFetch,
  type AnswerSource,
} from "../transport/http/helpers";
import {
  SHARED,
  makeIssueBody,
  makeRead,
  makeReference,
  readRecorded,
  readThrough,
  requireSnippet,
} from "./helpers";

const FENCE = "```";
const EVERY_NODE = "issue-every-node.json";
const EVERY_NODE_HEADER =
  "Validate the email field at checkout · Backlog · Story · High · Test User · checkout, validation · ACME-2";
const EVERY_NODE_BODY = [
  "Parent: ACME-1 Checkout rework",
  "",
  "## Goal",
  "Plain, bold, italic, ~~struck~~, underlined, inlineCode(), a link, coloured, H2O.",
  "After a hard break. Mention: @Test User emoji: 😀 date: 2026-11-13 status: [IN REVIEW] card: https://acme.atlassian.net/browse/ACME-1",
  "- Bullet one",
  "  - Nested bullet",
  "- Bullet two",
  "3. Third step",
  "4. Fourth step",
  "[x] Done task",
  "[ ] Open task",
  "> A quoted line.",
  `${FENCE}typescript`,
  "const answer: number = 42;",
  "export { answer };",
  FENCE,
  "Panel warning text.",
  "Field | Rule",
  "email | - List inside a cell",
  "Merged across two columns",
  "Expand title",
  "  Text inside an expand.",
].join("\n");
const EDITOR_BODY = [
  "2026-11-12  @Test User",
  "sad;sadsa",
  "[attachment: image-20261112-230636.png]",
].join("\n");
const PARENT_LINE = "Parent: ACME-1 Checkout rework";
/** The longest description is written as lines of 999 characters, each ending on `end.`. */
const LONGEST_LINE = `${"word ".repeat(199)}end.`;
const LONGEST_LINES_UNDER_CAP = 20;

/** The recorded files hold these in place of a real person's. */
const PLACEHOLDER_ACCOUNT_ID = "00000000-0000-0000-0000-000000000000";
const PLACEHOLDER_EMAIL = "test.user@example.invalid";
const UNKNOWN_CLOUD_ID_LINE =
  "jira: the cloud id remembered for acme.atlassian.net no longer names a site; the next read looks it up again";

function readRefusal(shared: SharedRootDeps): string {
  const read = createJiraRead(shared, JiraTransports.HTTP.create());
  if (read.ok) {
    throw new Error("expected a refusal");
  }
  return read.error.issues.join("; ");
}

/** The recorded issue with no description, given one holding `blocks`. */
function makeDescribedIssue(blocks: unknown[]): AnswerSource {
  const body = makeIssueBody("issue-empty-description.json", (fields) => {
    fields["description"] = { type: "doc", version: 1, content: blocks };
  });
  return { status: 200, body };
}

describe("createJiraRead", () => {
  it("refuses a root with no Jira slot", () => {
    const read = createJiraRead(SHARED, undefined);
    expect(read.ok || read.error.issues).toEqual([
      "jira: no transport bound at this root",
    ]);
  });

  it("refuses a root whose config lists no Jira source", () => {
    expect(readRefusal({ ...SHARED, contextSources: [] })).toContain(
      "contextSources",
    );
  });

  it("refuses a set token with the email unset, naming the variable", () => {
    const text = readRefusal({ ...SHARED, env: { JIRA_API_TOKEN: TOKEN } });
    expect(text).toBe("JIRA_EMAIL: jira account email env var is not set");
  });

  it("refuses a set email with the token unset, naming the variable", () => {
    const text = readRefusal({ ...SHARED, env: { JIRA_EMAIL: EMAIL } });
    expect(text).toBe("JIRA_API_TOKEN: jira API token env var is not set");
  });

  it("reads both variables by the names the entry gives", () => {
    const named: SharedRootDeps = {
      env: { BOT_EMAIL: EMAIL, BOT_TOKEN: TOKEN },
      contextSources: [
        {
          type: "jira",
          site: SITE,
          emailEnv: "BOT_EMAIL",
          tokenEnv: "BOT_TOKEN",
        },
      ],
    };
    expect(createJiraRead(named, JiraTransports.HTTP.create()).ok).toBe(true);
    const text = readRefusal({ ...named, env: { JIRA_EMAIL: EMAIL } });
    expect(text).toContain("BOT_EMAIL");
    expect(text).not.toContain(EMAIL);
  });

  it("builds a read of the jira kind", () => {
    const read = createJiraRead(SHARED, JiraTransports.HTTP.create());
    expect(read.ok && read.value.kind).toBe("jira");
  });
});

describe("the Jira read's request", () => {
  it("asks the entry's site for the issue once, with the root's credential", async () => {
    const { calls } = await readRecorded(EVERY_NODE);

    expect(calls.map((call) => call.url)).toEqual([
      TENANT_INFO_URL,
      expect.stringContaining(`/ex/jira/${CLOUD_ID}/rest/api/3/issue/ACME-2?`),
    ]);
    expect(calls[1]?.headers["Authorization"]).toBe(
      `Basic ${BASIC_CREDENTIAL}`,
    );
  });
});

describe("the Jira read's snippet", () => {
  it("carries the header, the title and where the issue lives", async () => {
    const reference = makeReference("ACME-2", { foundIn: "branch" });
    const snippet = requireSnippet(await readRecorded(EVERY_NODE, reference));

    expect(snippet).toEqual({
      providerId: ContextProviderTypes.JIRA,
      source: "https://acme.atlassian.net/browse/ACME-2",
      text: EVERY_NODE_BODY,
      tracker: "jira",
      key: "ACME-2",
      title: "Validate the email field at checkout",
      header: EVERY_NODE_HEADER,
      foundIn: "branch",
    });
  });

  it.each([
    [
      "priority",
      ["priority"],
      "Validate the email field at checkout · Backlog · Story · Test User · checkout, validation · ACME-2",
    ],
    [
      "assignee",
      ["assignee"],
      "Validate the email field at checkout · Backlog · Story · High · checkout, validation · ACME-2",
    ],
    [
      "labels",
      ["labels"],
      "Validate the email field at checkout · Backlog · Story · High · Test User · ACME-2",
    ],
    [
      "every optional piece",
      ["priority", "assignee", "labels"],
      "Validate the email field at checkout · Backlog · Story · ACME-2",
    ],
  ])(
    "leaves %s out of the header when absent",
    async (_label, absent, header) => {
      const body = makeIssueBody(EVERY_NODE, (fields) => {
        for (const name of absent) {
          delete fields[name];
        }
      });
      const snippet = requireSnippet(await readThrough({ status: 200, body }));
      expect(snippet.header).toBe(header);
    },
  );

  it("leaves out what Jira sends as null or as an empty list", async () => {
    const snippet = requireSnippet(
      await readRecorded(
        "issue-empty-description.json",
        makeReference("ACME-3"),
      ),
    );
    expect(snippet.header).toBe(
      "Issue with no description · Backlog · Task · Medium · ACME-3",
    );
  });

  it("reads an issue written in Jira's editor", async () => {
    const snippet = requireSnippet(
      await readRecorded(
        "issue-written-in-the-editor.json",
        makeReference("ACME-6"),
      ),
    );
    expect(snippet.header).toBe(
      "Testing123 · Backlog · Task · Medium · ACME-6",
    );
    expect(snippet.text).toBe(EDITOR_BODY);
  });

  it.each([EVERY_NODE, "issue-written-in-the-editor.json"])(
    "passes on no account id and no email from %s",
    async (fixtureName) => {
      const snippet = requireSnippet(await readRecorded(fixtureName));
      const passedOn = JSON.stringify(snippet);

      expect(readFixture(fixtureName)).toContain(PLACEHOLDER_ACCOUNT_ID);
      expect(passedOn).not.toContain(PLACEHOLDER_ACCOUNT_ID);
      expect(passedOn).not.toContain(PLACEHOLDER_EMAIL);
    },
  );
});

describe("the Jira read's body", () => {
  it("is empty for an issue with no description and no parent", async () => {
    const snippet = requireSnippet(
      await readRecorded(
        "issue-empty-description.json",
        makeReference("ACME-3"),
      ),
    );
    expect(snippet.text).toBe("");
  });

  it("is empty for a top-level epic, which has no parent line", async () => {
    const snippet = requireSnippet(
      await readRecorded("issue-parent-epic.json", makeReference("ACME-1")),
    );
    expect(snippet.text).toBe("");
    expect(snippet.header).toBe(
      "Checkout rework · Backlog · Epic · Medium · ACME-1",
    );
  });

  it("is the parent line alone for a child with no description", async () => {
    const body = makeIssueBody(EVERY_NODE, (fields) => {
      fields["description"] = null;
    });
    const snippet = requireSnippet(await readThrough({ status: 200, body }));
    expect(snippet.text).toBe(PARENT_LINE);
  });

  it.each([
    ["in a project the repository does not list", "HR-1"],
    ["under a key that is not an issue key", "HR-1/../ACME-1"],
  ])("passes on nothing of a parent %s", async (_where, parentKey) => {
    const body = makeIssueBody(EVERY_NODE, (fields) => {
      fields["description"] = null;
      fields["parent"] = {
        key: parentKey,
        fields: { summary: "Salary review" },
      };
    });
    const snippet = requireSnippet(await readThrough({ status: 200, body }));
    expect(snippet.text).toBe("");
    expect(snippet.header).not.toContain("Salary review");
  });

  it("writes a listed parent's key upper-case", async () => {
    const body = makeIssueBody(EVERY_NODE, (fields) => {
      fields["description"] = null;
      fields["parent"] = {
        key: "web-9",
        fields: { summary: "Storefront" },
      };
    });
    const snippet = requireSnippet(await readThrough({ status: 200, body }));
    expect(snippet.text).toBe("Parent: WEB-9 Storefront");
  });

  it("cuts the longest description Jira allows at the snippet cap", async () => {
    const fixtureName = "issue-longest-description.json";
    const written = `${LONGEST_LINE}\n`.repeat(LONGEST_LINES_UNDER_CAP);
    const snippet = requireSnippet(
      await readRecorded(fixtureName, makeReference("ACME-5")),
    );

    expect(written).toHaveLength(MAX_SNIPPET_CHARS);
    expect(readFixture(fixtureName)).toContain(
      JSON.stringify(written).slice(1, -1),
    );
    expect(snippet.text).toBe(written);
  });

  it("counts the parent line inside the cap", async () => {
    const body = makeIssueBody("issue-longest-description.json", (fields) => {
      fields["parent"] = {
        key: "ACME-1",
        fields: { summary: "Checkout rework" },
      };
    });
    const snippet = requireSnippet(
      await readThrough({ status: 200, body }, makeReference("ACME-5")),
    );

    expect(snippet.text).toHaveLength(MAX_SNIPPET_CHARS);
    expect(snippet.text.startsWith(`${PARENT_LINE}\n\nword word`)).toBe(true);
  });

  it("logs nothing for a description it has a rule for throughout", async () => {
    const { logs } = await readRecorded(EVERY_NODE);
    expect(logs).toEqual([]);
  });

  it("logs the unknown node types once, by name alone", async () => {
    const macro = { type: "extension", attrs: { text: "macro body" } };
    const column = {
      type: "layoutColumn",
      content: [{ type: "paragraph", content: [macro, macro] }],
    };
    const layout = { type: "layoutSection", content: [column, column] };
    const { result, logs } = await readThrough(
      makeDescribedIssue([layout, layout]),
      makeReference("ACME-3"),
    );

    const line = "macro bodymacro body";
    expect(result.ok && result.value.text).toBe(
      [line, line, line, line].join("\n"),
    );
    expect(logs).toEqual([
      "jira: ACME-3 description holds node types this read has no rule for: layoutSection, layoutColumn, extension",
    ]);
  });
});

describe("the Jira read's returned key", () => {
  const MOVED = "issue-moved-to-another-project.json";

  it("reads an issue moved to a listed project under its new key", async () => {
    const outcome = await readRecorded(MOVED, makeReference("ACME-4"));

    expect(outcome.calls[1]?.url).toContain("/issue/ACME-4?");
    expect(requireSnippet(outcome)).toMatchObject({
      key: "WEB-1",
      source: "https://acme.atlassian.net/browse/WEB-1",
      title: "Issue that moves to another project",
      header:
        "Issue that moves to another project · Backlog · Task · Medium · WEB-1",
      text: "Created in ACME, then moved to WEB.",
    });
  });

  it("answers not-found for an issue moved to an unlisted project", async () => {
    const reference = makeReference("ACME-4", { projectKeys: ["ACME", "OPS"] });
    const { result, logs } = await readRecorded(MOVED, reference);

    expect(result).toEqual({
      ok: false,
      error: {
        reason: TicketUnreadReasons.NOT_FOUND,
        detail: "the issue now sits in a project this repository does not list",
      },
    });
    expect(logs).toEqual([]);
  });

  it.each([
    ["no listed project keys", undefined],
    ["an empty list of project keys", []],
  ])(
    "fails closed on a reference with %s, asking nothing",
    async (_label, keys) => {
      const { projectKeys: _listed, ...bare } = makeReference("ACME-2");
      const reference =
        keys === undefined ? bare : { ...bare, projectKeys: keys };
      const { result, calls } = await readRecorded(EVERY_NODE, reference);

      expect(result).toEqual({
        ok: false,
        error: {
          reason: TicketUnreadReasons.NOT_FOUND,
          detail: "the reference carries no listed jira project",
        },
      });
      expect(calls).toEqual([]);
    },
  );

  it.each([
    ["a path", "WEB-1/../../secure/admin"],
    ["a query", "WEB-1?next=ACME-2"],
    ["no number", "WEB"],
  ])("answers not-found for a returned key holding %s", async (_label, key) => {
    const body = makeIssueBody(EVERY_NODE, () => undefined, key);
    const { result } = await readThrough({ status: 200, body });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: TicketUnreadReasons.NOT_FOUND,
        detail: "jira answered under a key that is not an issue key",
      },
    });
  });

  it("lists a returned project key whatever its case", async () => {
    const body = makeIssueBody(EVERY_NODE, () => undefined, "web-7");
    const snippet = requireSnippet(await readThrough({ status: 200, body }));

    expect(snippet.key).toBe("WEB-7");
    expect(snippet.source).toBe("https://acme.atlassian.net/browse/WEB-7");
  });
});

describe("the Jira read's failures", () => {
  const NOT_FOUND_BODY = readFixture("error-404-hidden-or-missing.json");

  it.each([
    [
      "a refused credential",
      { status: 401, body: readFixture("error-401-bad-credential.json") },
      TicketUnreadReasons.NO_CREDENTIAL,
      "jira answered 401",
    ],
    [
      "a forbidden issue",
      { status: 403, body: "" },
      TicketUnreadReasons.NO_CREDENTIAL,
      "jira answered 403",
    ],
    [
      "a hidden or missing issue",
      { status: 404, body: NOT_FOUND_BODY },
      TicketUnreadReasons.NOT_FOUND,
      "jira answered 404",
    ],
    [
      "a rate limit",
      { status: 429, body: "" },
      TicketUnreadReasons.RATE_LIMITED,
      "jira answered 429",
    ],
    [
      "a server error",
      { status: 503, body: "" },
      TicketUnreadReasons.TIMEOUT,
      "jira answered 503",
    ],
    [
      "an unreachable site",
      stubUnreachableFetch(),
      TicketUnreadReasons.TIMEOUT,
      "jira unreachable",
    ],
  ])(
    "passes on %s with its reason and detail",
    async (_label, api, reason, detail) => {
      const { result, logs, calls } = await readThrough(api);

      expect(result).toEqual({ ok: false, error: { reason, detail } });
      expect(logs).toEqual([]);
      expect(calls).toHaveLength(2);
    },
  );

  it("warns once when the remembered cloud id names no site", async () => {
    const { result, logs } = await readThrough({
      status: 404,
      body: readFixture("error-404-wrong-cloud-id.json"),
      failureCategory: "FAILURE_CLIENT_TCS",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: TicketUnreadReasons.TIMEOUT,
        detail: "jira knows no site for this cloud id",
      },
    });
    expect(logs).toEqual([UNKNOWN_CLOUD_ID_LINE]);
  });

  it("keeps the credential and the cloud id out of that warning", async () => {
    const { logs } = await readThrough({
      status: 404,
      body: readFixture("error-404-wrong-cloud-id.json"),
    });
    const line = logs.join("\n");

    expect(logs).toHaveLength(1);
    for (const secret of [EMAIL, TOKEN, BASIC_CREDENTIAL, CLOUD_ID]) {
      expect(line).not.toContain(secret);
    }
  });
});

describe("the Jira read's budget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up after the transport's budget", async () => {
    const { fetch } = stubSiteFetch(stubStalledFetch());
    const result = await makeRead(fetch, 20).readPrimary(
      makeReference("ACME-2"),
      { log: () => undefined, signal: new AbortController().signal },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        reason: TicketUnreadReasons.TIMEOUT,
        detail: "no answer within 20 ms",
      },
    });
  });

  it("gives up when the fan-out aborts first", async () => {
    const controller = new AbortController();
    const { fetch } = stubSiteFetch(stubStalledFetch());
    const pending = makeRead(fetch, 60_000).readPrimary(
      makeReference("ACME-2"),
      { log: () => undefined, signal: controller.signal },
    );
    controller.abort();

    expect(await pending).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT },
    });
  });

  it("gives up at once under a signal that has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch } = stubSiteFetch(stubStalledFetch());
    const result = await makeRead(fetch, 60_000).readPrimary(
      makeReference("ACME-2"),
      { log: () => undefined, signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { reason: TicketUnreadReasons.TIMEOUT },
    });
  });

  it("leaves no timer running after a read that answered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { fetch } = stubSiteFetch({
      status: 200,
      body: readFixture(EVERY_NODE),
    });
    const result = await makeRead(fetch, 60_000).readPrimary(
      makeReference("ACME-2"),
      { log: () => undefined, signal: new AbortController().signal },
    );

    expect(result.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
