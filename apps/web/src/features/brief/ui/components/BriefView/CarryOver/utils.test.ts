import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../../../i18n/I18nProvider";
import { getSpanLabel } from "./utils";

describe("getSpanLabel", () => {
  it("states both ends, and counts the revisions past the first", () => {
    expect(getSpanLabel(appI18n.t, "a84c1de0000", "9f2c1aa1111", 1)).toBe(
      "a84c1de → 9f2c1aa",
    );
    expect(getSpanLabel(appI18n.t, "a84c1de0000", "9f2c1aa1111", 3)).toBe(
      "a84c1de → 9f2c1aa · 3 revisions",
    );
  });

  it("suppresses the count when both ends are the same SHA", () => {
    // `revisions` counts BRIEFED revisions, so a re-brief of one head would
    // otherwise claim pushes that never happened.
    expect(getSpanLabel(appI18n.t, "a84c1de0000", "a84c1de0000", 4)).toBe(
      "a84c1de → a84c1de",
    );
  });
});
