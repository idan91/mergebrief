import { describe, expect, it } from "vitest";

import type { ReceiptRiskGroup } from "../../../utils/receipt";
import { DispositionKinds } from "../../../session/types";
import { ReceiptSections } from "./types";
import {
  isReceiptSection,
  listShownRiskGroups,
  pickFirstSection,
} from "./utils";

function makeGroup(
  key: ReceiptRiskGroup["key"],
  count: number,
): ReceiptRiskGroup {
  return {
    key,
    title: key,
    reviewerWroteDetail: false,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${key}:${index}`,
      attr: "auth",
      file: "src/a.ts",
      detail: "",
    })),
  };
}

describe("pickFirstSection", () => {
  it("opens on the risks while any are open", () => {
    expect(pickFirstSection(2, true)).toBe(ReceiptSections.RISKS);
  });

  it("opens on the signature line once nothing is open", () => {
    expect(pickFirstSection(0, true)).toBe(ReceiptSections.SIGNATURE);
  });

  it("opens on the risks when there is no signature line", () => {
    expect(pickFirstSection(0, false)).toBe(ReceiptSections.RISKS);
  });
});

describe("listShownRiskGroups", () => {
  it("puts open risks first and drops the empty groups", () => {
    const shown = listShownRiskGroups([
      makeGroup(DispositionKinds.ADDRESSED, 1),
      makeGroup(DispositionKinds.DISMISSED, 0),
      makeGroup(DispositionKinds.OPEN, 2),
    ]);
    expect(shown.map((group) => group.key)).toEqual([
      DispositionKinds.OPEN,
      DispositionKinds.ADDRESSED,
    ]);
  });
});

describe("isReceiptSection", () => {
  it("accepts every receipt section and nothing else", () => {
    for (const section of Object.values(ReceiptSections)) {
      expect(isReceiptSection(section)).toBe(true);
    }
    expect(isReceiptSection("details")).toBe(false);
  });
});
