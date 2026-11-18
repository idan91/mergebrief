import { describe, expect, it } from "vitest";
import {
  MAX_JIRA_PROJECT_KEYS,
  resolveEffectiveTrackers,
  resolveTrackerConfigs,
  validateTrackersBlock,
} from "../src/config/trackers";

const BRIEF = {
  kind: "notion",
  keyPrefix: "BRIEF",
  databaseId: "a".repeat(32),
} as const;
const DS = {
  kind: "notion",
  keyPrefix: "DS",
  databaseId: "b".repeat(32),
} as const;

describe("resolveTrackerConfigs", () => {
  it("reads either spelling as one list and none as empty", () => {
    expect(resolveTrackerConfigs(undefined)).toEqual([]);
    expect(resolveTrackerConfigs({})).toEqual([]);
    expect(resolveTrackerConfigs({ tracker: BRIEF })).toEqual([BRIEF]);
    expect(resolveTrackerConfigs({ trackers: [BRIEF, DS] })).toEqual([
      BRIEF,
      DS,
    ]);
  });
});

describe("resolveEffectiveTrackers", () => {
  it("takes the repo's list whole when it names any, else the instance's", () => {
    expect(resolveEffectiveTrackers({ trackers: [DS] }, [BRIEF])).toEqual([DS]);
    expect(resolveEffectiveTrackers({ tracker: DS }, [BRIEF])).toEqual([DS]);
    expect(resolveEffectiveTrackers(undefined, [BRIEF])).toEqual([BRIEF]);
    expect(resolveEffectiveTrackers({ trackers: [] }, [BRIEF])).toEqual([
      BRIEF,
    ]);
  });
});

describe("validateTrackersBlock", () => {
  it("applies a list and normalises a dashed notion id", () => {
    const result = validateTrackersBlock([
      { ...BRIEF, databaseId: "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9" },
      { kind: "github", issuesRepo: "acme/tracker" },
    ]);
    expect(result.ok && result.value.trackers[0]).toMatchObject({
      databaseId: "1a2b3c4d5e6f40718293a4b5c6d7e8f9",
    });
  });

  it("keeps sibling repos off unless the github entry turns them on", () => {
    const off = validateTrackersBlock([{ kind: "github" }]);
    const on = validateTrackersBlock([{ kind: "github", siblingRepos: true }]);
    expect(off.ok && off.value.siblingRepos).toBe(false);
    expect(on.ok && on.value).toEqual({
      trackers: [{ kind: "github" }],
      siblingRepos: true,
    });
  });

  it.each([
    ["an empty list", []],
    ["a non-list", { kind: "github" }],
    ["two github entries", [{ kind: "github" }, { kind: "github" }]],
    ["one prefix on two boards", [BRIEF, { ...DS, keyPrefix: "brief" }]],
    ["an unknown kind", [{ kind: "linear", keyPrefix: "X" }]],
    ["a dot-dot issuesRepo", [{ kind: "github", issuesRepo: "o/.." }]],
    ["a dot issuesRepo owner", [{ kind: "github", issuesRepo: "./x" }]],
    ["a non-boolean siblingRepos", [{ kind: "github", siblingRepos: "yes" }]],
    ["siblingRepos on a notion entry", [{ ...BRIEF, siblingRepos: true }]],
  ])("refuses %s", (_label, block) => {
    expect(validateTrackersBlock(block).ok).toBe(false);
  });
});

const JIRA = { kind: "jira", projectKeys: ["ACME", "WEB"] } as const;

function readIssues(block: unknown): string {
  const result = validateTrackersBlock(block);
  if (result.ok) {
    throw new Error("expected a refusal");
  }
  return result.error.issues.join("; ");
}

function makeProjectKeys(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `P${index}`);
}

describe("validateTrackersBlock: jira", () => {
  it("stores project keys upper-case and passes the entry through whole", () => {
    const result = validateTrackersBlock([
      { kind: "jira", projectKeys: ["acme", "Web"] },
    ]);
    expect(result).toEqual({
      ok: true,
      value: { trackers: [JIRA], siblingRepos: false },
    });
  });

  it("accepts jira beside notion and github, in file order", () => {
    const github = { kind: "github", issuesRepo: "acme/tracker" } as const;
    const result = validateTrackersBlock([BRIEF, JIRA, github]);
    expect(result.ok && result.value.trackers).toEqual([BRIEF, JIRA, github]);
  });

  it("accepts a 255-character key and the most keys an entry holds", () => {
    const longest = `A${"B".repeat(254)}`;
    expect(
      validateTrackersBlock([{ kind: "jira", projectKeys: [longest] }]).ok,
    ).toBe(true);
    const most = makeProjectKeys(MAX_JIRA_PROJECT_KEYS);
    expect(
      validateTrackersBlock([{ kind: "jira", projectKeys: most }]).ok,
    ).toBe(true);
  });

  it.each([
    ["no projectKeys", { kind: "jira" }],
    ["an empty list", { kind: "jira", projectKeys: [] }],
    ["a string for a list", { kind: "jira", projectKeys: "ACME" }],
    ["a keyPrefix", { ...JIRA, keyPrefix: "ACME" }],
    ["a site", { ...JIRA, site: "acme.atlassian.net" }],
    ["a databaseId", { ...JIRA, databaseId: "a".repeat(32) }],
    ["siblingRepos", { ...JIRA, siblingRepos: true }],
    ["a one-character key", { kind: "jira", projectKeys: ["A"] }],
    ["a key with an underscore", { kind: "jira", projectKeys: ["AC_ME"] }],
    ["a key with a hyphen", { kind: "jira", projectKeys: ["AC-ME"] }],
    ["a key with a space", { kind: "jira", projectKeys: ["AC ME"] }],
    ["a key starting with a digit", { kind: "jira", projectKeys: ["1ACME"] }],
    ["a 256-character key", { kind: "jira", projectKeys: ["A".repeat(256)] }],
    ["the any-project star", { kind: "jira", projectKeys: ["*"] }],
    [
      "more keys than an entry holds",
      { kind: "jira", projectKeys: makeProjectKeys(MAX_JIRA_PROJECT_KEYS + 1) },
    ],
  ])("refuses a jira entry with %s", (_label, entry) => {
    expect(validateTrackersBlock([entry]).ok).toBe(false);
  });

  it("refuses a project key listed twice in one entry, compared without case", () => {
    expect(
      readIssues([{ kind: "jira", projectKeys: ["ACME", "WEB", "acme"] }]),
    ).toBe("trackers.0.projectKeys.2: project key ACME is listed twice");
  });

  it("refuses a project key that is a notion prefix on the list", () => {
    const notion = { ...BRIEF, keyPrefix: "Acme" };
    expect(readIssues([notion, JIRA])).toBe(
      "trackers.1.projectKeys.0: project key ACME is already a prefix on another tracker of this list",
    );
    expect(readIssues([JIRA, notion])).toBe(
      "trackers.1.keyPrefix: keyPrefix Acme is already a prefix on another tracker of this list",
    );
  });

  it("keeps the notion message for one prefix on two boards", () => {
    expect(readIssues([BRIEF, { ...DS, keyPrefix: "brief" }])).toBe(
      "trackers.1.keyPrefix: keyPrefix brief names two boards",
    );
  });

  it("refuses two jira entries", () => {
    expect(
      readIssues([JIRA, { kind: "jira", projectKeys: ["OPS"] }]),
    ).toContain("trackers.1: at most one jira tracker");
  });
});
