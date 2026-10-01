import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";

import { briefFixture } from "@web/features/brief/fixtures";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { describeFocusCount, deriveFocusCount } from "./utils";

const model = buildBriefViewModel(briefFixture);

function stubT(key: string, values: Record<string, unknown>): string {
  return `${key}:${JSON.stringify(values)}`;
}

describe("deriveFocusCount", () => {
  it("counts the active group's position among all groups", () => {
    const [first] = model.groups;
    if (!first) {
      throw new Error("fixture has no groups");
    }
    const groups = [first, { ...first, id: "g-second" }];
    expect(deriveFocusCount(groups, "g-second")).toEqual({
      position: 2,
      total: 2,
    });
  });

  it("has no count without an active group", () => {
    expect(deriveFocusCount(model.groups, null)).toBeUndefined();
  });
});

describe("describeFocusCount", () => {
  const t = stubT as unknown as TFunction;

  it("names the group by its position", () => {
    const label = describeFocusCount(t, { position: 2, total: 4 });
    expect(label).toBe('brief.focusIndicator.groupOf:{"index":2,"total":4}');
  });
});
