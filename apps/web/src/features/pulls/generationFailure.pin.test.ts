// Drift pins for the generation-failure vocabulary. The web mirror is
// hand-rolled (modeled data inside a 200, so it never rides the wire-error
// contract): these are what catch a code added on one side alone.
import { describe, expect, it } from "vitest";
import { GenerationFailureCodes as SharedGenerationFailureCodes } from "types/generations";

import { appI18n } from "../../i18n/I18nProvider";
import { failureLine } from "./components/PrBrief/FailedCard/utils";
import { GenerationFailureCodes } from "./types";

describe("generation-failure vocabulary", () => {
  it("mirrors the types package vocabulary exactly, both directions", () => {
    expect(Object.values(GenerationFailureCodes).toSorted()).toEqual(
      Object.values(SharedGenerationFailureCodes).toSorted(),
    );
  });

  it("every code renders real catalog copy, not its key", () => {
    for (const code of Object.values(GenerationFailureCodes)) {
      const rendered = failureLine(appI18n.t, code, "x");
      // i18next echoes the key when the entry is missing.
      expect(rendered).not.toBe(`generationError.${code}`);
      expect(rendered.length).toBeGreaterThan(0);
    }
  });

  it("only the two detail-carrying codes interpolate {{detail}}", () => {
    const withDetail = Object.values(GenerationFailureCodes).filter((code) =>
      failureLine(appI18n.t, code, "SENTINEL").includes("SENTINEL"),
    );
    expect(withDetail.toSorted()).toEqual(["generation-config", "unknown"]);
  });

  it("never renders a template with an empty detail hole", () => {
    for (const code of Object.values(GenerationFailureCodes)) {
      for (const detail of [null, ""]) {
        const rendered = failureLine(appI18n.t, code, detail);
        expect(rendered.trimEnd()).toBe(rendered);
        expect(rendered).not.toMatch(/[:\u2014]\s*$/);
      }
    }
  });

  it("keeps a detail that arrived with a code this bundle predates", () => {
    expect(failureLine(appI18n.t, null, "spend cap reached")).toContain(
      "spend cap reached",
    );
    expect(failureLine(appI18n.t, null, null)).toBe(
      appI18n.t("pulls.failed.noDetail"),
    );
  });
});
