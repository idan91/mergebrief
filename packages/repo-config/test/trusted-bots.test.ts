import { describe, expect, it } from "vitest";
import { isTrustedBot } from "../src/trusted-bots";
import { validateRepoConfig } from "../src/validate";
import { settingsFile, yaml } from "./helpers";

function parseSettings(trustedBots?: string[]) {
  const content = yaml({ version: 1, trustedBots });
  return validateRepoConfig({ settings: settingsFile(content) }).settings;
}

describe("isTrustedBot", () => {
  it("matches a listed bot whatever case either side uses", () => {
    const settings = parseSettings(["Dependabot[bot]"]);
    expect(isTrustedBot(settings, "dependabot[bot]")).toBe(true);
    expect(isTrustedBot(settings, "DEPENDABOT[bot]")).toBe(true);
  });

  it("matches a listed bot account whose login has no suffix", () => {
    const settings = parseSettings(["Copilot"]);
    expect(isTrustedBot(settings, "Copilot")).toBe(true);
  });

  it("matches the exact login, never a suffix variant", () => {
    const settings = parseSettings(["dependabot"]);
    expect(isTrustedBot(settings, "dependabot[bot]")).toBe(false);
  });

  it("refuses a bot that is not listed", () => {
    const settings = parseSettings(["renovate[bot]"]);
    expect(isTrustedBot(settings, "dependabot[bot]")).toBe(false);
  });

  it("refuses every bot when settings carry no list", () => {
    const settings = parseSettings();
    expect(isTrustedBot(settings, "renovate[bot]")).toBe(false);
    expect(isTrustedBot(undefined, "renovate[bot]")).toBe(false);
  });
});
