import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveTrackerReads, type PrimarySnippet } from "brief-core";
import type { Brief, IntentCheck } from "brief-core/types";
import { loadCases } from "../eval/loadCase";
import { scoreRuns } from "../eval/properties";
import {
  ISSUE_TITLE,
  ISSUE_URL,
} from "../eval/cases/intent-github-primary/expected";
import { makeBrief } from "./eval-fixtures";

const CASES_DIR = fileURLToPath(new URL("../eval/cases", import.meta.url));
const CASE_ID = "intent-github-primary";
const ISSUE_NUMBER = 42;
const ISSUE_LABELS = ["enhancement", "design-system"];
const PROPERTY_IDS = [
  "intent-precise",
  "intent-ticket-url-bound",
  "alignment-goal-verifies",
  "primary-title-from-header",
];

async function loadCase() {
  const loaded = await loadCases(CASES_DIR, CASE_ID);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  const found = loaded.value[0];
  if (found === undefined) {
    throw new Error(`${CASE_ID} did not load`);
  }
  return found;
}

async function readFixturePrimary(): Promise<PrimarySnippet> {
  const { fixture } = await loadCase();
  const outcome = fixture.pr.primaryTicket;
  if (outcome?.status !== "read") {
    throw new Error(`${CASE_ID} carries no read primary`);
  }
  return outcome.snippet;
}

/** The issue as GitHub would return it, read through the production GitHub read. */
async function readIssueThroughGitHub(
  title: string,
  body: string,
): Promise<PrimarySnippet> {
  const record = {
    title,
    state: "open",
    stateReason: null,
    labels: ISSUE_LABELS,
    milestone: null,
    body,
    isPullRequest: false,
  };
  const reads = resolveTrackerReads([], {
    env: {},
    contextSources: [],
    transports: {
      github: { readIssue: async () => ({ ok: true, value: record }) },
    },
  });
  const github = reads.ok ? reads.value.github : undefined;
  if (github === undefined) {
    throw new Error("no GitHub read at the stub root");
  }

  const reference = {
    tracker: "github",
    key: "",
    number: ISSUE_NUMBER,
    url: ISSUE_URL,
    foundIn: "description",
    closing: true,
  } as const;
  const deps = { log: () => {}, signal: new AbortController().signal };
  const read = await github.readPrimary(reference, deps);
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
    accomplished: [],
    statedButMissing: [],
    doneButUnstated: [],
    deviations: [],
    maskedFixes: [],
    alignment: {
      read: "partial",
      goal: "Add a CopyButton component",
      response: "Three of the four asks land.",
    },
    ...overrides,
  };
}

async function scorePasses(brief: Brief): Promise<number[]> {
  const { properties } = await loadCase();
  const scored = scoreRuns(properties, [brief]);
  return PROPERTY_IDS.map((id) => scored.scores.get(id)?.passes ?? -1);
}

describe("the github primary case fixture", () => {
  it("carries the primary the GitHub read produces for its issue", async () => {
    const primary = await readFixturePrimary();
    const read = await readIssueThroughGitHub(primary.title, primary.text);

    expect({
      tracker: primary.tracker,
      key: primary.key,
      title: primary.title,
      header: primary.header,
      text: primary.text,
    }).toEqual({
      tracker: read.tracker,
      key: read.key,
      title: read.title,
      header: read.header,
      text: read.text,
    });
    expect(primary.source).toBe(ISSUE_URL);
  });

  it("keeps the title out of the body and leads the header with it", async () => {
    const primary = await readFixturePrimary();

    expect(primary.title).toBe(ISSUE_TITLE);
    expect(primary.text).not.toContain(ISSUE_TITLE);
    expect(primary.header).toBe(
      `${ISSUE_TITLE} · open · enhancement, design-system`,
    );
  });
});

describe("the github primary case properties", () => {
  it("pass a precise read titled by the issue title alone", async () => {
    const brief = makeBrief({ intentCheck: makeIntentCheck() });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 1]);
  });

  it("fail the precise property on a broad read", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ specificity: "broad" }),
    });

    expect(await scorePasses(brief)).toEqual([0, 1, 1, 1]);
  });

  it("fail the url property when an invented ticket URL rides along", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({
        ticketUrls: [ISSUE_URL, "https://github.com/acme/components/issues/7"],
        ticketTitles: [ISSUE_TITLE, ""],
      }),
    });

    expect(await scorePasses(brief)).toEqual([1, 0, 1, 1]);
  });

  it("fail the alignment property when the validator dropped the read", async () => {
    const { alignment: _dropped, ...withoutAlignment } = makeIntentCheck();
    const brief = makeBrief({ intentCheck: withoutAlignment });

    expect(await scorePasses(brief)).toEqual([1, 1, 0, 1]);
  });

  it("fail the title property when the title is the whole header line", async () => {
    const primary = await readFixturePrimary();
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ ticketTitles: [primary.header] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 0]);
  });

  it("fail the title property when the model shows no title", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ ticketTitles: [""] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 1, 1, 0]);
  });

  it("fail the title and url properties when the issue is not cited", async () => {
    const brief = makeBrief({
      intentCheck: makeIntentCheck({ ticketUrls: [], ticketTitles: [] }),
    });

    expect(await scorePasses(brief)).toEqual([1, 0, 1, 0]);
  });
});
