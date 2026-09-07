import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONVERSATION_FILTER,
  parseConversationFilter,
} from "@web/features/conversation/utils/filter";
import { filterTriggerSegments } from "./utils";
import { createI18n } from "i18n";

const t = createI18n().t;

describe("filterTriggerSegments", () => {
  it("returns no segments while the filter is inactive", () => {
    expect(filterTriggerSegments(t, DEFAULT_CONVERSATION_FILTER, 0)).toEqual(
      [],
    );
    // Recency alone is not an active filter, nothing is hidden by it that
    // the trigger should account for.
    expect(
      filterTriggerSegments(t, parseConversationFilter({ reviews: "all" }), 0),
    ).toEqual([]);
  });

  it("counts selected verdicts and reviewers, pluralised", () => {
    expect(
      filterTriggerSegments(
        t,
        parseConversationFilter({
          verdicts: "approved,changes-requested",
          reviewers: "alice",
        }),
        0,
      ),
    ).toEqual(["2 verdicts", "1 reviewer"]);
  });

  it("appends the hidden-thread count last, the load-bearing number", () => {
    expect(
      filterTriggerSegments(
        t,
        parseConversationFilter({
          verdicts: "approved",
          reviewers: "alice,bob,carol",
        }),
        4,
      ),
    ).toEqual(["1 verdict", "3 reviewers", "4 hidden"]);
  });

  it("omits zero-count families rather than announcing them", () => {
    expect(
      filterTriggerSegments(
        t,
        parseConversationFilter({ reviewers: "alice" }),
        1,
      ),
    ).toEqual(["1 reviewer", "1 hidden"]);
  });

  it("omits a zero hidden count while other families are active", () => {
    expect(
      filterTriggerSegments(
        t,
        parseConversationFilter({ verdicts: "approved" }),
        0,
      ),
    ).toEqual(["1 verdict"]);
  });
});
