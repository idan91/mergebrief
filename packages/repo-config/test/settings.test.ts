import { describe, expect, it } from "vitest";
import { RepoConfigOutcomes, SETTINGS_MAX_BYTES } from "../src/constants";
import { validateRepoConfig } from "../src/validate";
import { padYamlToBytes, settingsFile, yaml } from "./helpers";

/**
 * settings.yaml: version-gated, strict, one v1 knob with a default. Byte cap
 * enforced outside Zod; unknown/mistyped keys reject whole.
 */
function validate(content: string) {
  return validateRepoConfig({ settings: settingsFile(content) });
}

describe("settings.yaml validation", () => {
  it("applies a valid file and returns the parsed settings", () => {
    const result = validate(yaml({ version: 1, entryCommentOnDrafts: true }));
    expect(result.settings).toEqual({ version: 1, entryCommentOnDrafts: true });
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
  });

  it("applies the default entryCommentOnDrafts=false when omitted", () => {
    const result = validate(yaml({ version: 1 }));
    expect(result.settings).toEqual({
      version: 1,
      entryCommentOnDrafts: false,
    });
  });

  it("rejects an unknown key (typo must not silently no-op)", () => {
    const result = validate(yaml({ version: 1, entryCommentOnDraft: true }));
    expect(result.settings).toBeUndefined();
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("rejects an unknown version", () => {
    const result = validate(yaml({ version: 2, entryCommentOnDrafts: true }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("rejects a missing version", () => {
    const result = validate(yaml({ entryCommentOnDrafts: true }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("rejects a non-boolean entryCommentOnDrafts", () => {
    const result = validate(yaml({ version: 1, entryCommentOnDrafts: "yes" }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("applies a notion tracker block", () => {
    const tracker = {
      kind: "notion",
      keyPrefix: "BRIEF",
      databaseId: "3935e9400eeb80b0ad46000b1ce17b37",
    };
    const result = validate(yaml({ version: 1, tracker }));
    expect(result.settings?.tracker).toEqual(tracker);
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
  });

  it("accepts a dashed notion id and stores it bare", () => {
    const tracker = {
      kind: "notion",
      keyPrefix: "BRIEF",
      databaseId: "3935e940-0eeb-80b0-ad46-000b1ce17b37",
    };
    const result = validate(yaml({ version: 1, tracker }));
    expect(result.settings?.tracker).toEqual({
      ...tracker,
      databaseId: "3935e9400eeb80b0ad46000b1ce17b37",
    });
  });

  it("applies a github tracker block with and without issuesRepo", () => {
    expect(
      validate(yaml({ version: 1, tracker: { kind: "github" } })).settings
        ?.tracker,
    ).toEqual({ kind: "github" });
    expect(
      validate(
        yaml({
          version: 1,
          tracker: { kind: "github", issuesRepo: "acme/tracker" },
        }),
      ).settings?.tracker,
    ).toEqual({ kind: "github", issuesRepo: "acme/tracker" });
  });

  it.each([
    ["an unknown kind", { kind: "jira", keyPrefix: "X" }],
    [
      "a notion block missing its database id",
      { kind: "notion", keyPrefix: "BRIEF" },
    ],
    [
      "a bad database id",
      { kind: "notion", keyPrefix: "BRIEF", databaseId: "not-hex" },
    ],
    [
      "a mis-dashed database id",
      {
        kind: "notion",
        keyPrefix: "BRIEF",
        databaseId: "3935e9400eeb-80b0-ad46-000b1ce17b37",
      },
    ],
    [
      "a bad key prefix",
      { kind: "notion", keyPrefix: "BRI EF", databaseId: "a".repeat(32) },
    ],
    ["an unknown tracker key", { kind: "github", issueRepo: "acme/tracker" }],
    ["a bad issuesRepo", { kind: "github", issuesRepo: "acme" }],
  ])("rejects the whole file for %s", (_label, tracker) => {
    const result = validate(yaml({ version: 1, tracker }));
    expect(result.settings).toBeUndefined();
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("applies at exactly the byte cap", () => {
    const content = padYamlToBytes(yaml({ version: 1 }), SETTINGS_MAX_BYTES);
    expect(Buffer.byteLength(content, "utf8")).toBe(SETTINGS_MAX_BYTES);
    const result = validate(content);
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.outcomes[1]?.bytesUsed).toBe(SETTINGS_MAX_BYTES);
    expect(result.outcomes[1]?.bytesBudget).toBe(SETTINGS_MAX_BYTES);
  });

  it("is over-budget one byte past the cap", () => {
    const content = padYamlToBytes(
      yaml({ version: 1 }),
      SETTINGS_MAX_BYTES + 1,
    );
    const result = validate(content);
    expect(result.settings).toBeUndefined();
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.OVER_BUDGET);
    expect(result.outcomes[1]?.bytesUsed).toBe(SETTINGS_MAX_BYTES + 1);
    expect(result.outcomes[1]?.bytesBudget).toBe(SETTINGS_MAX_BYTES);
  });

  it("warns (but stays applied) when nearing the cap (≥80%)", () => {
    const content = padYamlToBytes(
      yaml({ version: 1 }),
      Math.ceil(SETTINGS_MAX_BYTES * 0.85),
    );
    const result = validate(content);
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.outcomes[1]?.warning).toContain("nearing the cap");
  });

  it("does not warn well under the cap", () => {
    const result = validate(yaml({ version: 1 }));
    expect(result.outcomes[1]?.warning).toBeUndefined();
  });
});
