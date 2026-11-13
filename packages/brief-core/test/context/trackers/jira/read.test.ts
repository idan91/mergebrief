import { describe, expect, it } from "vitest";
import {
  JiraTransports,
  createJiraRead,
} from "../../../../src/context/trackers/jira";
import type {
  SharedRootDeps,
  TicketReference,
} from "../../../../src/context/trackers/types";
import { TicketUnreadReasons } from "../../../../src/types";

const EMAIL = "dana@acme.com";
const TOKEN = "ATATT3xFfGF0abcDEF123_ghiJKL456=9A8B7C6D";
const SITE = { type: "jira", site: "acme.atlassian.net" } as const;

const SHARED: SharedRootDeps = {
  env: { JIRA_EMAIL: EMAIL, JIRA_API_TOKEN: TOKEN },
  contextSources: [SITE],
};

const REFERENCE: TicketReference = {
  tracker: "jira",
  key: "ACME-12",
  url: "",
  foundIn: "description",
  closing: false,
};

function readRefusal(shared: SharedRootDeps): string {
  const read = createJiraRead(shared, JiraTransports.HTTP.create());
  if (read.ok) {
    throw new Error("expected a refusal");
  }
  return read.error.issues.join("; ");
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
        { ...SITE, emailEnv: "BOT_EMAIL", tokenEnv: "BOT_TOKEN" },
      ],
    };
    expect(createJiraRead(named, JiraTransports.HTTP.create()).ok).toBe(true);
    const text = readRefusal({ ...named, env: { JIRA_EMAIL: EMAIL } });
    expect(text).toContain("BOT_EMAIL");
    expect(text).not.toContain(EMAIL);
  });

  it("answers unread as unsupported without calling Jira", async () => {
    const calls: string[] = [];
    const transport = JiraTransports.HTTP.create({
      fetch: async (url) => {
        calls.push(url);
        throw new Error("must not be called");
      },
    });
    const read = createJiraRead(SHARED, transport);
    if (!read.ok) {
      throw new Error("expected a read");
    }
    expect(read.value.kind).toBe("jira");

    const result = await read.value.readPrimary(REFERENCE, {
      log: () => undefined,
      signal: new AbortController().signal,
    });
    expect(result.ok || result.error.reason).toBe(
      TicketUnreadReasons.UNSUPPORTED,
    );
    expect(calls).toEqual([]);
  });
});
