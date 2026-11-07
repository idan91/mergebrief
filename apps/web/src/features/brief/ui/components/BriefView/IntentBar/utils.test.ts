import type { IntentCheck, IntentItem } from "brief-core/types";
import { describe, expect, it } from "vitest";

import { INTENT_COUNTS } from "./consts";
import { listNonZeroIntentCounts, type IntentCountSpec } from "./utils";

const ITEM: IntentItem = {
  intent: "add the widget endpoint",
  quote: "",
  sourceUrl: "",
  groupIds: [],
  acknowledged: false,
};

const EMPTY_CHECK: IntentCheck = {
  ticketUrls: [],
  ticketTitles: [],
  specificity: "precise",
  scopeNote: "",
  accomplished: [],
  maskedFixes: [],
  deviations: [],
  statedButMissing: [],
  doneButUnstated: [],
};

function listCountFields(intentCheck: IntentCheck): IntentCountSpec["field"][] {
  return listNonZeroIntentCounts(intentCheck, INTENT_COUNTS).map(
    ({ field }) => field,
  );
}

describe("listNonZeroIntentCounts", () => {
  it("keeps the non-zero counts in the bar's order", () => {
    const check: IntentCheck = {
      ...EMPTY_CHECK,
      doneButUnstated: [ITEM],
      accomplished: [ITEM, ITEM],
    };

    expect(listCountFields(check)).toEqual(["accomplished", "doneButUnstated"]);
  });

  it("states nothing for a check with every list empty", () => {
    expect(listCountFields(EMPTY_CHECK)).toEqual([]);
  });

  it("states every count when each list has an item", () => {
    const check: IntentCheck = {
      ...EMPTY_CHECK,
      accomplished: [ITEM],
      maskedFixes: [ITEM],
      deviations: [ITEM],
      statedButMissing: [ITEM],
      doneButUnstated: [ITEM],
    };

    expect(listNonZeroIntentCounts(check, INTENT_COUNTS)).toEqual(
      INTENT_COUNTS,
    );
  });
});
