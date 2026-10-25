import { describe, expect, it } from "vitest";
import {
  GITHUB_LOGIN_MAX_CHARS,
  MAX_TRUSTED_BOTS,
  RepoConfigOutcomes,
  SETTINGS_MAX_BYTES,
} from "../src/constants";
import { validateRepoConfig } from "../src/validate";
import { padYamlToBytes, settingsFile, yaml } from "./helpers";

/**
 * settings.yaml: version-gated, strict, one v1 knob with a default. Byte cap
 * enforced outside Zod; unknown/mistyped keys reject whole.
 */
function validate(content: string) {
  return validateRepoConfig({ settings: settingsFile(content) });
}

function makeBotLogins(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `bot-${index}[bot]`);
}

describe("settings.yaml validation", () => {
  it("applies a valid file and returns the parsed settings", () => {
    const result = validate(yaml({ version: 1, entryCommentOnDrafts: true }));
    expect(result.settings).toEqual({ version: 1, entryCommentOnDrafts: true });
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
  });

  it("applies the default entryCommentOnDrafts=true when omitted", () => {
    const result = validate(yaml({ version: 1 }));
    expect(result.settings).toEqual({
      version: 1,
      entryCommentOnDrafts: true,
    });
  });

  it("rejects an unknown key so a typo cannot silently no-op", () => {
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
      databaseId: "1a2b3c4d5e6f40718293a4b5c6d7e8f9",
    };
    const result = validate(yaml({ version: 1, tracker }));
    expect(result.settings?.tracker).toEqual(tracker);
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
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
        databaseId: "1a2b3c4d5e6f-4071-8293-a4b5c6d7e8f9",
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

  it("applies a trackers list and keeps file order", () => {
    const trackers = [
      { kind: "notion", keyPrefix: "BRIEF", databaseId: "a".repeat(32) },
      { kind: "notion", keyPrefix: "DS", databaseId: "b".repeat(32) },
      { kind: "github", issuesRepo: "acme/tracker" },
    ];
    const result = validate(yaml({ version: 1, trackers }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.settings?.trackers).toEqual(trackers);
    expect(result.settings?.tracker).toBeUndefined();
  });

  it.each([
    [
      "both spellings",
      { tracker: { kind: "github" }, trackers: [{ kind: "github" }] },
    ],
    ["an empty list", { trackers: [] }],
  ])("rejects the whole file for %s", (_label, block) => {
    const result = validate(yaml({ version: 1, ...block }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
    expect(result.settings).toBeUndefined();
  });

  it("applies a trustedBots list and keeps file order", () => {
    const trustedBots = ["renovate[bot]", "dependabot[bot]"];
    const result = validate(yaml({ version: 1, trustedBots }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.settings?.trustedBots).toEqual(trustedBots);
  });

  it.each([
    ["a GitHub App bot login", "renovate[bot]"],
    ["a bot account login with no suffix", "copilot"],
  ])("applies %s", (_label, login) => {
    const result = validate(yaml({ version: 1, trustedBots: [login] }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.settings?.trustedBots).toEqual([login]);
  });

  it.each([
    ["a suffix with no account name", "[bot]"],
    ["an empty login", ""],
    ["an off-charset bot login", "renovate bot[bot]"],
    ["a doubled suffix", "renovate[bot][bot]"],
    [
      "an over-long bot login",
      `${"a".repeat(GITHUB_LOGIN_MAX_CHARS + 1)}[bot]`,
    ],
    ["an over-long login", "a".repeat(GITHUB_LOGIN_MAX_CHARS + 1)],
  ])("rejects the whole file for %s", (_label, login) => {
    const result = validate(
      yaml({ version: 1, trustedBots: ["dependabot[bot]", login] }),
    );
    expect(result.settings).toBeUndefined();
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("stores a mixed-case trustedBots entry lowercased", () => {
    const result = validate(
      yaml({ version: 1, trustedBots: ["Dependabot[bot]", "Copilot"] }),
    );
    expect(result.settings?.trustedBots).toEqual([
      "dependabot[bot]",
      "copilot",
    ]);
  });

  it("stores a trustedBots entry with a mixed-case suffix lowercased", () => {
    const result = validate(
      yaml({ version: 1, trustedBots: ["Renovate[Bot]"] }),
    );
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.settings?.trustedBots).toEqual(["renovate[bot]"]);
  });

  it("applies a bot login at the account name length cap", () => {
    const login = `${"a".repeat(GITHUB_LOGIN_MAX_CHARS)}[bot]`;
    const result = validate(yaml({ version: 1, trustedBots: [login] }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
  });

  it("applies a trustedBots list at exactly the entry cap", () => {
    const trustedBots = makeBotLogins(MAX_TRUSTED_BOTS);
    const result = validate(yaml({ version: 1, trustedBots }));
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.APPLIED);
    expect(result.settings?.trustedBots).toHaveLength(MAX_TRUSTED_BOTS);
  });

  it("rejects the whole file one trustedBots entry past the cap", () => {
    const trustedBots = makeBotLogins(MAX_TRUSTED_BOTS + 1);
    const result = validate(yaml({ version: 1, trustedBots }));
    expect(result.settings).toBeUndefined();
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it.each([
    ["a repeated trusted bot", ["renovate[bot]", "renovate[bot]"]],
    [
      "a trusted bot repeated in another case",
      ["renovate[bot]", "Renovate[bot]"],
    ],
  ])("rejects the whole file for %s", (_label, trustedBots) => {
    const result = validate(yaml({ version: 1, trustedBots }));
    expect(result.settings).toBeUndefined();
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcomes.INVALID);
  });

  it("rejects a misspelled trustedBots key", () => {
    const result = validate(
      yaml({ version: 1, trustedBot: ["renovate[bot]"] }),
    );
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

  it("warns and stays applied when nearing 80% of the cap", () => {
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
