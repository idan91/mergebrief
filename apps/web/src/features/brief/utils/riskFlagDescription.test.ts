// The three-branch resolver behind every rendered risk implication.
import { describe, expect, it } from "vitest";

import { appI18n } from "../../../i18n/I18nProvider";
import { riskFlagDescription } from "./viewModel";

const t = appI18n.t;

describe("riskFlagDescription", () => {
  it("renders the built-in catalog copy for a built-in attribute", () => {
    const text = riskFlagDescription(t, {
      descriptionKey: "brief.risk.noTests",
    });
    expect(text).toContain("no direct test coverage");
  });

  it("prefers the built-in key over repo criteria when both are present", () => {
    const text = riskFlagDescription(t, {
      descriptionKey: "brief.risk.noTests",
      criteria: "repo words",
    });
    expect(text).toContain("no direct test coverage");
    expect(text).not.toContain("repo words");
  });

  it("passes repo-authored criteria through untranslated", () => {
    expect(
      riskFlagDescription(t, { criteria: "modifies invoicing code" }),
    ).toBe("modifies invoicing code");
  });

  it("falls back to the generic repo-defined line", () => {
    expect(riskFlagDescription(t, {})).toBe(t("brief.risk.repoDefined"));
  });
});
