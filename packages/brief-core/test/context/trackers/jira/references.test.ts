import { describe, expect, it } from "vitest";
import {
  canonicalizeJiraUrl,
  collectJiraReferences,
} from "../../../../src/context/trackers/jira/references";
import type { TicketReferenceInput } from "../../../../src/context/trackers/types";
import {
  ReferenceLocations,
  type ReferenceLocation,
} from "../../../../src/types";
import { JIRA_ISSUE_URL, JIRA_SITE, JIRA_TRACKER } from "../../helpers";

/** What every Jira reference of this repository carries besides its key and URL. */
const JIRA_REFERENCE_FIELDS = {
  tracker: "jira" as const,
  projectKeys: JIRA_TRACKER.projectKeys,
};

function makeInput(
  overrides: Partial<TicketReferenceInput> = {},
): TicketReferenceInput {
  return {
    title: "",
    body: "",
    branch: "",
    repo: { owner: "acme", repo: "widget" },
    trackers: [JIRA_TRACKER],
    readable: [],
    ...overrides,
  };
}

/** Dana's deployment: the instance config names the site and Jira is readable. */
function makeSiteInput(
  overrides: Partial<TicketReferenceInput> = {},
): TicketReferenceInput {
  return makeInput({ readable: ["jira"], jiraSite: JIRA_SITE, ...overrides });
}

function collectUrls(
  text: string,
  input: TicketReferenceInput = makeSiteInput(),
  location: ReferenceLocation = ReferenceLocations.DESCRIPTION,
): string[] {
  return collectJiraReferences(text, location, input).map(
    (hit) => hit.reference.url,
  );
}

function collectKeys(
  text: string,
  location: ReferenceLocation = ReferenceLocations.DESCRIPTION,
  input: TicketReferenceInput = makeInput(),
): string[] {
  return collectJiraReferences(text, location, input).map(
    (hit) => hit.reference.key,
  );
}

describe("collectJiraReferences", () => {
  it("reads a listed project's key as a jira reference with no URL yet", () => {
    expect(
      collectJiraReferences(
        "Fixes ACME-12",
        ReferenceLocations.DESCRIPTION,
        makeInput(),
      ),
    ).toEqual([
      {
        index: 6,
        reference: { ...JIRA_REFERENCE_FIELDS, key: "ACME-12", url: "" },
      },
    ]);
  });

  it("carries every listed project key on a key and on a link alike", () => {
    const trackers = [
      { kind: "jira" as const, projectKeys: ["ACME"] },
      { kind: "github" as const },
      { kind: "jira" as const, projectKeys: ["WEB", "OPS"] },
    ];
    const hits = collectJiraReferences(
      `ACME-12 and ${JIRA_ISSUE_URL}`,
      ReferenceLocations.DESCRIPTION,
      makeSiteInput({ trackers }),
    );
    expect(hits.map((hit) => hit.reference.projectKeys)).toEqual([
      ["ACME", "WEB", "OPS"],
      ["ACME", "WEB", "OPS"],
    ]);
  });

  it.each([
    ReferenceLocations.DESCRIPTION,
    ReferenceLocations.TITLE,
    ReferenceLocations.BRANCH,
  ])("counts a key in the %s", (location) => {
    expect(collectKeys("WEB-40 and ACME-12", location)).toEqual([
      "WEB-40",
      "ACME-12",
    ]);
  });

  it("leaves an unlisted project's key as text", () => {
    expect(collectKeys("HR-7 then ACME-12")).toEqual(["ACME-12"]);
  });

  it("stores a lower-case key upper-case", () => {
    expect(collectKeys("acme-12")).toEqual(["ACME-12"]);
  });

  it("does not count a key inside a link", () => {
    expect(
      collectKeys("see https://acme.atlassian.net/browse/ACME-12 and WEB-3"),
    ).toEqual(["WEB-3"]);
  });

  it.each(["feature/ACME-12-fix-login", "feature/acme-12-fix-login"])(
    "reads the key in the branch %s",
    (branch) => {
      expect(collectKeys(branch, ReferenceLocations.BRANCH)).toEqual([
        "ACME-12",
      ]);
    },
  );

  it("matches nothing when the list names no jira tracker", () => {
    const notion = {
      kind: "notion",
      keyPrefix: "ACME",
      databaseId: "a".repeat(32),
    } as const;
    expect(
      collectKeys(
        "ACME-12",
        ReferenceLocations.DESCRIPTION,
        makeInput({ trackers: [notion] }),
      ),
    ).toEqual([]);
  });
});

