import { appI18n } from "../../../i18n/I18nProvider";
import { describe, expect, it } from "vitest";

import {
  defaultComparison,
  isCompareAvailable,
  lastReviewUnavailableReasonTitle,
  normalizeBriefSearch,
  parseBriefAddressSearch,
  parseCompareParam,
  parseViewParam,
  resolveBriefSearch,
  stripDefaultSearch,
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

const t = appI18n.t;

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

describe("parseBriefAddressSearch", () => {
  it("reads view, compare, diff, focus and the link", () => {
    expect(
      parseBriefAddressSearch({
        view: "changes",
        compare: "last-review",
        diff: "split",
        focus: true,
        l: "c1.R10-R12",
      }),
    ).toEqual({
      view: "changes",
      compare: "last-review",
      diff: "split",
      focus: true,
      l: "c1.R10-R12",
    });
  });

  it("reads focus spelled as the string true", () => {
    expect(parseBriefAddressSearch({ focus: "true" })).toEqual({ focus: true });
  });

  it("omits invalid values instead of defaulting them", () => {
    expect(
      parseBriefAddressSearch({
        view: "everything",
        compare: "yesterday",
        diff: "sideways",
        focus: false,
        l: "",
      }),
    ).toEqual({});
  });

  it("drops a link that is not a string", () => {
    expect(parseBriefAddressSearch({ l: 42 })).toEqual({});
  });

  it("drops params outside the vocabulary", () => {
    expect(parseBriefAddressSearch({ rev: 2, thread: 9, utm: "x" })).toEqual(
      {},
    );
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

  it("Changes Only falls back to the other comparison when one is missing", () => {
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
  it("a returning reviewer arrives on Changes Only and Your last review", () => {
    expect(resolveBriefSearch({}, both)).toEqual({
      view: "changes",
      compare: "last-review",
    });
    expect(resolveBriefSearch({}, onlyLastReview)).toEqual({
      view: "changes",
      compare: "last-review",
    });
  });

  it("a first-time reviewer arrives on Full Brief and Off", () => {
    expect(resolveBriefSearch({}, onlyPreviousBrief)).toEqual({
      view: "full",
      compare: "off",
    });
    expect(resolveBriefSearch({}, none)).toEqual({
      view: "full",
      compare: "off",
    });
  });

  it("any explicit param normalizes instead of taking the fresh default", () => {
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

describe("lastReviewUnavailableReasonTitle", () => {
  it("maps each unavailable reason to its honest copy", () => {
    expect(lastReviewUnavailableReasonTitle(t, "pending")).toBe(
      "Delta still generating",
    );
    expect(lastReviewUnavailableReasonTitle(t, "baseline-unavailable")).toBe(
      "History rewritten since your last review",
    );
  });
});

describe("stripDefaultSearch", () => {
  it("drops full but keeps off, a bare URL follows the last review", () => {
    expect(
      stripDefaultSearch({ view: "full", compare: "off" }, none, "unified"),
    ).toEqual({ compare: "off" });
    expect(
      stripDefaultSearch({ view: "full", compare: "off" }, both, "unified"),
    ).toEqual({ compare: "off" });
  });

  it("keeps the stripped URL meaning the same when last review lands", () => {
    const stripped = stripDefaultSearch(
      { view: "full", compare: "off" },
      onlyPreviousBrief,
      "unified",
    );
    expect(resolveBriefSearch(stripped, onlyPreviousBrief)).toEqual(
      resolveBriefSearch(stripped, both),
    );
  });

  it("keeps a chosen compare that absence would not resolve to", () => {
    expect(
      stripDefaultSearch(
        { view: "full", compare: "last-review" },
        both,
        "unified",
      ),
    ).toEqual({ compare: "last-review" });
  });

  it("keeps a non-default view or compare", () => {
    expect(
      stripDefaultSearch(
        { view: "changes", compare: "previous-brief" },
        onlyPreviousBrief,
        "unified",
      ),
    ).toEqual({ view: "changes", compare: "previous-brief" });
    expect(
      stripDefaultSearch(
        { view: "full", compare: "previous-brief" },
        onlyPreviousBrief,
        "unified",
      ),
    ).toEqual({ compare: "previous-brief" });
  });

  it("drops diff only when it names the stored preference", () => {
    expect(
      stripDefaultSearch(
        { view: "full", compare: "off", diff: "split" },
        none,
        "split",
      ),
    ).toEqual({ compare: "off" });
    expect(
      stripDefaultSearch(
        { view: "full", compare: "off", diff: "split" },
        none,
        "unified",
      ),
    ).toEqual({ compare: "off", diff: "split" });
  });
});
