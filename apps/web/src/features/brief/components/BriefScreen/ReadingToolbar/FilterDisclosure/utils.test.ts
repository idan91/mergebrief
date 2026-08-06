// The Filter trigger's active-state receipt (BRIEF-134): which `N noun`
// segments follow the label. Hidden-thread count is the load-bearing number;
// a zero contributes no segment; an inactive filter contributes none at all.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONVERSATION_FILTER,
  parseConversationFilter,
} from "@web/features/conversation/utils/filter";
import { filterTriggerSegments } from "./utils";

describe("filterTriggerSegments", () => {
  it("returns no segments while the filter is inactive", () => {
    expect(filterTriggerSegments(DEFAULT_CONVERSATION_FILTER, 0)).toEqual([]);
    // Recency alone is not an active filter — nothing is hidden by it that
    // the trigger should account for.
    expect(
      filterTriggerSegments(parseConversationFilter({ reviews: "all" }), 0),
    ).toEqual([]);
  });

  it("counts selected verdicts and reviewers, pluralised", () => {
    expect(
      filterTriggerSegments(
        parseConversationFilter({
          verdicts: "approved,changes-requested",
          reviewers: "alice",
        }),
        0,
      ),
    ).toEqual(["2 verdicts", "1 reviewer"]);
  });

  it("appends the hidden-thread count last — the load-bearing number", () => {
    expect(
      filterTriggerSegments(
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
      filterTriggerSegments(parseConversationFilter({ reviewers: "alice" }), 1),
    ).toEqual(["1 reviewer", "1 hidden"]);
  });

  it("omits a zero hidden count while other families are active", () => {
    expect(
      filterTriggerSegments(
        parseConversationFilter({ verdicts: "approved" }),
        0,
      ),
    ).toEqual(["1 verdict"]);
  });
});