describe("collectJiraReferences: the site", () => {
  it("builds a key's URL on the site host when the site is known", () => {
    expect(
      collectJiraReferences(
        "Fixes acme-12",
        ReferenceLocations.DESCRIPTION,
        makeSiteInput(),
      ),
    ).toEqual([
      {
        index: 6,
        reference: {
          ...JIRA_REFERENCE_FIELDS,
          key: "ACME-12",
          url: JIRA_ISSUE_URL,
        },
      },
    ]);
  });

  it("builds a branch key's URL on the site host", () => {
    expect(
      collectUrls(
        "feature/ACME-12-fix-login",
        makeSiteInput(),
        ReferenceLocations.BRANCH,
      ),
    ).toEqual([JIRA_ISSUE_URL]);
  });

  it("keeps a key a reference where jira is not readable", () => {
    expect(collectUrls("ACME-12", makeSiteInput({ readable: [] }))).toEqual([
      JIRA_ISSUE_URL,
    ]);
  });
});

describe("collectJiraReferences: links", () => {
  it("reads an issue link as a reference carrying its key", () => {
    expect(
      collectJiraReferences(
        `see ${JIRA_ISSUE_URL}`,
        ReferenceLocations.DESCRIPTION,
        makeSiteInput(),
      ),
    ).toEqual([
      {
        index: 4,
        reference: {
          ...JIRA_REFERENCE_FIELDS,
          key: "ACME-12",
          url: JIRA_ISSUE_URL,
        },
      },
    ]);
  });

  it.each([
    ["an issue page", "/browse/ACME-12"],
    ["an issue page with a query", "/browse/ACME-12?filter=123"],
    ["an issue page with a fragment", "/browse/ACME-12#comment-4"],
    ["a work management issue", "/jira/core/projects/ACME/issues/ACME-12"],
    [
      "a board's selected issue",
      "/jira/software/projects/ACME/boards/1?selectedIssue=ACME-12",
    ],
    [
      "a backlog's selected issue",
      "/jira/software/c/projects/ACME/boards/1/backlog?selectedIssue=ACME-12",
    ],
    [
      "a list's selected issue",
      "/jira/core/projects/ACME/list?filter=open&selectedIssue=ACME-12",
    ],
    [
      "a service queue issue",
      "/jira/servicedesk/projects/ACME/queues/custom/1/ACME-12",
    ],
    ["a customer portal request", "/servicedesk/customer/portal/3/ACME-12"],
  ])("counts a link to %s", (_form, path) => {
    expect(collectUrls(`https://acme.atlassian.net${path}`)).toEqual([
      JIRA_ISSUE_URL,
    ]);
  });

  it.each([
    ["a project", "/jira/software/projects/ACME/boards/1"],
    ["a project's issue list", "/jira/core/projects/ACME/issues"],
    ["a filter", "/issues/?filter=10001"],
    ["a dashboard", "/jira/dashboards/10000"],
    ["an attachment", "/secure/attachment/10001/ACME-12-design.png"],
    ["the site root", "/"],
  ])("leaves a link to %s as text", (_form, path) => {
    expect(collectUrls(`https://acme.atlassian.net${path}`)).toEqual([]);
  });

  it.each([
    ["another company's site", "https://other.atlassian.net/browse/ACME-12"],
    ["an unlisted custom domain", "https://jira.other.com/browse/ACME-12"],
    [
      "a lookalike host",
      "https://acme.atlassian.net.evil.example/browse/ACME-12",
    ],
    [
      "a host behind userinfo",
      "https://acme.atlassian.net@evil.example/ACME-12",
    ],
    [
      "the site behind userinfo",
      "https://dana@acme.atlassian.net/browse/ACME-12",
    ],
    [
      "the site on another port",
      "https://acme.atlassian.net:8443/browse/ACME-12",
    ],
  ])("leaves a link on %s as text", (_host, url) => {
    expect(collectUrls(`see ${url}`)).toEqual([]);
  });

  it("leaves a link to an unlisted project as text", () => {
    expect(
      collectUrls("https://acme.atlassian.net/browse/HR-7 then WEB-3"),
    ).toEqual(["https://acme.atlassian.net/browse/WEB-3"]);
  });

  it("counts a link on a listed link host under the site host", () => {
    expect(
      collectUrls("https://jira.acme.com/browse/ACME-12?focusedId=1"),
    ).toEqual([JIRA_ISSUE_URL]);
  });

  it.each([
    "https://ACME.Atlassian.NET/browse/ACME-12",
    "HTTPS://JIRA.ACME.COM/browse/ACME-12",
  ])("compares the host without case in %s", (url) => {
    expect(collectUrls(url)).toEqual([JIRA_ISSUE_URL]);
  });

  it("stores a link's lower-case key upper-case", () => {
    expect(
      collectJiraReferences(
        "https://acme.atlassian.net/browse/acme-12",
        ReferenceLocations.DESCRIPTION,
        makeSiteInput(),
      ),
    ).toEqual([
      {
        index: 0,
        reference: {
          ...JIRA_REFERENCE_FIELDS,
          key: "ACME-12",
          url: JIRA_ISSUE_URL,
        },
      },
    ]);
  });

  it("keeps a link key's digits as written", () => {
    expect(collectUrls("https://acme.atlassian.net/browse/ACME-0012")).toEqual([
      "https://acme.atlassian.net/browse/ACME-0012",
    ]);
  });

  it("never counts a link in the branch", () => {
    expect(
      collectUrls(JIRA_ISSUE_URL, makeSiteInput(), ReferenceLocations.BRANCH),
    ).toEqual([]);
  });

  it("counts a link in the title", () => {
    expect(
      collectUrls(JIRA_ISSUE_URL, makeSiteInput(), ReferenceLocations.TITLE),
    ).toEqual([JIRA_ISSUE_URL]);
  });

  it.each([
    ["in a query", `https://evil.example/?u=${JIRA_ISSUE_URL}`],
    ["in a path", `https://evil.example/${JIRA_ISSUE_URL}`],
    ["in a path's parentheses", `https://evil.example/a(${JIRA_ISSUE_URL})`],
    ["glued to a word", `ticket:${JIRA_ISSUE_URL}`],
    ["as a Markdown link's label", `[${JIRA_ISSUE_URL}](https://evil.example)`],
  ])("leaves a link %s as text", (_where, body) => {
    expect(collectUrls(body)).toEqual([]);
  });

  it.each([
    ["before a full stop", `see ${JIRA_ISSUE_URL}.`],
    ["before a comma", `${JIRA_ISSUE_URL}, then the rest`],
    ["in parentheses", `the ticket (${JIRA_ISSUE_URL})`],
    ["as a Markdown link's target", `[the ticket](${JIRA_ISSUE_URL})`],
    ["as an autolink", `<${JIRA_ISSUE_URL}>`],
    ["in strong emphasis", `**${JIRA_ISSUE_URL}**`],
    ["in a table cell", `| T |\n|---|\n|${JIRA_ISSUE_URL}|`],
    [
      "with a selected issue before a full stop",
      "see https://acme.atlassian.net/jira/software/projects/ACME/boards/1?selectedIssue=ACME-12.",
    ],
  ])("counts a link %s", (_where, body) => {
    expect(collectUrls(body)).toEqual([JIRA_ISSUE_URL]);
  });

  it("counts a key in a link's label and its target as hits of one key", () => {
    expect(
      collectKeys(`[ACME-12](${JIRA_ISSUE_URL})`, undefined, makeSiteInput()),
    ).toEqual(["ACME-12", "ACME-12"]);
  });

  it("leaves a link as text where jira is not readable", () => {
    expect(
      collectUrls(
        `${JIRA_ISSUE_URL} for WEB-3`,
        makeSiteInput({ readable: [] }),
      ),
    ).toEqual(["https://acme.atlassian.net/browse/WEB-3"]);
  });

  it("leaves a link as text when the instance names no jira site", () => {
    expect(
      collectJiraReferences(
        `${JIRA_ISSUE_URL} for WEB-3`,
        ReferenceLocations.DESCRIPTION,
        makeInput({ readable: ["jira"] }),
      ),
    ).toEqual([
      {
        index: 46,
        reference: { ...JIRA_REFERENCE_FIELDS, key: "WEB-3", url: "" },
      },
    ]);
  });

  it.each([
    ["a project key alone", "?selectedIssue=ACME"],
    ["a key with a tail", "?selectedIssue=ACME-12-fix"],
    ["two keys", "?selectedIssue=ACME-12,WEB-3"],
    ["an empty value", "?selectedIssue="],
    ["an unlisted project's key", "?selectedIssue=HR-7"],
  ])("leaves a selected issue that is %s as text", (_shape, query) => {
    expect(
      collectUrls(
        `https://acme.atlassian.net/jira/software/projects/ACME/boards/1${query}`,
      ),
    ).toEqual([]);
  });

  it("names the last whole key in the path when segments follow it", () => {
    expect(
      collectUrls("https://acme.atlassian.net/browse/WEB-3/ACME-12/details"),
    ).toEqual([JIRA_ISSUE_URL]);
  });

  it("reads the path's key before the selected issue", () => {
    expect(collectUrls(`${JIRA_ISSUE_URL}?selectedIssue=WEB-3`)).toEqual([
      JIRA_ISSUE_URL,
    ]);
  });

  it("leaves a link text when its path names an unlisted project", () => {
    expect(
      collectUrls(
        "https://acme.atlassian.net/browse/HR-7?selectedIssue=ACME-12",
      ),
    ).toEqual([]);
  });

  it("reads several links in reading order", () => {
    expect(
      collectKeys(
        `${JIRA_ISSUE_URL} https://jira.acme.com/browse/WEB-3 ${JIRA_ISSUE_URL}`,
        undefined,
        makeSiteInput(),
      ),
    ).toEqual(["ACME-12", "WEB-3", "ACME-12"]);
  });
});

