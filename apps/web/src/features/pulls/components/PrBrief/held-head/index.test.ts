import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../../i18n/I18nProvider";
import { splitUnmetConditions } from "@web/utils/unmet-conditions";
import { UnmetFixtures } from "@web/test/unmet-conditions";
import { readHeldLead } from ".";

const t = appI18n.t;
const { CI_RUNNING, LABELS } = UnmetFixtures;

describe("readHeldLead", () => {
  it("says the head generates by itself when everything waits", () => {
    const lead = readHeldLead(t, splitUnmetConditions([CI_RUNNING]), false);

    expect(lead).toBe("It generates by itself once these finish.");
  });

  it("says a change is needed when anything needs one", () => {
    const split = splitUnmetConditions([CI_RUNNING, LABELS]);

    expect(readHeldLead(t, split, false)).toBe(
      "It won't generate by itself until the changes below are made.",
    );
  });

  it("falls back to a plain line when no condition is known", () => {
    expect(readHeldLead(t, splitUnmetConditions([]), false)).toBe(
      "Its trigger conditions are not met yet.",
    );
  });

  it("falls back to the plain line when the list was read in part", () => {
    const split = splitUnmetConditions([CI_RUNNING]);

    expect(readHeldLead(t, split, true)).toBe(
      "Its trigger conditions are not met yet.",
    );
  });
});
