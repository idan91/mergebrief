import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildContextQuery,
  JiraTransports,
  resolveTrackerReads,
  type PrimarySnippet,
} from "brief-core";
import type {
  Brief,
  IntentCheck,
  IntentItem,
  TicketAlignment,
} from "brief-core/types";
import {
  ContextSourceTypes,
  DEFAULT_JIRA_EMAIL_ENV,
  DEFAULT_JIRA_TOKEN_ENV,
  type ContextSourcesConfig,
} from "generators";
import type { TrackerConfig } from "generators/trackers";
import { TicketTrackers } from "types/trackers";
import { loadCases, type EvalCase } from "../eval/loadCase";
import { scoreRuns } from "../eval/properties";
import {
  ISSUE_TITLE,
  ISSUE_URL,
} from "../eval/cases/intent-jira-primary/expected";
import { makeBrief } from "./eval-fixtures";

const CASES_DIR = fileURLToPath(new URL("../eval/cases", import.meta.url));
const CASE_ID = "intent-jira-primary";
const PRECISE_CASE_ID = "intent-precise-ticket";
const ISSUE_RESPONSE_URL = new URL(
  "../eval/cases/intent-jira-primary/jira-issue.json",
  import.meta.url,
);

const SITE = "acme.atlassian.net";
const CLOUD_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_INFO_URL = `https://${SITE}/_edge/tenant_info`;
const ISSUE_API_PREFIX = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/issue/DS-42?`;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const JIRA_TRACKERS: TrackerConfig[] = [
  { kind: TicketTrackers.JIRA, projectKeys: ["DS"] },
];
const CONTEXT_SOURCES: ContextSourcesConfig = [
  { type: ContextSourceTypes.JIRA, site: SITE },
];
const ENV = {
  [DEFAULT_JIRA_EMAIL_ENV]: "reader@example.invalid",
  [DEFAULT_JIRA_TOKEN_ENV]: "placeholder-jira-token",
};

const PRECISE_TICKET_LINE = "Ticket: https://tasks.example/DS-42";
const JIRA_TICKET_LINE = `Ticket: ${ISSUE_URL}`;
const PARENT_LINE = "Parent: DS-7 Design system components";
const PROPERTY_IDS = [
  "intent-precise",
  "intent-ticket-url-bound",
  "intent-accomplished-anchored",
  "intent-docs-gap-found",
  "intent-alarm-buckets-empty",
  "alignment-partial",
  "alignment-goal-and-response",
  "primary-title-from-header",
];

const DELIVERED_ASK: IntentItem = {
  intent: "Writes the text to the clipboard",
  quote: "Write the given text to the clipboard on click.",
  sourceUrl: ISSUE_URL,
  groupIds: ["g1"],
  acknowledged: false,
};
const MISSING_ASK: IntentItem = {
  intent: "No usage example on the docs site",
  quote: "Add a usage example for the component to the docs site",
  sourceUrl: ISSUE_URL,
  groupIds: [],
  acknowledged: false,
};
const PARTIAL_READ: TicketAlignment = {
  read: "partial",
  goal: "Add a CopyButton component",
  response: "Three of the four asks land.",
};

async function loadCase(id: string): Promise<EvalCase> {
  const loaded = await loadCases(CASES_DIR, id);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  const found = loaded.value[0];
  if (found === undefined) {
    throw new Error(`${id} did not load`);
  }
  return found;
}

async function readFixturePrimary(): Promise<PrimarySnippet> {
  const { fixture } = await loadCase(CASE_ID);
  const outcome = fixture.pr.primaryTicket;
  if (outcome?.status !== "read") {
    throw new Error(`${CASE_ID} carries no read primary`);
  }
  return outcome.snippet;
}

/** The primary reference the production parser finds in the fixture's own PR text. */
async function resolveFixtureReference() {
  const { fixture } = await loadCase(CASE_ID);
  const { locator, meta } = fixture.pr;
  const query = buildContextQuery({
    title: meta.title,
    body: meta.body,
    branch: "",
    repo: { owner: locator.owner, repo: locator.repo },
    trackers: JIRA_TRACKERS,
    readable: [TicketTrackers.JIRA],
    contextSources: CONTEXT_SOURCES,
  });
  if (query.primary === undefined) {
    throw new Error(`${CASE_ID} PR text names no primary ticket`);
  }
  return query.primary;
}

/** The site's tenant info and the case's issue response; any other URL is not found. */
async function answerJira(url: string): Promise<Response> {
  if (url === TENANT_INFO_URL) {
    const tenantInfo = JSON.stringify({ cloudId: CLOUD_ID });
    return new Response(tenantInfo, { status: HTTP_OK });
  }
  if (url.startsWith(ISSUE_API_PREFIX)) {
    const issue = readFileSync(ISSUE_RESPONSE_URL, "utf8");
    return new Response(issue, { status: HTTP_OK });
  }
  return new Response(null, { status: HTTP_NOT_FOUND });
}

/** The case's issue response, read through the production Jira read over the real HTTP transport. */
async function readIssueThroughJira(): Promise<PrimarySnippet> {
  const reads = resolveTrackerReads(JIRA_TRACKERS, {
    env: ENV,
    contextSources: CONTEXT_SOURCES,
    transports: { jira: JiraTransports.HTTP.create({ fetch: answerJira }) },
  });
  const jira = reads.ok ? reads.value.jira : undefined;
  if (jira === undefined) {
    throw new Error("no Jira read at the stub root");
  }

  const reference = await resolveFixtureReference();
  const deps = { log: () => {}, signal: new AbortController().signal };
  const read = await jira.readPrimary(reference, deps);
  if (!read.ok) {
    throw new Error(read.error.detail);
  }
  return read.value;
}

function makeIntentCheck(overrides: Partial<IntentCheck> = {}): IntentCheck {
  return {
    ticketUrls: [ISSUE_URL],
    ticketTitles: [ISSUE_TITLE],
    specificity: "precise",
    scopeNote: "",
    accomplished: [DELIVERED_ASK],
    statedButMissing: [MISSING_ASK],
    doneButUnstated: [],
    deviations: [],
    maskedFixes: [],
    alignment: PARTIAL_READ,
    ...overrides,
  };
}

async function scorePasses(brief: Brief): Promise<number[]> {
  const { properties } = await loadCase(CASE_ID);
  const scored = scoreRuns(properties, [brief]);
  return PROPERTY_IDS.map((id) => scored.scores.get(id)?.passes ?? -1);
}

describe("the jira primary case fixture", () => {
  it("names the issue in its PR text where the parser finds it", async () => {
    const reference = await resolveFixtureReference();

    expect(reference.tracker).toBe(TicketTrackers.JIRA);
    expect(reference.key).toBe("DS-42");
    expect(reference.url).toBe(ISSUE_URL);
    expect(reference.foundIn).toBe("description");
  });

  it("carries the primary the Jira read produces for its issue", async () => {
    const primary = await readFixturePrimary();
    const read = await readIssueThroughJira();

    expect({
      source: primary.source,
      tracker: primary.tracker,
      key: primary.key,
      title: primary.title,
      header: primary.header,
      text: primary.text,
    }).toEqual({
      source: read.source,
      tracker: read.tracker,
      key: read.key,
      title: read.title,
      header: read.header,
      text: read.text,
    });
  });

  it("leads the body with the parent line and keeps the title out", async () => {
    const primary = await readFixturePrimary();

    expect(primary.title).toBe(ISSUE_TITLE);
    expect(primary.text.startsWith(`${PARENT_LINE}\n\n`)).toBe(true);
    expect(primary.text).not.toContain(ISSUE_TITLE);
    expect(primary.header).toBe(
      `${ISSUE_TITLE} · In Progress · Story · Medium · Test User · design-system, frontend · DS-42`,
    );
  });

  it("holds the precise-ticket PR apart from its ticket line", async () => {
    const jira = await loadCase(CASE_ID);
    const precise = await loadCase(PRECISE_CASE_ID);
    const { primaryTicket: _jiraTicket, ...jiraPr } = jira.fixture.pr;
    const { primaryTicket: _preciseTicket, ...precisePr } = precise.fixture.pr;
    const preciseBody = precisePr.meta.body.replace(
      PRECISE_TICKET_LINE,
      JIRA_TICKET_LINE,
    );

    expect(precisePr.meta.body).toContain(PRECISE_TICKET_LINE);
    expect(jiraPr).toEqual({
      ...precisePr,
      meta: { ...precisePr.meta, body: preciseBody },
    });
    expect(jira.fixture.commitRange).toEqual(precise.fixture.commitRange);
  });
});

describe("the jira primary case properties", () => {
  it("pass a partial precise read titled by the summary alone", async () => {
    const brief = makeBrief({ intentCheck: makeIntentCheck() });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("fail the precise property on a broad read", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ specificity: "broad" }),
    });

    expect(await scorePasses(brief)).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("fail the url property when an invented ticket URL rides along", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({
        ticketUrls: [ISSUE_URL, "https://tasks.example/DS-42"],
        ticketTitles: [ISSUE_TITLE, ""],
      }),
    });

    expect(await scorePasses(brief)).toEqual([1, 0, 1, 1, 1, 1, 1, 1]);
  });

  it("fail the anchored property when an accomplished ask cites no group", async () => {
    const unanchored = { ...DELIVERED_ASK, groupIds: [] };
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ accomplished: [unanchored] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 1, 0, 1, 1, 1, 1, 1]);
  });

  it("fail the docs property when the docs-site ask is not missing", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ statedButMissing: [] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 0, 1, 1, 1, 1]);
  });

  it("fail the alarm property when a deviation fires", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ deviations: [DELIVERED_ASK] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 1, 0, 1, 1, 1]);
  });

  it("fail the partial property on an aligned read", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({
        alignment: { ...PARTIAL_READ, read: "aligned" },
      }),
    });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 1, 1, 0, 1, 1]);
  });

  it("fail both alignment properties when the validator dropped the read", async () => {
    const { alignment: _dropped, ...withoutAlignment } = makeIntentCheck();
    const brief = makeBrief({ intentCheck: withoutAlignment });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 1, 1, 0, 0, 1]);
  });

  it("fail the title property when the title is the whole header line", async () => {
    const primary = await readFixturePrimary();
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ ticketTitles: [primary.header] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 1, 1, 1, 1, 0]);
  });

  it("fail the title property when the title is the parent line", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ ticketTitles: [PARENT_LINE] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 1, 1, 1, 1, 0]);
  });

  it("fail the title and url properties when the issue is not cited", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ ticketUrls: [], ticketTitles: [] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 0, 1, 1, 1, 1, 1, 0]);
  });
});
