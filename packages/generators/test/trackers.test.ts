import { describe, expect, it } from "vitest";
import {
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
    ["an unknown kind", [{ kind: "jira", keyPrefix: "X" }]],
    ["a dot-dot issuesRepo", [{ kind: "github", issuesRepo: "o/.." }]],
    ["a dot issuesRepo owner", [{ kind: "github", issuesRepo: "./x" }]],
    ["a non-boolean siblingRepos", [{ kind: "github", siblingRepos: "yes" }]],
    ["siblingRepos on a notion entry", [{ ...BRIEF, siblingRepos: true }]],
  ])("refuses %s", (_label, block) => {
    expect(validateTrackersBlock(block).ok).toBe(false);
  });
});
