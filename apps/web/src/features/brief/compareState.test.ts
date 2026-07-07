import { describe, expect, it } from "vitest";

import {
  defaultComparison,
  isCompareAvailable,
  lastReviewUnavailableReasonTitle,
  normalizeBriefSearch,
  parseCompareParam,
  parseViewParam,
  resolveBriefSearch,
  withCompare,
  withView,
  type CompareOptionFlags,
} from "./compareState";

const both: CompareOptionFlags = { previousBrief: true, lastReview: true };
const onlyPreviousBrief: CompareOptionFlags = {
  previousBrief: true,
  lastReview: false,
};
const onlyLastReview: CompareOptionFlags = {
  previousBrief: false,
  lastReview: true,
};
const none: CompareOptionFlags = {
  previousBrief: false,
  lastReview: false,
};

describe("parseViewParam / parseCompareParam", () => {
  it("accepts only the canonical vocabulary", () => {
    expect(parseViewParam("full")).toBe("full");
    expect(parseViewParam("changes")).toBe("changes");
    expect(parseViewParam("bogus")).toBeUndefined();
    expect(parseViewParam(undefined)).toBeUndefined();

    expect(parseCompareParam("previous-brief")).toBe("previous-brief");
    expect(parseCompareParam("last-review")).toBe("last-review");
    expect(parseCompareParam("off")).toBe("off");
    expect(parseCompareParam("delta")).toBeUndefined();
  });
});

describe("defaultComparison", () => {
  it("picks last-review over previous-brief when both are available", () => {
    expect(defaultComparison(both)).toBe("last-review");
  });

  it("falls back to previous-brief when last-review is unavailable", () => {
    expect(defaultComparison(onlyPreviousBrief)).toBe("previous-brief");
  });

  it("falls back to off when neither is available", () => {
    expect(defaultComparison(none)).toBe("off");
  });
});

describe("normalizeBriefSearch", () => {
  it("normalizes changes+off to the product default comparison", () => {
    expect(
      normalizeBriefSearch({ view: "changes", compare: "off" }, both),
    ).toEqual({ view: "changes", compare: "last-review" });

    expect(
      normalizeBriefSearch(
        { view: "changes", compare: "off" },
        onlyPreviousBrief,
      ),
    ).toEqual({ view: "changes", compare: "previous-brief" });
  });

  it("falls back to full+off when changes+off has no comparison available", () => {
    expect(
      normalizeBriefSearch({ view: "changes", compare: "off" }, none),
    ).toEqual({ view: "full", compare: "off" });
  });

  it("drops an unavailable compare selection to off in Full Brief", () => {
    expect(
      normalizeBriefSearch(
        { view: "full", compare: "previous-brief" },
        onlyLastReview,
      ),
    ).toEqual({ view: "full", compare: "off" });
  });

  it("falls back to the other comparison in Changes Only when the selected one is unavailable", () => {
    expect(
      normalizeBriefSearch(
        { view: "changes", compare: "previous-brief" },
        onlyLastReview,
      ),
    ).toEqual({ view: "changes", compare: "last-review" });
  });

  it("leaves a valid explicit state untouched", () => {
    expect(
      normalizeBriefSearch({ view: "full", compare: "off" }, both),
    ).toEqual({ view: "full", compare: "off" });
    expect(
      normalizeBriefSearch(
        { view: "changes", compare: "previous-brief" },
        both,
      ),
    ).toEqual({ view: "changes", compare: "previous-brief" });
  });
});

describe("resolveBriefSearch", () => {
  it("defaults a fresh arrival to Changes Only + Your last review for a returning reviewer", () => {
    expect(resolveBriefSearch({}, both)).toEqual({
      view: "changes",
      compare: "last-review",
    });
    expect(resolveBriefSearch({}, onlyLastReview)).toEqual({
      view: "changes",
      compare: "last-review",
    });
  });

  it("defaults a fresh arrival to Full Brief + Off for a first-time reviewer, even with Previous Brief available", () => {
    expect(resolveBriefSearch({}, onlyPreviousBrief)).toEqual({
      view: "full",
      compare: "off",
    });
    expect(resolveBriefSearch({}, none)).toEqual({
      view: "full",
      compare: "off",
    });
  });

  it("normalizes once any explicit param is present, rather than applying the fresh default", () => {
    expect(resolveBriefSearch({ compare: "off" }, both)).toEqual({
      view: "full",
      compare: "off",
    });
    expect(resolveBriefSearch({ view: "changes" }, onlyPreviousBrief)).toEqual({
      view: "changes",
      compare: "previous-brief",
    });
  });
});

describe("withView / withCompare", () => {
  it("re-normalizes after switching View", () => {
    expect(withView({ view: "full", compare: "off" }, "changes", both)).toEqual(
      { view: "changes", compare: "last-review" },
    );
  });

  it("re-normalizes after switching Compare", () => {
    expect(
      withCompare({ view: "full", compare: "off" }, "previous-brief", both),
    ).toEqual({ view: "full", compare: "previous-brief" });
  });
});

describe("isCompareAvailable", () => {
  it("disables buttons for unavailable baselines", () => {
    expect(isCompareAvailable("previous-brief", onlyLastReview)).toBe(false);
    expect(isCompareAvailable("last-review", onlyLastReview)).toBe(true);
    expect(isCompareAvailable("off", none)).toBe(true);
  });
});

describe("lastReviewUnavailableReasonTitle (BRIEF-21)", () => {
  it("maps each unavailable reason to its honest plan copy", () => {
    expect(lastReviewUnavailableReasonTitle("pending")).toBe(
      "Delta still generating",
    );
    expect(lastReviewUnavailableReasonTitle("baseline-unavailable")).toBe(
      "History rewritten since your last review",
    );
  });
});