describe("canonicalizeJiraUrl", () => {
  const INPUT = { trackers: [JIRA_TRACKER], jiraSite: JIRA_SITE };

  it.each([
    [
      "a query and a fragment",
      "https://acme.atlassian.net/browse/ACME-12?filter=123#comment-4",
    ],
    [
      "a link host and a lower-case key",
      "https://jira.acme.com/browse/acme-12",
    ],
    [
      "a selected issue",
      "https://acme.atlassian.net/jira/software/projects/ACME/boards/1?selectedIssue=ACME-12",
    ],
    [
      "a link host in another case",
      "https://JIRA.acme.com/servicedesk/customer/portal/3/ACME-12",
    ],
    ["a table cell's closing pipe", `${JIRA_ISSUE_URL}|`],
  ])("answers the issue's URL on the site host for %s", (_shape, raw) => {
    expect(canonicalizeJiraUrl(raw, INPUT)).toBe(JIRA_ISSUE_URL);
  });

  it.each([
    ["another site", "https://other.atlassian.net/browse/ACME-12"],
    ["an unlisted project", "https://acme.atlassian.net/browse/HR-7"],
    ["a link naming no issue", "https://acme.atlassian.net/jira/dashboards/1"],
    [
      "a link holding the issue link",
      `https://evil.example/?u=${JIRA_ISSUE_URL}`,
    ],
    ["text that is no URL", "ACME-12"],
  ])("answers nothing for %s", (_shape, raw) => {
    expect(canonicalizeJiraUrl(raw, INPUT)).toBeUndefined();
  });

  it("answers nothing when the instance names no jira site", () => {
    expect(
      canonicalizeJiraUrl(JIRA_ISSUE_URL, { trackers: [JIRA_TRACKER] }),
    ).toBeUndefined();
  });

  it("answers nothing when the repo lists no jira tracker", () => {
    expect(
      canonicalizeJiraUrl(JIRA_ISSUE_URL, {
        trackers: [],
        jiraSite: JIRA_SITE,
      }),
    ).toBeUndefined();
  });
});
