import { describe, expect, it } from "vitest";
import { GenerationFailureCodes } from "types";

import { appI18n } from "../../../../../i18n/I18nProvider";
import { failureLine } from "./utils";

describe("failureLine", () => {
  it("renders real catalog copy for every code, never its key", () => {
    for (const code of Object.values(GenerationFailureCodes)) {
      const rendered = failureLine(appI18n.t, code, "x");
      expect(rendered).not.toBe(`generationError.${code}`);
      expect(rendered.length).toBeGreaterThan(0);
    }
  });

  it("interpolates the detail for the two detail-carrying codes only", () => {
    const withDetail = Object.values(GenerationFailureCodes).filter((code) =>
      failureLine(appI18n.t, code, "SENTINEL").includes("SENTINEL"),
    );
    expect(withDetail.toSorted()).toEqual([
      GenerationFailureCodes.GENERATION_CONFIG,
      GenerationFailureCodes.UNKNOWN,
    ]);
  });

  it("never renders a template with an empty detail hole", () => {
    for (const code of Object.values(GenerationFailureCodes)) {
      for (const detail of [undefined, ""]) {
        const rendered = failureLine(appI18n.t, code, detail);
        expect(rendered.trimEnd()).toBe(rendered);
        expect(rendered).not.toMatch(/[:—]\s*$/);
      }
    }
  });

  it("keeps a detail that arrived with a code this bundle predates", () => {
    expect(failureLine(appI18n.t, undefined, "spend cap reached")).toContain(
      "spend cap reached",
    );
    expect(failureLine(appI18n.t, undefined, undefined)).toBe(
      appI18n.t("pulls.failed.noDetail"),
    );
  });
});
