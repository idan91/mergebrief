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
      { ...BRIEF, databaseId: "3935e940-0eeb-80b0-ad46-000b1ce17b37" },
      { kind: "github", issuesRepo: "acme/tracker" },
    ]);
    expect(result.ok && result.value[0]).toMatchObject({
      databaseId: "3935e9400eeb80b0ad46000b1ce17b37",
    });
  });

  it.each([
    ["an empty list", []],
    ["a non-list", { kind: "github" }],
    ["two github entries", [{ kind: "github" }, { kind: "github" }]],
    ["one prefix on two boards", [BRIEF, { ...DS, keyPrefix: "brief" }]],
    ["an unknown kind", [{ kind: "jira", keyPrefix: "X" }]],
  ])("refuses %s", (_label, block) => {
    expect(validateTrackersBlock(block).ok).toBe(false);
  });
});
