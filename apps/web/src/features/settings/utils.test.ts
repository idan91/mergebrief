import { describe, expect, it } from "vitest";

import { SettingsTabIds, type SettingsTab } from "./types";
import {
  deriveEnabledTabs,
  parseSettingsSearch,
  resolveActiveTab,
} from "./utils";

function stubPanel() {
  return null;
}

const TOKENS: SettingsTab = {
  id: SettingsTabIds.TOKENS,
  labelKey: "shell.settingsTabTokens",
  icon: "terminal",
  Panel: stubPanel,
};
const OPERATOR_ONLY: SettingsTab = {
  ...TOKENS,
  labelKey: "shell.settingsHeading",
  requiresOperator: true,
};

describe("parseSettingsSearch", () => {
  it("reads a known tab", () => {
    expect(parseSettingsSearch({ tab: "tokens" })).toEqual({ tab: "tokens" });
  });

  it("reads an unknown or missing tab as no choice", () => {
    expect(parseSettingsSearch({ tab: "billing" })).toEqual({});
    expect(parseSettingsSearch({})).toEqual({});
  });
});

describe("deriveEnabledTabs", () => {
  it("keeps an Operator-only tab for an Operator", () => {
    expect(deriveEnabledTabs([TOKENS, OPERATOR_ONLY], true)).toEqual([
      TOKENS,
      OPERATOR_ONLY,
    ]);
  });

  it("drops an Operator-only tab for anyone else", () => {
    expect(deriveEnabledTabs([TOKENS, OPERATOR_ONLY], false)).toEqual([TOKENS]);
  });
});

describe("resolveActiveTab", () => {
  it("opens the asked-for tab the viewer may open", () => {
    expect(resolveActiveTab([TOKENS], SettingsTabIds.TOKENS)).toBe(TOKENS);
  });

  it("falls back to the first tab for one the viewer may not open", () => {
    expect(resolveActiveTab([TOKENS], SettingsTabIds.INSTANCE)).toBe(TOKENS);
  });

  it("refuses a registry with no tab the viewer may open", () => {
    expect(() => resolveActiveTab([], undefined)).toThrow("no tab is enabled");
  });

  it("falls back to the first tab when nothing is asked for", () => {
    expect(resolveActiveTab([TOKENS], undefined)).toBe(TOKENS);
  });
});
